import { bytesToBase64, filename, markdown } from './shared.js';
import MarkdownIt from 'markdown-it';

const MEDIA_MIME = /^(image\/(png|jpeg|gif|webp|avif|svg\+xml|bmp|tiff?)|audio\/[\w.+-]+|video\/[\w.+-]+|application\/(pdf|octet-stream|zip|msword|rtf|json|xml|vnd\.[\w.+-]+)|text\/(plain|markdown|csv))$/i;
const PLACEHOLDER = /\{\{idea-media:([a-zA-Z0-9_-]{1,100})\}\}/g;
const pdfMarkdown = new MarkdownIt({ html: false, linkify: false, breaks: false }).use(md => {
  md.inline.ruler.before('text', 'idea_media', (state, silent) => {
    const match = /^\{\{idea-media:([a-zA-Z0-9_-]{1,100})\}\}/.exec(state.src.slice(state.pos));
    if (!match) return false;
    if (!silent) { const token = state.push('idea_media', '', 0); token.meta = { id: match[1] }; }
    state.pos += match[0].length;
    return true;
  });
});

function inlinePdf(tokens = [], mediaById = new Map(), conversation = {}, assetBase = null, maxWidth = 460) {
  const active = [];
  const output = [];
  const style = () => Object.assign({}, ...active.map(item => item.style));
  for (const token of tokens) {
    if (token.nesting === 1) {
      const next = {};
      if (token.type === 'strong_open') next.bold = true;
      if (token.type === 'em_open') next.italics = true;
      if (token.type === 's_open') next.decoration = 'lineThrough';
      if (token.type === 'link_open') { next.link = token.attrGet('href'); next.color = '#335d4d'; }
      active.push({ type: token.type.replace('_open', '_close'), style: next });
    } else if (token.nesting === -1) {
      const index = active.map(item => item.type).lastIndexOf(token.type);
      if (index >= 0) active.splice(index);
    } else if (token.type === 'text' || token.type === 'code_inline' || token.type === 'html_inline') {
      output.push({ text: token.content, ...style(), ...(token.type === 'code_inline' ? { background: '#f1f3f2' } : {}) });
    } else if (token.type === 'softbreak' || token.type === 'hardbreak') output.push({ text: '\n', ...style() });
    else if (token.type === 'image') output.push({ text: token.content || token.attrGet('alt') || 'Image' });
    else if (token.type === 'idea_media') {
      const node = pdfMediaNode(mediaById.get(token.meta?.id), conversation, assetBase, maxWidth);
      if (Array.isArray(node.text)) output.push(...node.text.map(run => ({ ...run, ...style() })));
      else output.push({ ...node, ...style() });
    }
  }
  return output;
}

function pdfMediaNode(item, conversation, assetBase, maxWidth = 460) {
  if (!item) return { text: 'Media unavailable: reference missing from this capture.', italics: true };
  const label = item.alt || item.title || item.filename || item.kind || 'Referenced media';
  if (item.kind === 'image' && item.pdfData) return { image: item.pdfData, width: maxWidth, fit: [maxWidth, 640], margin: [0, 3, 0, 3] };
  const source = item.url || conversation.url;
  if (item.error || item.pdfError || !item.data) return { text: `Media unavailable: ${item.error || item.pdfError || 'file data was not captured'} — ${label}`, link: source, color: '#335d4d' };
  const text = [{ text: label, ...(source ? { link: source } : {}), color: '#335d4d' }];
  if (item.data && item.filename) {
    const name = assetBase ? flatCompanionName(item, assetBase) : `media/${item.filename}`;
    const companionLink = assetBase ? kbAssetUrl(assetBase, name) : undefined;
    text.push({ text: ` (companion: ${name})`, ...(companionLink ? { link: companionLink } : {}), color: '#335d4d', fontSize: 8 });
  }
  return { text };
}

function pdfMediaParagraph(item, conversation, assetBase, maxWidth = 460) {
  if (!item) return [{ text: 'Media unavailable: reference missing from this capture.', italics: true }];
  const label = item.alt || item.title || item.filename || item.kind || 'Referenced media';
  const source = item.url || conversation.url;
  if (item.kind === 'image' && item.pdfData) return [pdfMediaNode(item, conversation, assetBase, maxWidth)];
  if (item.error || item.pdfError || !item.data) return [{ text: `Media unavailable: ${item.error || item.pdfError || 'file data was not captured'} — ${label}`, link: source, color: '#335d4d', margin: [0, 4, 0, 4] }];
  const name = assetBase ? flatCompanionName(item, assetBase) : `media/${item.filename}`;
  const companion = { text: `${item.kind || 'Media'} companion: ${name}`, margin: [0, 4, 0, 1] };
  if (assetBase) companion.link = kbAssetUrl(assetBase, name);
  const original = { text: `Original source: ${source}`, link: source, color: '#335d4d', fontSize: 8, margin: [0, 0, 0, 4] };
  return [companion, original];
}

function inlineBlock(tokens, mediaById, conversation, assetBase, maxWidth = 460) {
  const runs = inlinePdf(tokens, mediaById, conversation, assetBase, maxWidth);
  if (!runs.some(run => run && typeof run === 'object' && ('image' in run || 'stack' in run))) return { text: runs };
  const stack = []; let text = [];
  const flush = () => { if (text.length) { stack.push({ text }); text = []; } };
  for (const run of runs) {
    if (run && typeof run === 'object' && ('image' in run || 'stack' in run)) { flush(); stack.push(run); }
    else text.push(run);
  }
  flush();
  if (stack.length === 1 && !text.length) return stack[0];
  return { stack, margin: [0, 0, 0, 7] };
}

function markdownPdfBlocks(source, mediaById = new Map(), conversation = {}, assetBase = null) {
  const tokens = pdfMarkdown.parse(source, {});
  const parse = (start, stopType, maxWidth = 460) => {
    const blocks = [];
    let i = start;
    while (i < tokens.length && tokens[i].type !== stopType) {
      const token = tokens[i++];
      if (token.type === 'paragraph_open' || /^heading_open$/.test(token.type)) {
        const inline = tokens[i++]; i++; // inline, matching close
        const heading = token.type === 'heading_open';
        if (!heading && inline?.children?.length === 1 && inline.children[0].type === 'idea_media') {
          blocks.push(...pdfMediaParagraph(mediaById.get(inline.children[0].meta?.id), conversation, assetBase, maxWidth));
          continue;
        }
        const block = inlineBlock(inline?.children, mediaById, conversation, assetBase, maxWidth);
        blocks.push({ ...block, ...(heading ? { fontSize: Math.max(12, 20 - Number(token.tag.slice(1)) * 2), bold: true } : {}), margin: heading ? [0, 8, 0, 4] : [0, 0, 0, 7] });
      } else if (token.type === 'fence' || token.type === 'code_block') {
        blocks.push({ text: token.content.replace(/\n$/, ''), fontSize: 8, background: '#f1f3f2', margin: [0, 3, 0, 8], preserveLeadingSpaces: true });
      } else if (token.type === 'hr') blocks.push({ canvas: [{ type: 'line', x1: 0, y1: 0, x2: maxWidth, y2: 0, lineWidth: 0.7, lineColor: '#9ca8a2' }], margin: [0, 5, 0, 8] });
      else if (token.type === 'blockquote_open') {
        const nested = parse(i, 'blockquote_close', maxWidth - 12); i = nested.next + 1;
        blocks.push(...nested.blocks.map(block => ({ ...block, margin: [12, 2, 0, 6], color: '#46534d' })));
      } else if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') {
        const endType = token.type === 'bullet_list_open' ? 'bullet_list_close' : 'ordered_list_close';
        const items = [];
        while (i < tokens.length && tokens[i].type !== endType) {
          if (tokens[i].type !== 'list_item_open') { i++; continue; }
          i++;
          const nested = parse(i, 'list_item_close', maxWidth - 18);
          i = nested.next + 1;
          items.push(nested.blocks.length === 1 ? nested.blocks[0] : { stack: nested.blocks.length ? nested.blocks : [{ text: '' }] });
        }
        i++;
        const list = { [token.type === 'bullet_list_open' ? 'ul' : 'ol']: items, margin: [0, 0, 0, 8] };
        if (token.type === 'ordered_list_open' && Number(token.attrGet?.('start')) > 1) list.start = Number(token.attrGet('start'));
        blocks.push(list);
      } else if (token.type === 'table_open') {
        const body = [];
        const firstRowStart = tokens.findIndex((item, index) => index >= i && item.type === 'tr_open');
        let columnCount = 1;
        if (firstRowStart >= 0) {
          const firstRowEnd = tokens.findIndex((item, index) => index > firstRowStart && item.type === 'tr_close');
          columnCount = tokens.slice(firstRowStart + 1, firstRowEnd).filter(item => item.type === 'th_open' || item.type === 'td_open').length || 1;
        }
        while (i < tokens.length && tokens[i].type !== 'table_close') {
          if (tokens[i].type === 'tr_open') {
            i++; const row = [];
            while (i < tokens.length && tokens[i].type !== 'tr_close') {
              if (tokens[i].type === 'inline') {
                const cellWidth = Math.max(1, maxWidth / columnCount - 16);
                const cell = inlineBlock(tokens[i].children, mediaById, conversation, assetBase, cellWidth);
                const cellToken = tokens[i - 1];
                const alignment = /text-align\s*:\s*(left|center|right)/i.exec(cellToken?.attrGet?.('style') || '')?.[1]?.toLowerCase();
                row.push({ ...cell, bold: cellToken?.type === 'th_open', ...(alignment ? { alignment } : {}) });
              }
              i++;
            }
            body.push(row); i++;
          } else i++;
        }
        i++;
        if (body.length) blocks.push({ table: { headerRows: tokens.slice(start, i).some(item => item.type === 'thead_open') ? 1 : 0, widths: Array(body[0].length).fill('*'), body }, layout: 'lightHorizontalLines', margin: [0, 2, 0, 9] });
      }
    }
    return { blocks, next: i };
  };
  return parse(0).blocks;
}

export function mediaOrigins(conversation) {
  const origins = new Set();
  for (const item of conversation?.media || []) {
    if (item.data) continue;
    try {
      const url = new URL(item.url);
      if ((url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password) origins.add(`${url.origin}/*`);
    } catch { /* data and blob URLs do not need host permissions */ }
  }
  return [...origins];
}

function bytesFromDataUrl(value) {
  const match = /^data:([^,]*),([\s\S]*)$/i.exec(value);
  if (!match) throw new Error('Invalid data URL.');
  const metadata = match[1].split(';');
  const mime = metadata[0] || 'text/plain';
  const base64 = metadata.slice(1).some(parameter => parameter.toLowerCase() === 'base64');
  let bytes;
  if (base64) bytes = decodeBase64(match[2]);
  else {
    const output = [];
    const encoder = new TextEncoder();
    for (let index = 0; index < match[2].length;) {
      if (match[2][index] === '%') {
        const hex = match[2].slice(index + 1, index + 3);
        if (!/^[\da-f]{2}$/i.test(hex)) throw new Error('Invalid percent escape in data URL.');
        output.push(Number.parseInt(hex, 16)); index += 3;
      } else {
        const codePoint = String.fromCodePoint(match[2].codePointAt(index));
        output.push(...encoder.encode(codePoint)); index += codePoint.length;
      }
    }
    bytes = Uint8Array.from(output);
  }
  return { bytes, mime };
}

function safeFilename(item, index, mime) {
  const fallbackExt = ({ 'image/jpeg': 'jpg', 'image/svg+xml': 'svg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif', 'image/bmp': 'bmp', 'image/tiff': 'tiff', 'application/pdf': 'pdf', 'application/zip': 'zip', 'text/plain': 'txt', 'text/csv': 'csv', 'text/markdown': 'md' })[mime] || mime.split('/')[1]?.replace(/[^a-z0-9]+/gi, '') || 'bin';
  const knownExtensions = new Set('png jpg jpeg gif webp avif svg bmp tif tiff mp3 wav ogg m4a aac flac opus mp4 webm mov m4v avi mkv pdf doc docx xls xlsx ppt pptx zip csv txt md json xml rtf'.split(' '));
  const sourceName = item.url?.startsWith('data:') || item.url?.startsWith('blob:')
    ? (/\.[a-z0-9]{1,12}$/i.test(item.filename || '') ? item.filename : '')
    : item.filename;
  let raw = sourceName || `media-${index + 1}.${fallbackExt}`;
  raw = raw.normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/^[. ]+|[. ]+$/g, '').slice(0, 120);
  const extension = raw.match(/\.([a-z0-9]{1,12})$/i)?.[1]?.toLowerCase();
  if (!extension || !knownExtensions.has(extension)) raw = `${raw.replace(/\.[^.]*$/, '') || `media-${index + 1}`}.${fallbackExt}`;
  return raw || `media-${index + 1}.${fallbackExt}`;
}

export async function resolveMedia(conversation, fetchImpl = fetch) {
  const media = Array.isArray(conversation.media) ? conversation.media : [];
  const capturePrefix = globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 8) || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const usedNames = new Set();
  const resolved = [];
  for (let index = 0; index < media.length; index++) {
    const item = { ...media[index] };
    try {
      if (item.error) throw new Error(item.error);
      let bytes, mime;
      if (item.data) {
        bytes = decodeBase64(item.data);
        mime = item.mime || item.resolvedMime || '';
      } else if (item.url?.startsWith('data:')) {
        ({ bytes, mime } = bytesFromDataUrl(item.url));
      } else if (item.url?.startsWith('blob:')) {
        throw new Error('The page-owned blob could not be read during capture. Reload the conversation and retry.');
      } else {
        const url = new URL(item.url);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Unsupported or unsafe media URL.');
        const response = await fetchImpl(url.href, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(15_000) });
        if (!response.ok) throw new Error(`Download failed (${response.status}).`);
        bytes = await readResponse(response);
        mime = (response.headers.get('content-type') || item.mime || 'application/octet-stream').split(';')[0].trim().toLowerCase();
      }
      if (!bytes?.length) throw new Error('Media file is empty.');
      mime = String(mime || item.mime || 'application/octet-stream').split(';')[0].trim().toLowerCase();
      if (!MEDIA_MIME.test(mime)) throw new Error(`Unsupported media type: ${mime}.`);
      if (mime === 'image/svg+xml') bytes = sanitizeSvg(bytes);
      item.mime = mime;
      item.filename = `media-${capturePrefix}-${safeFilename(item, index, mime)}`;
      const ext = item.filename.includes('.') ? item.filename.slice(item.filename.lastIndexOf('.')) : '';
      const stem = ext ? item.filename.slice(0, -ext.length) : item.filename;
      let uniqueName = item.filename;
      for (let suffix = 2; usedNames.has(uniqueName.toLowerCase()); suffix++) uniqueName = `${stem}-${suffix}${ext}`;
      usedNames.add(uniqueName.toLowerCase());
      item.filename = uniqueName;
      item.data = bytesToBase64(bytes);
      item.size = bytes.length;
      delete item.error;
    } catch (error) {
      item.error = error?.message || 'Media could not be downloaded.';
      delete item.data;
    }
    resolved.push(item);
  }
  const failed = resolved.filter(item => item.error);
  const warning = failed.length
    ? `${conversation.warning ? `${conversation.warning} ` : ''}${failed.length} referenced media item${failed.length === 1 ? ' was' : 's were'} unavailable; see the in-place notes.`
    : conversation.warning;
  return { ...conversation, warning, media: resolved };
}

function decodeBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function readResponse(response) {
  if (!response.body?.getReader) {
    const blob = await response.blob();
    return new Uint8Array(await blob.arrayBuffer());
  }
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

function sanitizeSvg(bytes) {
  const source = new TextDecoder().decode(bytes);
  if (typeof DOMParser === 'undefined' || typeof XMLSerializer === 'undefined') throw new Error('SVG image sanitization is unavailable in this browser.');
  const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
  if (doc.querySelector('parsererror, script, style, foreignObject, iframe, object, embed, audio, video, animate, animateMotion, animateTransform, set, link')) throw new Error('Unsafe SVG image was omitted.');
  for (const element of doc.querySelectorAll('*')) for (const attribute of [...element.attributes]) {
    const name = attribute.name.toLowerCase();
    const value = attribute.value.trim();
    const unsafeCssUrl = /url\s*\((?!\s*["']?#[-\w]+["']?\s*\))/i.test(value);
    if (name.startsWith('on') || name === 'style' || (['href', 'xlink:href'].includes(name) && value && !value.startsWith('#')) || unsafeCssUrl || /@import|expression\s*\(/i.test(value)) element.removeAttribute(attribute.name);
  }
  return new TextEncoder().encode(new XMLSerializer().serializeToString(doc.documentElement));
}

export function renderMediaMarkdown(conversation, { includeMediaDirectory = false, flatAssets = false, assetBase = null } = {}) {
  const mediaById = new Map((conversation.media || []).map(item => [item.id, item]));
  const assets = [];
  const messages = conversation.messages.map(message => {
    const body = message.markdown.replace(PLACEHOLDER, (_placeholder, id) => {
      const item = mediaById.get(id);
      if (!item) return `[Media unavailable: reference ${id} was missing from this capture.]`;
      const source = markdownLink(item.url || conversation.url);
      const label = item.alt || item.title || item.filename || item.kind || 'Referenced media';
      if (item.error || !item.data) return `[Media unavailable: ${markdownText(label)} — ${markdownText(item.error || 'file data was not captured')}](${source})`;
      const assetName = flatAssets ? flatCompanionName(item, assetBase) : item.filename;
      const path = assetBase && flatAssets ? kbAssetUrl(assetBase, assetName)
        : (includeMediaDirectory ? `media/${item.filename}` : assetName).split('/').map(encodeURIComponent).join('/');
      assets.push(item);
      return item.kind === 'image' ? `![${markdownText(label)}](${path})` : `[${markdownText(label)}](${path})`;
    });
    return { ...message, markdown: body };
  });
  return { conversation: { ...conversation, messages }, assets };
}

function markdownText(value) { return String(value || '').replace(/[\\\[\]`*_{}<>]/g, ' ').replace(/\s+/g, ' ').trim(); }
function markdownLink(value) { return String(value || '').replace(/[()\\\s]/g, char => encodeURIComponent(char)).replace(/[<>\r\n]/g, ''); }

function kbAssetUrl(assetBase, name) {
  const url = new URL('/knowledge-base/serve', assetBase.appUrl);
  url.searchParams.set('src', String(assetBase.source));
  url.searchParams.set('file', [assetBase.directory, name].filter(Boolean).join('/'));
  return url.href;
}

export function mediaFileEntries(conversation, assetBase = null) {
  const { conversation: rendered, assets } = renderMediaMarkdown(conversation, { flatAssets: true, assetBase });
  const names = new Map(assets.map(item => [item.id, flatCompanionName(item, assetBase)]));
  return [{ name: filename(conversation.title, 'md'), mime: 'text/markdown;charset=utf-8', bytes: new TextEncoder().encode(markdown(rendered)) }, ...assets.map(item => ({ name: names.get(item.id), mime: item.mime, bytes: decodeBase64(item.data) }))];
}

export function mediaArchiveEntries(conversation) {
  const { conversation: rendered, assets } = renderMediaMarkdown(conversation, { includeMediaDirectory: true });
  return [{ name: filename(conversation.title, 'md'), mime: 'text/markdown;charset=utf-8', bytes: new TextEncoder().encode(markdown(rendered)) }, ...assets.map(item => ({ name: `media/${item.filename}`, mime: item.mime, bytes: decodeBase64(item.data) }))];
}

export function mediaCompanionEntries(conversation, { includeImages = false, assetBase = null } = {}) {
  return (conversation.media || [])
    .filter(item => item.data && !item.error && (includeImages || item.kind !== 'image'))
    .map(item => ({ name: assetBase ? flatCompanionName(item, assetBase) : `media/${item.filename}`, mime: item.mime, bytes: decodeBase64(item.data) }));
}

// stamp is unique per export: Rails renames colliding uploads (-2), which would orphan KB links.
function flatCompanionName(item, assetBase) { return `media-${assetBase?.stamp ? `${assetBase.stamp}-` : ''}${String(item.id).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 40)}-${item.filename}`; }

export function pdfMessageContent(message, conversation, assetBase = null) {
  const byId = new Map((conversation.media || []).map(item => [item.id, item]));
  return markdownPdfBlocks(message.markdown, byId, conversation, assetBase);
}

export async function preparePdfMedia(conversation) {
  const media = await Promise.all((conversation.media || []).map(async item => {
    if (item.kind !== 'image' || item.error || !item.data || !item.mime?.startsWith('image/')) return item;
    try {
      const bytes = decodeBase64(item.data);
      const blob = new Blob([bytes], { type: item.mime });
      let bitmap;
      try { bitmap = await createImageBitmap(blob); }
      catch {
        bitmap = await new Promise((resolve, reject) => {
          const url = URL.createObjectURL(blob);
          const image = new Image();
          image.onload = () => { URL.revokeObjectURL(url); resolve({ width: image.naturalWidth, height: image.naturalHeight, image, close() {} }); };
          image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image format could not be decoded for PDF.')); };
          image.src = url;
        });
      }
      if (!bitmap.width || !bitmap.height) { bitmap.close(); throw new Error('Image dimensions are invalid for PDF rendering.'); }
      if ((item.mime === 'image/png' || item.mime === 'image/jpeg') && !item.mime.includes('svg')) {
        bitmap.close();
        return { ...item, pdfData: `data:${item.mime};base64,${item.data}` };
      }
      const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(bitmap.width, bitmap.height) : document.createElement('canvas');
      if (typeof OffscreenCanvas === 'undefined') { canvas.width = bitmap.width; canvas.height = bitmap.height; }
      const context = canvas.getContext('2d');
      if (!context) { bitmap.close(); throw new Error('Image could not be prepared for PDF.'); }
      context.drawImage(bitmap.image || bitmap, 0, 0);
      bitmap.close();
      const output = canvas.convertToBlob ? await canvas.convertToBlob({ type: 'image/png' }) : await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!output) throw new Error('Image could not be prepared for PDF.');
      const encoded = bytesToBase64(new Uint8Array(await output.arrayBuffer()));
      return { ...item, pdfData: `data:image/png;base64,${encoded}` };
    } catch (error) { return { ...item, pdfError: error?.message || 'Image could not be embedded in the PDF.' }; }
  }));
  const failed = media.filter(item => item.pdfError).length;
  return { ...conversation, media, warning: failed ? `${conversation.warning ? `${conversation.warning} ` : ''}${failed} image${failed === 1 ? ' was' : 's were'} unavailable in the PDF.` : conversation.warning };
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) { let c = i; for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[i] = c >>> 0; }
  return table;
})();
function crc32(bytes) { let crc = 0xffffffff; for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
function write16(view, offset, value) { view.setUint16(offset, value, true); }
function write32(view, offset, value) { view.setUint32(offset, value >>> 0, true); }
function write64(view, offset, value) { view.setBigUint64(offset, BigInt(value), true); }

export function makeZip(entries) {
  const encoder = new TextEncoder();
  const local = [], central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const bytes = entry.bytes instanceof Uint8Array ? entry.bytes : new Uint8Array(entry.bytes);
    const crc = crc32(bytes);
    const largeSize = bytes.length >= 0xffffffff;
    const localExtra = largeSize ? new Uint8Array(20) : new Uint8Array(0);
    if (largeSize) { const extra = new DataView(localExtra.buffer); write16(extra, 0, 0x0001); write16(extra, 2, 16); write64(extra, 4, bytes.length); write64(extra, 12, bytes.length); }
    const header = new Uint8Array(30 + name.length + localExtra.length); const view = new DataView(header.buffer);
    write32(view, 0, 0x04034b50); write16(view, 4, 20); write16(view, 6, 0x0800); write16(view, 8, 0);
    if (largeSize) write16(view, 4, 45);
    write32(view, 14, crc); write32(view, 18, largeSize ? 0xffffffff : bytes.length); write32(view, 22, largeSize ? 0xffffffff : bytes.length); write16(view, 26, name.length); write16(view, 28, localExtra.length); header.set(name, 30); header.set(localExtra, 30 + name.length);
    local.push(header, bytes);
    const largeOffset = offset >= 0xffffffff;
    const centralExtra = largeSize || largeOffset ? new Uint8Array(4 + (largeSize ? 16 : 0) + (largeOffset ? 8 : 0)) : new Uint8Array(0);
    if (centralExtra.length) { const extra = new DataView(centralExtra.buffer); write16(extra, 0, 0x0001); write16(extra, 2, centralExtra.length - 4); let cursor = 4; if (largeSize) { write64(extra, cursor, bytes.length); write64(extra, cursor + 8, bytes.length); cursor += 16; } if (largeOffset) write64(extra, cursor, offset); }
    const directory = new Uint8Array(46 + name.length + centralExtra.length); const dv = new DataView(directory.buffer);
    write32(dv, 0, 0x02014b50); write16(dv, 4, 20); write16(dv, 6, 20); write16(dv, 8, 0x0800); write16(dv, 10, 0);
    if (largeSize || largeOffset) { write16(dv, 4, 45); write16(dv, 6, 45); }
    write32(dv, 16, crc); write32(dv, 20, largeSize ? 0xffffffff : bytes.length); write32(dv, 24, largeSize ? 0xffffffff : bytes.length); write16(dv, 28, name.length); write16(dv, 30, centralExtra.length); write32(dv, 42, largeOffset ? 0xffffffff : offset); directory.set(name, 46); directory.set(centralExtra, 46 + name.length);
    central.push(directory); offset += header.length + bytes.length;
  }
  const centralBytes = central.reduce((sum, part) => sum + part.length, 0);
  const needsZip64 = entries.length >= 0xffff || centralBytes >= 0xffffffff || offset >= 0xffffffff;
  const tail = [];
  if (needsZip64) {
    const record = new Uint8Array(56); const rv = new DataView(record.buffer);
    write32(rv, 0, 0x06064b50); write64(rv, 4, 44); write16(rv, 12, 45); write16(rv, 14, 45); write32(rv, 16, 0); write32(rv, 20, 0); write64(rv, 24, entries.length); write64(rv, 32, entries.length); write64(rv, 40, centralBytes); write64(rv, 48, offset);
    const locator = new Uint8Array(20); const lv = new DataView(locator.buffer);
    write32(lv, 0, 0x07064b50); write32(lv, 4, 0); write64(lv, 8, offset + centralBytes); write32(lv, 16, 1);
    tail.push(record, locator);
  }
  const end = new Uint8Array(22); const ev = new DataView(end.buffer);
  write32(ev, 0, 0x06054b50); write16(ev, 8, needsZip64 ? 0xffff : entries.length); write16(ev, 10, needsZip64 ? 0xffff : entries.length); write32(ev, 12, needsZip64 ? 0xffffffff : centralBytes); write32(ev, 16, needsZip64 ? 0xffffffff : offset);
  return new Blob([...local, ...central, ...tail, end], { type: 'application/zip' });
}
