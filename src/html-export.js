import { filename } from './shared.js';

const escapeAttribute = value => String(value || '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

const blockedTags = 'script,iframe,object,embed,base,form,input,button,textarea,select,option,link,meta,style,template,portal,frame,frameset,foreignObject,animate,animateMotion,animateTransform,set';
const safeImageData = value => /^data:image\/(?:png|jpeg|gif|webp|avif|bmp|svg\+xml);base64,[a-z\d+/=]+$/i.test(value);
const safeDownloadData = value => /^data:(?:application\/(?:octet-stream|pdf|zip|msword|rtf|vnd\.[\w.+-]+)|image\/(?:png|jpeg|gif|webp|avif|bmp)|audio\/[\w.+-]+|video\/[\w.+-]+|text\/(?:plain|markdown|csv));base64,[a-z\d+/=]+$/i.test(value);
const safeCssUrls = value => value.replace(/url\(([^)]*)\)/gi, (whole, target) => /^\s*["']?#[-\w]+["']?\s*$/.test(target) ? whole : '');

export function sanitizeCapturedHtml(markup) {
  if (typeof DOMParser === 'undefined') throw new Error('HTML export requires a browser DOM parser.');
  const parsed = new DOMParser().parseFromString(`<body>${markup || ''}</body>`, 'text/html');
  parsed.querySelectorAll(blockedTags).forEach(node => node.remove());
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
      if (name === 'src' && !(safeImageData(value) || svg && value.startsWith('#'))) element.removeAttribute(attribute.name);
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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'; object-src 'none'; frame-src 'none'"><meta name="referrer" content="no-referrer"><title>${title}</title><style>
body{margin:0;print-color-adjust:exact;-webkit-print-color-adjust:exact}.provenance{font:11px/1.4 system-ui,sans-serif;padding:8px 12px;border-bottom:1px solid #888;overflow-wrap:anywhere}.provenance h1{font:inherit;font-weight:600;margin:0 0 3px}.provenance a{color:inherit}.captured-message{break-inside:auto}.media-unavailable{font:italic 11px/1.4 system-ui,sans-serif;color:#666}
@page{size:auto;margin:8mm} @media print{html,body{max-width:100%;overflow:visible}.captured-message{break-inside:auto}.provenance{break-after:avoid}}
</style></head><body style="${escapeAttribute(bodyStyle)}"><header class="provenance"><h1>${title}</h1><div>Source: <a href="${source}">${source}</a></div><div>Captured: ${captured} · ${escapeAttribute(conversation.provider || '')}</div>${conversation.warning ? `<div>${escapeAttribute(conversation.warning)}</div>` : ''}</header>${safeBody}</body></html>`;
}

export function htmlFile(conversation) {
  return { name: filename(conversation.title, 'html'), mime: 'text/html;charset=utf-8', bytes: new TextEncoder().encode(conversationHtml(conversation)) };
}
