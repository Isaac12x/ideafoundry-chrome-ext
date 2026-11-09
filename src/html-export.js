import { filename } from './shared.js';

const escapeAttribute = value => String(value || '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

const blockedTags = 'script,iframe,object,embed,base,link,meta,style,template,portal,frame,frameset,foreignObject,animate,animateMotion,animateTransform,set';
const safeImageData = value => /^data:image\/(?:png|jpeg|gif|webp|avif|bmp|svg\+xml);base64,[a-z\d+/=]+$/i.test(value);
const safeMediaData = value => /^data:(?:audio\/(?:mpeg|ogg|wav|webm|mp4|aac|flac)|video\/(?:mp4|webm|ogg|mpeg));base64,[a-z\d+/=]+$/i.test(value);
const safeDownloadData = value => /^data:(?:application\/(?:octet-stream|pdf|zip|msword|rtf|vnd\.[\w.+-]+)|image\/(?:png|jpeg|gif|webp|avif|bmp)|audio\/[\w.+-]+|video\/[\w.+-]+|text\/(?:plain|markdown|csv));base64,[a-z\d+/=]+$/i.test(value);
const safeCssUrls = value => value.replace(/url\(([^)]*)\)/gi, (whole, target) => /^\s*["']?#[-\w]+["']?\s*$/.test(target) ? whole : '');

export function sanitizeCapturedHtml(markup) {
  if (typeof DOMParser === 'undefined') throw new Error('HTML export requires a browser DOM parser.');
  const parsed = new DOMParser().parseFromString(`<body>${markup || ''}</body>`, 'text/html');
  parsed.querySelectorAll(blockedTags).forEach(node => node.remove());
  const radioFormScopes = new WeakMap();
  parsed.body.querySelectorAll('form').forEach(form => {
    form.querySelectorAll('input[type="radio"]').forEach(radio => radioFormScopes.set(radio, form));
  });
  // Captured local disclosures are converted to native disclosure elements;
  // the marker is only a hint and is accepted when it resolves to one unique target.
  for (const control of [...parsed.body.querySelectorAll('button[data-idea-interaction="disclosure"][aria-controls]')]) {
    const id = control.getAttribute('aria-controls');
    if (!id || !/^[\w:.-]+$/.test(id)) continue;
    const targets = [...parsed.body.querySelectorAll('[id]')].filter(node => node.id === id);
    const target = targets.length === 1 ? targets[0] : null;
    if (!target || target === control || control.contains(target) || target.contains(control)) continue;
    const controlSection = control.closest('[data-idea-export-section]') || control.closest('article');
    const targetSection = target.closest('[data-idea-export-section]') || target.closest('article');
    if (controlSection !== targetSection) continue;
    const details = parsed.createElement('details');
    if (control.getAttribute('aria-expanded') === 'true') details.open = true;
    const summary = parsed.createElement('summary');
    summary.innerHTML = control.innerHTML;
    for (const attribute of ['class', 'style', 'aria-label']) {
      if (control.hasAttribute(attribute)) summary.setAttribute(attribute, control.getAttribute(attribute));
    }
    summary.style.listStyle = 'none';
    target.removeAttribute('hidden');
    target.removeAttribute('aria-hidden');
    if (target.style.getPropertyValue('display').trim().toLowerCase() === 'none') target.style.removeProperty('display');
    if (['hidden', 'collapse'].includes(target.style.getPropertyValue('visibility').toLowerCase())) target.style.removeProperty('visibility');
    if (!target.getAttribute('style')?.trim()) target.removeAttribute('style');
    details.append(summary, target);
    control.replaceWith(details);
  }
  parsed.body.querySelectorAll('form').forEach(form => {
    const neutral = parsed.createElement('div');
    for (const attribute of [...form.attributes]) {
      if (!['action', 'method', 'target', 'enctype', 'accept-charset', 'novalidate'].includes(attribute.name.toLowerCase())) neutral.setAttribute(attribute.name, attribute.value);
    }
    neutral.append(...form.childNodes);
    form.replaceWith(neutral);
  });
  // Keep button appearance while removing all behavior and untrusted annotations.
  parsed.body.querySelectorAll('button').forEach(button => {
    const span = parsed.createElement('span');
    for (const attribute of ['class', 'style', 'title', 'aria-label']) {
      if (button.hasAttribute(attribute)) span.setAttribute(attribute, button.getAttribute(attribute));
    }
    span.append(...button.childNodes);
    button.replaceWith(span);
  });
  parsed.body.querySelectorAll('input').forEach(node => {
    const type = (node.getAttribute('type') || 'text').toLowerCase();
    if (['hidden', 'password', 'file', 'submit', 'reset', 'image'].includes(type)) node.remove();
  });
  const radioScopes = new WeakMap();
  let radioScopeId = 0;
  for (const radio of parsed.body.querySelectorAll('input[type="radio"][name]')) {
    const original = radio.getAttribute('name');
    if (!original) continue;
    const scope = radio.closest('[data-idea-export-section],article') || parsed.body;
    let names = radioScopes.get(scope);
    if (!names) { names = new Map(); radioScopes.set(scope, names); }
    let forms = names.get(original);
    if (!forms) { forms = new Map(); names.set(original, forms); }
    const formScope = radioFormScopes.get(radio) || null;
    if (!forms.has(formScope)) forms.set(formScope, `idea-export-radio-${radioScopeId++}`);
    radio.setAttribute('name', forms.get(formScope));
  }
  for (const element of parsed.body.querySelectorAll('*')) {
    const svg = element.namespaceURI === 'http://www.w3.org/2000/svg';
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (name.startsWith('on') || ['srcdoc','srcset','poster','action','formaction','autofocus','contenteditable'].includes(name)) { element.removeAttribute(attribute.name); continue; }
      if (name === 'style') {
        const safe = safeCssUrls(value).split(';').filter(declaration => !/expression\s*\(|@import|behavior\s*:/i.test(declaration)).join(';');
        if (safe) element.setAttribute('style', safe); else element.removeAttribute('style');
      }
      if (name === 'href' || name === 'xlink:href') {
        if (svg) { if (value && !value.startsWith('#')) element.removeAttribute(attribute.name); }
        else if (!value.startsWith('#') && !/^https?:\/\//i.test(value) && !/^mailto:/i.test(value) && !(element.hasAttribute('download') && safeDownloadData(value))) element.removeAttribute(attribute.name);
      }
      if (name === 'src' && !(safeImageData(value) || safeMediaData(value) || svg && value.startsWith('#'))) element.removeAttribute(attribute.name);
      if (name === 'data') element.removeAttribute(attribute.name);
      if (name === 'target') element.removeAttribute(attribute.name);
    }
  }
  return parsed.body.innerHTML;
}

function embedMedia(content, media) {
  return content.replace(/\{\{idea-media:([a-zA-Z0-9_-]{1,100})\}\}/g, (_token, id) => {
    const item = media.get(id);
    if (!item?.data) return `<span class="media-unavailable">[Media unavailable: ${escapeAttribute(item?.alt || item?.filename || 'file')}]</span>`;
    const src = `data:${item.mime || 'application/octet-stream'};base64,${item.data}`;
    if (item.kind === 'image') return `<img src="${src}" alt="${escapeAttribute(item.alt)}"${item.layoutStyle ? ` style="${escapeAttribute(item.layoutStyle)}"` : ''}>`;
    if (item.kind === 'audio' && safeMediaData(src)) return `<span class="media-player"><audio controls preload="metadata" src="${src}"${item.layoutStyle ? ` style="${escapeAttribute(item.layoutStyle)}"` : ''}></audio><a href="${src}" download="${escapeAttribute(item.filename || 'audio')}" aria-label="Download audio">${escapeAttribute(item.filename || 'Download audio')}</a></span>`;
    if (item.kind === 'video' && safeMediaData(src)) return `<span class="media-player"><video controls preload="metadata" src="${src}"${item.layoutStyle ? ` style="${escapeAttribute(item.layoutStyle)}"` : ''}></video><a href="${src}" download="${escapeAttribute(item.filename || 'video')}" aria-label="Download video">${escapeAttribute(item.filename || 'Download video')}</a></span>`;
    return `<a href="${src}" download="${escapeAttribute(item.filename || 'attachment')}">${escapeAttribute(item.filename || 'Download attachment')}</a>`;
  });
}

export function conversationHtml(conversation) {
  const media = new Map((conversation.media || []).map(item => [item.id, item]));
  const body = conversation.layoutHtml
    ? embedMedia(conversation.layoutHtml, media)
    : (conversation.messages || []).map(message => `<article aria-label="${escapeAttribute(message.role)}" class="captured-message">${embedMedia(message.html || '', media)}</article>`).join('\n');
  const safeBody = sanitizeCapturedHtml(body);
  const title = escapeAttribute(conversation.title || 'Conversation');
  const source = escapeAttribute(conversation.url || '');
  const captured = escapeAttribute(conversation.capturedAt || '');
  const bodyStyle = Object.entries(conversation.layout || {}).map(([property, value]) => `${property}:${value}`).join(';');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; media-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'; object-src 'none'; frame-src 'none'"><meta name="referrer" content="no-referrer"><title>${title}</title><style>
body{margin:0;print-color-adjust:exact;-webkit-print-color-adjust:exact}.provenance{font:11px/1.4 system-ui,sans-serif;padding:8px 12px;border-bottom:1px solid #888;overflow-wrap:anywhere}.provenance h1{font:inherit;font-weight:600;margin:0 0 3px}.provenance a{color:inherit}.captured-message{break-inside:auto}.media-unavailable{font:italic 11px/1.4 system-ui,sans-serif;color:#666}
@page{size:auto;margin:8mm} @media print{html,body{max-width:100%;overflow:visible}.captured-message{break-inside:auto}.provenance{break-after:avoid}}
</style></head><body style="${escapeAttribute(bodyStyle)}"><header class="provenance"><h1>${title}</h1><div>Source: <a href="${source}">${source}</a></div><div>Captured: ${captured} · ${escapeAttribute(conversation.provider || '')}</div>${conversation.warning ? `<div>${escapeAttribute(conversation.warning)}</div>` : ''}</header>${safeBody}</body></html>`;
}

export function htmlFile(conversation) {
  return { name: filename(conversation.title, 'html'), mime: 'text/html;charset=utf-8', bytes: new TextEncoder().encode(conversationHtml(conversation)) };
}
