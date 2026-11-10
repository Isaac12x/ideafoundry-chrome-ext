import Babel from '@babel/standalone';

const dataUrlFor = resource => {
  if (!resource?.mime) return null;
  if (typeof resource.data !== 'string' && typeof resource.text === 'string') {
    const bytes = new TextEncoder().encode(resource.text);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return `data:${resource.mime};base64,${btoa(binary)}`;
  }
  if (typeof resource.data !== 'string' || !resource.data) return null;
  if (/^data:/i.test(resource.data)) return resource.data;
  return `data:${resource.mime};base64,${resource.data}`;
};

function inspectModuleReferences(code, label, allowed = new Set()) {
  let ast;
  try { ast = Babel.packages.parser.parse(code, { sourceType: 'unambiguous', plugins: ['jsx', 'typescript'] }); }
  catch (error) { throw new Error(`Unsupported ${label} source: ${error.message}`); }
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'ImportDeclaration' || node.type === 'ExportNamedDeclaration' && node.source || node.type === 'ExportAllDeclaration') {
      const name = node.source?.value || '(module syntax)';
      if (!allowed.has(name)) throw new Error(`Unsupported ${label} import: ${name}`);
    }
    if (node.type === 'ImportExpression' || node.type === 'CallExpression' && (node.callee?.type === 'Import' || node.callee?.name === 'require')) {
      const name = node.arguments?.[0]?.value || '(dynamic module)';
      if (!allowed.has(name)) throw new Error(`Unsupported ${label} import: ${name}`);
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'loc' || key === 'start' || key === 'end') continue;
      if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === 'object') visit(value);
    }
  };
  visit(ast);
}
function hasClassNameStyling(code, language) {
  let ast;
  try { ast = Babel.packages.parser.parse(code, { sourceType: 'module', plugins: language === 'tsx' ? ['jsx', 'typescript'] : ['jsx'] }); }
  catch (error) { throw new Error(`Unsupported React artifact source: ${error.message}`); }
  let found = false;
  const visit = node => {
    if (!node || typeof node !== 'object' || found) return;
    if (node.type === 'JSXAttribute' && node.name?.name === 'className') {
      if (node.value?.type === 'StringLiteral' && node.value.value.trim()) found = true;
      else if (node.value?.type === 'JSXExpressionContainer') found = true;
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'loc' || key === 'start' || key === 'end') continue;
      if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === 'object') visit(value);
    }
  };
  visit(ast);
  return found;
}

function assertNoModuleImports(code, label) { inspectModuleReferences(code, label); }

/**
 * Package a captured, source-backed interactive artifact as one standalone HTML
 * document. The input is deliberately source-oriented: a rendered DOM alone is
 * not enough to recreate an app's behavior, so incomplete captures fail closed.
 */
export function artifactHtml(artifact, { reactRuntime = '' } = {}) {
  if (!artifact || typeof artifact !== 'object') throw new Error('Interactive artifact source is unavailable.');
  if (artifact.unavailableReason) throw new Error(`Interactive artifact cannot be exported: ${artifact.unavailableReason}`);
  if (typeof DOMParser === 'undefined') throw new Error('Interactive artifact export requires a browser DOM parser.');

  const sourceHtml = artifact.kind === 'react' ? '<!doctype html><html><head></head><body><div id="root"></div></body></html>' : artifact.source?.html || artifact.html;
  if (typeof sourceHtml !== 'string' || !sourceHtml.trim()) throw new Error('Interactive artifact source HTML is missing.');
  const parsed = new DOMParser().parseFromString(sourceHtml, 'text/html');
  if (!parsed.documentElement) throw new Error('Interactive artifact source HTML could not be parsed.');
  // Scripts and styles are supplied explicitly by capture so the package never
  // guesses at runtime code by inspecting the rendered DOM.
  const authoredBase = parsed.querySelector('base[href]')?.getAttribute('href');
  const resources = new Map();
  const providedResources = artifact.source?.assets || artifact.resources || artifact.assets || [];
  const resourceEntries = Array.isArray(providedResources) ? providedResources : Object.entries(providedResources).map(([url, resource]) => ({ url, ...resource }));
  for (const resource of resourceEntries) {
    const dataUrl = dataUrlFor(resource);
    if (!resource?.url || !dataUrl) throw new Error('Interactive artifact includes an unavailable resource.');
    resources.set(resource.url, dataUrl);
  }
  const baseUrl = artifact.source?.baseUrl || artifact.frameUrl || artifact.url || authoredBase || '';
  const absoluteUrl = (value, base = baseUrl) => {
    try { return base ? new URL(value, base).href : value; } catch { return value; }
  };
  const replaceResource = (value, base = baseUrl) => {
    const resolved = resources.get(value) || resources.get(absoluteUrl(value, base));
    if (resolved) return resolved;
    if (/^(?:data:|#|about:)/i.test(value)) return value;
    if (/^blob:/i.test(value)) throw new Error(`Interactive artifact blob resource is not portable: ${value}`);
    throw new Error(`Interactive artifact resource was not captured: ${absoluteUrl(value, base)}`);
  };
  for (const node of parsed.querySelectorAll('[srcset]')) {
    const sourceSet = node.getAttribute('srcset');
    const candidates = [...sourceSet.matchAll(/(?:^|,\s*)(data:[^,\s]+,[^\s]+|[^,\s]+)(?:\s+([^,]+))?/g)].map(([, url, descriptor]) => {
      if (/^(?:data:|#|about:)/i.test(url)) return [url, descriptor].filter(Boolean).join(' ');
      return [replaceResource(url), descriptor].filter(Boolean).join(' ');
    });
    node.setAttribute('srcset', candidates.join(', '));
  }

  const replaceCssUrls = (css, base = baseUrl, seen = new Set()) => {
    css = css.replace(/@import\s+(?:url\(\s*)?(["']?)([^"')\s;]+)\1\s*\)?([^;]*);/gi, (_whole, _quote, target, condition) => {
      if (condition.trim()) throw new Error('Conditional CSS imports cannot be preserved exactly.');
      const href = absoluteUrl(target, base);
      const resource = resourceEntries.find(item => item.url === href || item.url === target);
      if (!resource || typeof resource.text !== 'string') throw new Error(`Interactive artifact stylesheet import was not captured: ${href}`);
      if (seen.has(href)) return '';
      seen.add(href);
      return replaceCssUrls(resource.text, href, seen);
    });
    return css.replace(/url\((\s*)(["']?)(.*?)\2(\s*)\)/gi, (whole, before, quote, target, after) => {
    const value = target.trim();
    if (/^(?:data:|#|about:)/i.test(value)) return whole;
    if (/^blob:/i.test(value)) throw new Error(`Interactive artifact blob resource is not portable: ${value}`);
    const replacement = replaceResource(value, base);
    return `url(${before}${quote}${replacement}${quote}${after})`;
    });
  };
  for (const node of parsed.querySelectorAll('[src]:not(script), [poster], image[href], image[xlink\\:href]')) {
    for (const attr of ['src', 'poster', 'href', 'xlink:href']) {
      if (!node.hasAttribute(attr)) continue;
      const value = node.getAttribute(attr).trim();
      if (value && !/^(?:data:|#|about:)/i.test(value)) node.setAttribute(attr, replaceResource(value));
    }
  }
  for (const node of parsed.querySelectorAll('[style]')) node.setAttribute('style', replaceCssUrls(node.getAttribute('style')));
  const css = [];
  for (const node of parsed.querySelectorAll('script')) {
    if (node.hasAttribute('src')) {
      const src = node.getAttribute('src');
      const absoluteSrc = absoluteUrl(src);
      const resource = resources.get(src) || resources.get(absoluteSrc);
      if (!resource) throw new Error(`Interactive artifact script was not captured: ${node.getAttribute('src')}`);
      const source = resourceEntries.find(item => item.url === src || item.url === absoluteSrc);
      if (typeof source?.text !== 'string') throw new Error(`Captured external script has no executable source: ${node.getAttribute('src')}`);
      if (node.type === 'module' || node.hasAttribute('async') || node.hasAttribute('defer')) throw new Error('Module, async, or deferred artifact scripts are not supported.');
      assertNoModuleImports(source.text, `script ${src}`);
      node.removeAttribute('src');
      node.textContent = source.text;
    }
    if (node.type === 'module') throw new Error('Module artifact scripts are not supported.');
    if (node.type === 'application/json' || node.type === 'application/ld+json') {
      continue;
    }
    if (node.type && node.type !== 'text/javascript' && node.type !== 'application/javascript') throw new Error(`Unsupported interactive artifact script type: ${node.type}`);
    if (node.hasAttribute('async') || node.hasAttribute('defer')) throw new Error('Async or deferred artifact scripts are not supported.');
    const script = node.textContent || '';
    assertNoModuleImports(script, 'inline script');
    node.textContent = script.replace(/<\/script/gi, '<\\/script');
  }
  for (const node of parsed.querySelectorAll('style,link[rel~="stylesheet"]')) {
    if (node.matches('style')) {
      const type = node.getAttribute('type');
      if (type && type.toLowerCase() !== 'text/css') throw new Error(`Unsupported interactive artifact style type: ${type}`);
      node.textContent = replaceCssUrls(node.textContent || '', baseUrl).replace(/<\/style/gi, '<\\/style');
    }
    else {
      const href = node.getAttribute('href');
      const absoluteHref = href ? absoluteUrl(href) : '';
      const source = resourceEntries.find(item => item.url === href || item.url === absoluteHref);
      if (!href || !source) throw new Error(`Interactive artifact stylesheet was not captured: ${href || '(missing href)'}`);
      if (typeof source.text !== 'string') throw new Error(`Captured external stylesheet has no text source: ${href}`);
      const style = parsed.createElement('style');
      for (const attribute of ['media', 'title']) if (node.hasAttribute(attribute)) style.setAttribute(attribute, node.getAttribute(attribute));
      if (node.disabled) style.setAttribute('media', 'not all');
      style.textContent = replaceCssUrls(source.text, absoluteHref).replace(/<\/style/gi, '<\\/style');
      node.replaceWith(style);
    }
  }
  for (const node of parsed.querySelectorAll('meta[http-equiv],base,iframe,frame,frameset,object,embed,portal')) {
    if (node.matches('iframe,frame,frameset,object,embed,portal')) throw new Error('Interactive artifact contains an unsupported nested browsing context or plugin.');
    if (node.matches('base') || node.getAttribute('http-equiv')?.toLowerCase() === 'content-security-policy' || node.getAttribute('http-equiv')?.toLowerCase() === 'refresh') node.remove();
  }
  if (artifact.kind === 'react') {
    if (!reactRuntime || typeof reactRuntime !== 'string') throw new Error('React artifact export requires the packaged React runtime.');
    if (!artifact.source || typeof artifact.source.code !== 'string' || !artifact.source.code.trim()) throw new Error('React artifact source code is missing.');
    css.push(...(artifact.source?.css || []).map(text => ({ text, base: baseUrl })));
  }
  if (css.some(style => typeof style?.text !== 'string')) throw new Error('Interactive artifact source contains unsupported styles.');
  if (artifact.kind === 'react') {
    const styleNode = parsed.createElement('style');
    styleNode.textContent = css.map(item => replaceCssUrls(item.text, item.base)).join('\n').replace(/<\/style/gi, '<\\/style');
    parsed.head.append(styleNode);
    const runtimeNode = parsed.createElement('script');
    runtimeNode.textContent = reactRuntime.replace(/<\/script/gi, '<\\/script');
    const appNode = parsed.createElement('script');
    appNode.textContent = compileReactArtifact(artifact.source).replace(/<\/script/gi, '<\\/script');
    parsed.body.append(runtimeNode, appNode);
  }

  // This policy lets captured app code run locally while denying network,
  // workers, frames, forms, plugins, and remote fonts/media/images.
  const csp = parsed.createElement('meta');
  csp.httpEquiv = 'Content-Security-Policy';
  csp.content = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' data:; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; worker-src 'none'; frame-src 'none'; child-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  parsed.head.prepend(csp);
  parsed.title = artifact.title || parsed.title || 'Interactive artifact';
  return `<!doctype html>\n${parsed.documentElement.outerHTML}`;
}

export function compileReactArtifact(source) {
  const code = source?.code;
  if (typeof code !== 'string' || !code.trim()) throw new Error('React artifact source code is missing.');
  const language = source.language || 'jsx';
  if (!['jsx', 'tsx'].includes(language)) throw new Error(`Unsupported React artifact language: ${language}`);
  inspectModuleReferences(code, 'React artifact', new Set(['react', 'react-dom', 'react-dom/client', 'lucide-react', 'recharts']));
  const css = Array.isArray(source.css) ? source.css : source.css ? [source.css] : [];
  if (!css.length && hasClassNameStyling(code, language)) throw new Error('React artifact uses className styles, but its stylesheet source was not captured.');
  const compiled = Babel.transform(code, {
    filename: language === 'tsx' ? 'artifact.tsx' : 'artifact.jsx',
    sourceType: 'module',
    presets: language === 'tsx' ? ['typescript', ['react', { runtime: 'classic' }]] : [['react', { runtime: 'classic' }]],
    plugins: ['transform-modules-commonjs'],
    parserOpts: { allowReturnOutsideFunction: false },
    generatorOpts: { comments: true },
  }).code;
  return `(function(){
'use strict';
const React=globalThis.React;
const ReactDOM=globalThis.ReactDOM;
if(!React||!ReactDOM)throw new Error('Packaged React runtime did not initialize.');
const modules=globalThis.IdeaArtifactModules||{};
const module={exports:{}};const exports=module.exports;
function require(name){if(name==='react')return modules.react||React;if(name==='react-dom')return modules['react-dom']||ReactDOM;if(name==='react-dom/client')return modules['react-dom/client']||ReactDOM;if(name==='lucide-react'||name==='recharts'){if(modules[name])return modules[name]}throw new Error('Unsupported React artifact import: '+name)}
${compiled}
const exported=module.exports.default||module.exports.App||module.exports;
const Component=typeof exported==='function'||exported?.$$typeof?exported:exported?.default;
if(typeof Component!=='function'&&!(Component&&typeof Component==='object'&&Component.$$typeof))throw new Error('React artifact source must export a component as default or App.');
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Component));
})();`;
}
