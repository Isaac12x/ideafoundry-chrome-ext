import { filename, bytesToBase64 } from './shared.js';
import { resolveMedia, mediaFileEntries, mediaArchiveEntries, makeZip } from './media.js';
import { htmlFile } from './html-export.js';
const urls = new Set();
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message.target !== 'offscreen') return;
  (async () => {
    if (message.type === 'release') {
      if (urls.has(message.url)) { URL.revokeObjectURL(message.url); urls.delete(message.url); }
      return {};
    }
    const { format, download } = message;
    const assetBase = message.assetBase && { ...message.assetBase, stamp: Date.now().toString(36) + crypto.randomUUID().slice(0, 6) };
    let conversation = await resolveMedia(message.conversation);
    const mime = format === 'pdf' ? 'text/html;charset=utf-8' : format === 'html' ? 'text/html;charset=utf-8' : 'text/markdown;charset=utf-8';
    let bytes;
    const mdEntries = format === 'md'
      ? (download ? mediaArchiveEntries(conversation) : mediaFileEntries(conversation, assetBase))
      : null;
    if (format === 'html' || format === 'pdf') {
      bytes = htmlFile(conversation).bytes;
    } else bytes = mdEntries[0].bytes;
    const result = { name: filename(conversation.title, format), mime, size: bytes.length };
    if (download) {
      const mediaEntries = mdEntries || [];
      const companionEntries = [];
      const archiveEntries = format === 'md' ? mediaEntries.filter(entry => entry.name.startsWith('media/')) : companionEntries;
      const archiveFiles = format === 'md' ? mediaEntries : [{ name: result.name, bytes }, ...companionEntries];
      const output = archiveEntries.length
        ? { name: filename(conversation.title, 'zip'), mime: 'application/zip', blob: makeZip(archiveFiles) }
        : { name: result.name, mime, blob: new Blob([bytes], { type: mime }) };
      result.name = output.name;
      result.mime = output.mime;
      result.url = URL.createObjectURL(output.blob);
      urls.add(result.url);
      setTimeout(() => { URL.revokeObjectURL(result.url); urls.delete(result.url); }, 10 * 60_000);
    } else if (format === 'md') {
      result.files = mdEntries.map(entry => ({ name: entry.name, mime: entry.mime, size: entry.bytes.length, base64: bytesToBase64(entry.bytes) }));
    } else if (format === 'html' || format === 'pdf') {
      result.files = [{ name: result.name, mime: result.mime, size: bytes.length, base64: bytesToBase64(bytes) }];
    }
    return result;
  })().then(result => respond({ ok: true, ...result }), error => respond({ ok: false, error: error.message }));
  return true;
});
