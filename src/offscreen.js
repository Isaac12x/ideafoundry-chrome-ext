import pdfMake from 'pdfmake/build/pdfmake.js';
import fonts from 'pdfmake/build/vfs_fonts.js';
import { filename, bytesToBase64 } from './shared.js';
import { resolveMedia, mediaFileEntries, mediaArchiveEntries, mediaCompanionEntries, makeZip, pdfMessageContent, preparePdfMedia } from './media.js';
pdfMake.addVirtualFileSystem(fonts);
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
    const mime = format === 'pdf' ? 'application/pdf' : 'text/markdown;charset=utf-8';
    let bytes;
    const mdEntries = format === 'md' ? mediaFileEntries(conversation, assetBase) : null;
    const mdArchiveEntries = format === 'md' ? mediaArchiveEntries(conversation) : null;
    if (format === 'pdf') {
      conversation = await preparePdfMedia(conversation);
      bytes = await pdfMake.createPdf({
        info: { title: conversation.title, subject: conversation.url, creator: 'IdeaFoundry Conversation Capture' },
        pageSize: 'A4', pageMargins: [44, 48, 44, 48],
        defaultStyle: { font: 'Roboto', fontSize: 10, lineHeight: 1.25 },
        footer: (page, pages) => ({ text: `${page} / ${pages}`, alignment: 'right', margin: [0, 0, 44, 0], fontSize: 8 }),
        content: [
          { text: conversation.title, fontSize: 22, bold: true, margin: [0, 0, 0, 14] },
          { text: conversation.url, link: conversation.url, fontSize: 9, color: '#335d4d' },
          { text: `${conversation.provider} · ${conversation.capturedAt}`, fontSize: 9, margin: [0, 5, 0, 12] },
          { text: conversation.warning, italics: true, fontSize: 8, margin: [0, 0, 0, 16] },
          ...conversation.messages.flatMap(m => [
            { text: m.role, bold: true, fontSize: 13, margin: [0, 14, 0, 6] },
            ...pdfMessageContent(m, conversation, assetBase),
          ]),
        ],
      }).getBuffer();
    } else bytes = mdEntries[0].bytes;
    if (bytes.length > 20 * 1024 * 1024) throw new Error('Export exceeds the 20 MB limit.');
    const result = { name: filename(conversation.title, format), mime, size: bytes.length };
    if (download) {
      const mediaEntries = mdArchiveEntries || [];
      const companionEntries = format === 'pdf' ? mediaCompanionEntries(conversation, { assetBase }) : [];
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
    } else {
      const entries = [{ name: result.name, mime: result.mime, bytes }, ...mediaCompanionEntries(conversation, { assetBase })];
      result.files = entries.map(entry => ({ name: entry.name, mime: entry.mime, size: entry.bytes.length, base64: bytesToBase64(entry.bytes) }));
    }
    return result;
  })().then(result => respond({ ok: true, ...result }), error => respond({ ok: false, error: error.message }));
  return true;
});
