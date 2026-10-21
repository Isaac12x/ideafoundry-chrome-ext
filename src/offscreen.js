import { filename, bytesToBase64 } from './shared.js';
import { resolveMedia, mediaFileEntries, mediaArchiveEntries, makeZip } from './media.js';
import { htmlFile } from './html-export.js';
import pdfMake from 'pdfmake/build/pdfmake.js';
import fonts from 'pdfmake/build/vfs_fonts.js';
import { pdfMessageContent, preparePdfMedia, mediaCompanionEntries } from './media.js';
pdfMake.addVirtualFileSystem(fonts);

async function pdfFile(conversation, assetBase) {
  conversation = await preparePdfMedia(conversation);
  const content = [
    { text: conversation.title || 'Conversation', style: 'title' },
    { text: `Source: ${conversation.url || ''}\nCaptured: ${conversation.capturedAt || ''} · ${conversation.provider || ''}`, style: 'provenance' },
    ...(conversation.warning ? [{ text: conversation.warning, style: 'warning' }] : []),
  ];
  for (const message of conversation.messages || []) {
    content.push({ text: message.role || 'Message', style: 'speaker' });
    content.push(...pdfMessageContent(message, conversation, assetBase));
  }
  const bytes = await pdfMake.createPdf({
    pageSize: 'A4', pageMargins: [42, 48, 42, 48], content,
    defaultStyle: { font: 'Roboto', fontSize: 10, lineHeight: 1.25 },
    styles: {
      title: { fontSize: 19, bold: true, margin: [0, 0, 0, 8] },
      provenance: { fontSize: 8, color: '#52615a', margin: [0, 0, 0, 12] },
      warning: { fontSize: 8, color: '#8a4b18', margin: [0, 0, 0, 10] },
      speaker: { fontSize: 12, bold: true, color: '#263b31', margin: [0, 8, 0, 5] },
    },
  }).getBuffer();
  return { name: filename(conversation.title, 'pdf'), mime: 'application/pdf', bytes: new Uint8Array(bytes) };
}
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
    const mime = format === 'pdf' ? 'application/pdf' : format === 'html' ? 'text/html;charset=utf-8' : 'text/markdown;charset=utf-8';
    let bytes;
    let resultName;
    const mdEntries = format === 'md' ? mediaFileEntries(conversation, assetBase) : null;
    const mdArchiveEntries = format === 'md' ? mediaArchiveEntries(conversation) : null;
    if (format === 'pdf') {
      const pdf = await pdfFile(conversation, assetBase);
      bytes = pdf.bytes;
      resultName = pdf.name;
    } else if (format === 'html') {
      bytes = htmlFile(conversation).bytes;
    } else bytes = mdEntries[0].bytes;
    if (bytes.length > 20 * 1024 * 1024) throw new Error('Export exceeds the 20 MB limit.');
    const result = { name: resultName || filename(conversation.title, format), mime, size: bytes.length };
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
    } else if (format === 'pdf' || format === 'html') {
      const attachments = format === 'pdf' ? mediaCompanionEntries(conversation, { assetBase }) : [];
      result.files = [{ name: result.name, mime: result.mime, size: bytes.length, base64: bytesToBase64(bytes) }, ...attachments.map(entry => ({ name: entry.name, mime: entry.mime, size: entry.bytes.length, base64: bytesToBase64(entry.bytes) }))];
    }
    return result;
  })().then(result => respond({ ok: true, ...result }), error => respond({ ok: false, error: error.message }));
  return true;
});
