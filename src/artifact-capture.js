// Captures source that belongs to a provider artifact preview. This module only
// reads DOM/source text; it never evaluates captured code.

const ARTIFACT_FRAME_SELECTOR = [
  'iframe[title*="artifact" i]',
  'iframe[title*="canvas" i]',
  'iframe[aria-label*="artifact" i]',
  'iframe[aria-label*="canvas" i]',
  'iframe[data-testid*="artifact" i]',
  'iframe[data-testid*="canvas" i]',
  'iframe[class*="artifact" i]',
].join(',');

const ARTIFACT_PANEL_SELECTOR = [
  '[data-testid*="artifact-panel" i]',
  '[data-testid*="artifact-preview" i]',
  '[aria-label*="artifact preview" i]',
  '[data-testid*="canvas" i]',
  '[aria-label*="canvas" i]',
].join(',');

const text = node => (node?.textContent || '').trim();
const CONTROL_SELECTOR = 'button,a,[role="button"],[role="link"],[data-idea-capture-owned],[data-idea-capture-control]';
const providerArtifactPanel = node => node?.matches?.(ARTIFACT_PANEL_SELECTOR) && !node.matches(CONTROL_SELECTOR) && !node.closest(CONTROL_SELECTOR);
const providerArtifactFrame = node => node?.matches?.(ARTIFACT_FRAME_SELECTOR) && !node.closest(CONTROL_SELECTOR);
const messageFor = (frame, messages) => messages.find(message =>
  (message.nodes || [message.node]).some(node => node === frame || node.contains(frame)));

function dimensions(node) {
  const rect = node.getBoundingClientRect?.();
  const attrWidth = Number(node.getAttribute?.('width'));
  const attrHeight = Number(node.getAttribute?.('height'));
  return {
    width: Math.round(rect?.width || attrWidth || 0),
    height: Math.round(rect?.height || attrHeight || 0),
  };
}

function frameSource(frame, doc) {
  // srcdoc is the provider's original frame input. Reading the live DOM of a
  // React mount would capture generated nodes, not the React source.
  const srcdoc = frame.getAttribute('srcdoc');
  if (srcdoc) return { kind: 'html', source: { html: srcdoc, baseUrl: frame.ownerDocument.baseURI } };
  const inner = frame.contentDocument;
  if (!inner) return null;
  const sourceScript = inner.querySelector('script[type="text/babel"], script[type="text/jsx"], script[type="text/tsx"]');
  if (!sourceScript || !text(sourceScript)) return null;
  const css = [...inner.querySelectorAll('style')].map(style => style.textContent || '').filter(Boolean);
  return { kind: 'react', source: { code: text(sourceScript), css, language: sourceScript.type.endsWith('tsx') ? 'tsx' : 'jsx', baseUrl: inner.baseURI } };
}

function codeBundle(panel) {
  const blocks = [...new Set(panel.querySelectorAll('pre code, [data-language]:not(pre), [class*="language-"]:not(pre)'))];
  let html = '';
  let sourceCode = '';
  let language = 'jsx';
  const css = [];
  for (const block of blocks) {
    const codeNode = block;
    const lang = `${codeNode.getAttribute('data-language') || ''} ${codeNode.className || ''} ${codeNode.parentElement?.className || ''}`.toLowerCase();
    const content = text(codeNode);
    if (!content) continue;
    if (/\bhtml\b|language-html/.test(lang)) html = content;
    else if (/\bcss\b|language-css/.test(lang)) css.push(content);
    else if (/\b(?:jsx|tsx)\b|language-(?:jsx|tsx)/.test(lang)) { sourceCode = content; language = /\btsx\b/.test(lang) ? 'tsx' : 'jsx'; }
  }
  if (sourceCode) return { kind: 'react', source: { code: sourceCode, css, language } };
  if (!html && css.length) return { kind: 'react', source: { code: '', css, language: 'jsx' } };
  if (html) {
    if (css.length) {
      const styles = css.map(value => `<style>${value.replace(/<\/style/gi, '<\\/style')}</style>`).join('');
      html = /<\/head\s*>/i.test(html) ? html.replace(/<\/head\s*>/i, `${styles}</head>`) : `${styles}${html}`;
    }
    return { kind: 'html', source: { html, baseUrl: panel.ownerDocument.baseURI } };
  }
  return null;
}

export function hasArtifactSurface(node) {
  return !!providerArtifactFrame(node) || !!providerArtifactPanel(node) ||
    [...node?.querySelectorAll?.(`${ARTIFACT_FRAME_SELECTOR}, ${ARTIFACT_PANEL_SELECTOR}`) || []].some(candidate => providerArtifactFrame(candidate) || providerArtifactPanel(candidate));
}

function visible(node) {
  for (let current = node; current?.nodeType === 1; current = current.parentElement) {
    if (current.hidden || current.getAttribute('aria-hidden') === 'true') return false;
    const style = current.ownerDocument?.defaultView?.getComputedStyle?.(current);
    if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse') return false;
  }
  return true;
}

function labelFor(node) {
  return node.getAttribute('title') || node.getAttribute('aria-label') ||
    node.querySelector?.('h1,h2,h3,[data-testid*="title"]')?.textContent?.trim() || 'Interactive artifact';
}

function stableId(_node, index, messageIndex) {
  return `artifact-${messageIndex + 1}-${index + 1}`;
}

function messageForPanel(panel, messages) {
  const contained = messageFor(panel, messages);
  if (contained) return contained;
  const references = [panel.getAttribute('data-message-id'), panel.getAttribute('data-turn-id'), panel.getAttribute('data-turn-key')].filter(Boolean);
  const linked = messages.filter(message => references.includes(message.providerId));
  if (linked.length === 1) return linked[0];
  const artifactId = panel.getAttribute('data-artifact-id');
  if (artifactId) {
    const owners = messages.filter(message => (message.nodes || [message.node]).some(node =>
      [...node.querySelectorAll('[data-artifact-id], [aria-controls]')].some(control =>
        control.getAttribute('data-artifact-id') === artifactId || control.getAttribute('aria-controls')?.split(/\s+/).includes(artifactId))));
    if (owners.length === 1) return owners[0];
  }
  return messages.length === 1 ? messages[0] : null;
}

export function captureArtifacts(doc, messages = []) {
  const artifacts = [];
  const panels = [...new Set([
    ...[...doc.querySelectorAll(ARTIFACT_PANEL_SELECTOR)].filter(providerArtifactPanel),
    ...[...doc.querySelectorAll('[data-artifact-id]')].filter(candidate => !candidate.closest(CONTROL_SELECTOR) && candidate.querySelector('pre code,[data-language],[class*="language-"]')),
  ])];
  const candidates = [...new Set([
    ...[...doc.querySelectorAll(ARTIFACT_FRAME_SELECTOR)].filter(providerArtifactFrame),
    ...panels.flatMap(panel => [...panel.querySelectorAll('iframe[title*="preview" i], iframe[aria-label*="preview" i], iframe')]),
  ])];
  const usedFrames = new Set();
  for (const frame of candidates) {
    if (!visible(frame)) continue;
    const containingPanel = panels.find(panel => panel.contains(frame));
    const owner = messageFor(frame, messages) || (containingPanel && messageForPanel(containingPanel, messages));
    if (!owner) throw new Error('An artifact preview frame was detected, but it could not be linked to a conversation message.');
    let extracted = null;
    try {
      extracted = frameSource(frame, doc);
    } catch { /* Cross-origin source is supplied by the background frame collector. */ }
    const bounds = dimensions(frame);
    artifacts.push({
      id: stableId(frame, artifacts.length, owner.messageIndex), title: labelFor(frame),
      ...(extracted || { kind: 'html', source: { html: '', baseUrl: frame.src || frame.ownerDocument.baseURI } }), ...bounds,
      frameUrl: frame.src || undefined, messageIndex: owner.messageIndex, sectionId: owner.sectionId,
      _frameTitle: frame.getAttribute('title') || frame.getAttribute('aria-label') || '',
      _frameTestId: frame.getAttribute('data-testid') || '',
      ...(!extracted ? { unavailableReason: 'Artifact preview source is not readable as portable HTML or React source.' } : {}),
    });
    usedFrames.add(frame);
  }
  for (const panel of panels) {
    if (!visible(panel)) continue;
    if ([...usedFrames].some(frame => panel.contains(frame))) continue;
    const owner = messageForPanel(panel, messages);
    if (!owner) {
      if (messages.length > 1) throw new Error('Artifact preview source could not be linked to a conversation message. Select a conversation with a linked artifact source and try again.');
      continue;
    }
    const sources = codeBundle(panel);
    const bounds = dimensions(panel);
    if (panels.some(child => child !== panel && panel.contains(child) && codeBundle(child))) continue;
    artifacts.push({
      id: stableId(panel, artifacts.length, owner.messageIndex), title: labelFor(panel),
      ...(sources || { kind: 'html', source: { html: '' } }), ...bounds,
      messageIndex: owner.messageIndex, sectionId: owner.sectionId,
      _panelTestId: panel.getAttribute('data-testid') || '',
      _panelArtifactId: panel.getAttribute('data-artifact-id') || '',
      _panelLabel: panel.getAttribute('aria-label') || '',
      ...(!sources ? { unavailableReason: 'Artifact source code was not exposed in the selected artifact panel.' } : {}),
    });
  }
  return artifacts;
}
