import { bytesToBase64 } from './shared.js';

// Dependencies are downloaded as data only, without ambient account cookies.
// Packaging happens in the offscreen DOM; nothing captured is executed there.
export async function resolveArtifactResources(artifact, fetchResource = fetch) {
  if (artifact.unavailableReason) throw new Error(artifact.unavailableReason);
  const source = artifact.source || {};
  const base = source.baseUrl || artifact.frameUrl || artifact.sourceUrl;
  const assets = { ...(source.assets || {}) };
  const pending = new Map();
  const local = value => /^(?:data:|#)/i.test(value);
  const resolve = (value, parent = base) => {
    try {
      const url = new URL(value, parent);
      if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error();
      return url.href;
    } catch { throw new Error(`Artifact resource cannot be packaged: ${value}`); }
  };
  async function read(value, type, parent = base) {
    if (!value || local(value)) return;
    const url = resolve(value, parent);
    if (assets[url]) return;
    if (pending.has(url)) return pending.get(url);
    // Install a promise before following CSS imports, so circular stylesheets
    // terminate and can subsequently be rejected by the packager.
    const task = (async () => {
      const response = await fetchResource(url, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`Artifact resource request failed (${response.status}): ${url}`);
      const mime = (response.headers.get('content-type') || '').split(';')[0].trim();
      if (type === 'css' || type === 'js') {
        if (mime && !/(?:javascript|ecmascript|text\/css|text\/plain|application\/octet-stream)/i.test(mime)) throw new Error(`Unexpected artifact ${type} resource type: ${mime}`);
        const text = await response.text();
        assets[url] = { mime: type === 'css' ? 'text/css' : 'text/javascript', text };
        if (type === 'css') await collectCss(text, url);
      } else {
        if (!/^(?:image|audio|video|font)\/|^application\/(?:font-|vnd\.ms-fontobject|octet-stream)/i.test(mime)) throw new Error(`Unsupported artifact asset type: ${mime || 'unknown'}`);
        assets[url] = { mime, data: bytesToBase64(new Uint8Array(await response.arrayBuffer())) };
      }
    })();
    pending.set(url, task);
    await task;
  }
  async function collectCss(css, parent = base) {
    const imports = [...css.matchAll(/@import\s+(?:url\(\s*)?(["']?)([^"')\s;]+)\1\s*\)?[^;]*;/gi)];
    for (const match of imports) {
      const url = resolve(match[2], parent);
      if (!assets[url]) await read(match[2], 'css', parent);
    }
    const withoutImports = css.replace(/@import\s+[^;]+;/gi, '');
    for (const match of withoutImports.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) await read(match[1].trim(), 'binary', parent);
  }
  if (source.html) {
    const doc = new DOMParser().parseFromString(source.html, 'text/html');
    if (doc.querySelector('base[href]')) throw new Error('Artifact source uses a base URL override; export its resolved source instead.');
    for (const script of doc.querySelectorAll('script[src]')) await read(script.getAttribute('src'), 'js');
    for (const link of doc.querySelectorAll('link[rel~="stylesheet"][href]')) await read(link.getAttribute('href'), 'css');
    for (const node of doc.querySelectorAll('img[src],video[src],audio[src],source[src],[poster],image[href],image[xlink\\:href]')) {
      for (const attr of ['src','poster','href','xlink:href']) if (node.hasAttribute(attr)) await read(node.getAttribute(attr), 'binary');
    }
    for (const node of doc.querySelectorAll('[srcset]')) {
      // Data URLs contain commas; a complete data srcset needs no fetch.
      const value = node.getAttribute('srcset');
      if (!/^data:/i.test(value)) for (const candidate of value.split(',')) await read(candidate.trim().split(/\s+/)[0], 'binary');
    }
    for (const style of doc.querySelectorAll('style,[style]')) await collectCss(style.tagName === 'STYLE' ? style.textContent : style.getAttribute('style'));
  }
  for (const css of Array.isArray(source.css) ? source.css : source.css ? [source.css] : []) await collectCss(css);
  return { ...artifact, source: { ...source, baseUrl: base, assets } };
}
