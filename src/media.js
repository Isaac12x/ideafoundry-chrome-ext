import { bytesToBase64, filename, markdown } from './shared.js';

export const MEDIA_MAX_ITEM_BYTES = 8 * 1024 * 1024;
export const MEDIA_MAX_TOTAL_BYTES = 20 * 1024 * 1024;
export const MEDIA_MAX_COUNT = 50;
const MEDIA_MIME = /^(image\/(png|jpeg|gif|webp|avif|svg\+xml|bmp|tiff?)|audio\/[\w.+-]+|video\/[\w.+-]+|application\/(pdf|octet-stream|zip|msword|rtf|json|xml|vnd\.[\w.+-]+)|text\/(plain|markdown|csv))$/i;
const PLACEHOLDER = /\{\{idea-media:([a-zA-Z0-9_-]{1,100})\}\}/g;

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
  if (base64) bytes = Uint8Array.from(atob(match[2]), char => char.charCodeAt(0));
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
  if (media.length > MEDIA_MAX_COUNT) throw new Error(`This capture has more than ${MEDIA_MAX_COUNT} media items. Select fewer sections and retry.`);
  let total = 0;
  const capturePrefix = globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 8) || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const usedNames = new Set();
  const resolved = [];
  for (let index = 0; index < media.length; index++) {
    const item = { ...media[index] };
    try {
      if (item.error) throw new Error(item.error);
      if (total >= MEDIA_MAX_TOTAL_BYTES) throw new Error('Media exceeds the 20 MB total export limit.');
      const remaining = MEDIA_MAX_TOTAL_BYTES - total;
      const itemLimit = Math.min(MEDIA_MAX_ITEM_BYTES, remaining);
      let bytes, mime;
      if (item.data) {
        if (item.data.length > Math.ceil(itemLimit * 4 / 3) + 8) throw new Error(itemLimit < MEDIA_MAX_ITEM_BYTES ? 'Media exceeds the 20 MB total export limit.' : 'Media exceeds the 8 MB per-file limit.');
        bytes = Uint8Array.from(atob(item.data), char => char.charCodeAt(0));
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
        const length = Number(response.headers.get('content-length'));
        if (Number.isFinite(length) && length > itemLimit) throw new Error(itemLimit < MEDIA_MAX_ITEM_BYTES ? 'Media exceeds the 20 MB total export limit.' : 'Media exceeds the 8 MB per-file limit.');
        bytes = await readBounded(response, itemLimit, amount => { total += amount; });
        mime = (response.headers.get('content-type') || item.mime || 'application/octet-stream').split(';')[0].trim().toLowerCase();
      }
      if (!bytes?.length) throw new Error('Media file is empty.');
      if (bytes.length > MEDIA_MAX_ITEM_BYTES) throw new Error('Media exceeds the 8 MB per-file limit.');
      if (!(!item.data && !item.url?.startsWith('data:') && !item.url?.startsWith('blob:'))) total += bytes.length;
      if (total > MEDIA_MAX_TOTAL_BYTES) { total = MEDIA_MAX_TOTAL_BYTES; throw new Error('Media exceeds the 20 MB total export limit.'); }
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
      if (item.error.includes('20 MB total')) total = MEDIA_MAX_TOTAL_BYTES;
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

async function readBounded(response, limit, onBytes = () => {}) {
  const limitMessage = limit < MEDIA_MAX_ITEM_BYTES ? 'Media exceeds the 20 MB total export limit.' : 'Media exceeds the 8 MB per-file limit.';
  if (!response.body?.getReader) {
    const blob = await response.blob();
    onBytes(blob.size);
    if (blob.size > limit) throw new Error(limitMessage);
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
      onBytes(value.byteLength);
      if (length > limit) {
        await reader.cancel();
        if (limit < MEDIA_MAX_ITEM_BYTES && length > limit) onBytes(0); // caller is stopped by the exhausted budget below
        throw new Error(limitMessage);
      }
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
    if (name.startsWith('on') || name === 'style' || (['href', 'xlink:href'].includes(name) && value && !value.startsWith('#')) || /url\s*\(|@import|expression\s*\(/i.test(value)) element.removeAttribute(attribute.name);
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
      const assetName = flatAssets ? `media-${String(item.id).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 40)}-${item.filename}` : item.filename;
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
  const names = new Map(assets.map(item => [item.id, flatCompanionName(item)]));
  return [{ name: filename(conversation.title, 'md'), mime: 'text/markdown;charset=utf-8', bytes: new TextEncoder().encode(markdown(rendered)) }, ...assets.map(item => ({ name: names.get(item.id), mime: item.mime, bytes: Uint8Array.from(atob(item.data), c => c.charCodeAt(0)) }))];
}

export function mediaArchiveEntries(conversation) {
  const { conversation: rendered, assets } = renderMediaMarkdown(conversation, { includeMediaDirectory: true });
  return [{ name: filename(conversation.title, 'md'), mime: 'text/markdown;charset=utf-8', bytes: new TextEncoder().encode(markdown(rendered)) }, ...assets.map(item => ({ name: `media/${item.filename}`, mime: item.mime, bytes: Uint8Array.from(atob(item.data), c => c.charCodeAt(0)) }))];
}

export function mediaCompanionEntries(conversation, { includeImages = false, assetBase = null } = {}) {
  return (conversation.media || [])
    .filter(item => item.data && !item.error && (includeImages || item.kind !== 'image'))
    .map(item => ({ name: assetBase ? flatCompanionName(item) : `media/${item.filename}`, mime: item.mime, bytes: Uint8Array.from(atob(item.data), c => c.charCodeAt(0)) }));
}

function flatCompanionName(item) { return `media-${String(item.id).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 40)}-${item.filename}`; }

export function pdfMessageContent(message, conversation, assetBase = null) {
  const byId = new Map((conversation.media || []).map(item => [item.id, item]));
  const content = [];
  let last = 0;
  let match;
  PLACEHOLDER.lastIndex = 0;
  while ((match = PLACEHOLDER.exec(message.markdown))) {
    const before = message.markdown.slice(last, match.index);
    if (before) content.push({ text: before, preserveLeadingSpaces: true });
    const item = byId.get(match[1]);
    if (item?.kind === 'image' && item.pdfData) {
      content.push({ image: item.pdfData, width: 460, fit: [460, 640], margin: [0, 8, 0, 8] });
    } else if (item) {
      const label = item.alt || item.title || item.filename || item.kind || 'Referenced media';
      const source = item.url || conversation.url;
      if (item.error || item.pdfError || !item.data) {
        content.push({ text: `Media unavailable: ${item.error || item.pdfError || 'file data was not captured'} — ${label}`, link: source, color: '#335d4d', margin: [0, 4, 0, 4] });
      } else {
        const name = assetBase ? flatCompanionName(item) : `media/${item.filename}`;
        if (assetBase) content.push({ text: `${item.kind || 'Media'} companion: ${name}`, link: kbAssetUrl(assetBase, name), color: '#335d4d', margin: [0, 4, 0, 1] });
        else content.push({ text: `${item.kind || 'Media'} companion: ${name}`, margin: [0, 4, 0, 1] });
        content.push({ text: `Original source: ${source}`, link: source, color: '#335d4d', fontSize: 8, margin: [0, 0, 0, 4] });
      }
    } else content.push({ text: 'Media unavailable: reference missing from this capture.', italics: true });
    last = PLACEHOLDER.lastIndex;
  }
  const after = message.markdown.slice(last);
  if (after) content.push({ text: after, preserveLeadingSpaces: true });
  return content.length ? content : [{ text: message.markdown, preserveLeadingSpaces: true }];
}

export async function preparePdfMedia(conversation) {
  const media = await Promise.all((conversation.media || []).map(async item => {
    if (item.kind !== 'image' || item.error || !item.data || !item.mime?.startsWith('image/')) return item;
    try {
      const bytes = Uint8Array.from(atob(item.data), c => c.charCodeAt(0));
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
      if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 20_000_000) { bitmap.close(); throw new Error('Image dimensions exceed the PDF limit.'); }
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
      if (output.size > MEDIA_MAX_ITEM_BYTES) throw new Error('Rasterized image exceeds the 8 MB PDF limit.');
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

export function makeZip(entries) {
  const encoder = new TextEncoder();
  const local = [], central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const bytes = entry.bytes instanceof Uint8Array ? entry.bytes : new Uint8Array(entry.bytes);
    const crc = crc32(bytes);
    const header = new Uint8Array(30 + name.length); const view = new DataView(header.buffer);
    write32(view, 0, 0x04034b50); write16(view, 4, 20); write16(view, 6, 0x0800); write16(view, 8, 0);
    write32(view, 14, crc); write32(view, 18, bytes.length); write32(view, 22, bytes.length); write16(view, 26, name.length); header.set(name, 30);
    local.push(header, bytes);
    const directory = new Uint8Array(46 + name.length); const dv = new DataView(directory.buffer);
    write32(dv, 0, 0x02014b50); write16(dv, 4, 20); write16(dv, 6, 20); write16(dv, 8, 0x0800); write16(dv, 10, 0);
    write32(dv, 16, crc); write32(dv, 20, bytes.length); write32(dv, 24, bytes.length); write16(dv, 28, name.length); write32(dv, 42, offset); directory.set(name, 46);
    central.push(directory); offset += header.length + bytes.length;
  }
  const centralBytes = central.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22); const ev = new DataView(end.buffer);
  write32(ev, 0, 0x06054b50); write16(ev, 8, entries.length); write16(ev, 10, entries.length); write32(ev, 12, centralBytes); write32(ev, 16, offset);
  return new Blob([...local, ...central, end], { type: 'application/zip' });
}
