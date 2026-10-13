import pdfMake from 'pdfmake/build/pdfmake.js';
import fonts from 'pdfmake/build/vfs_fonts.js';
import { markdown, filename, bytesToBase64 } from './shared.js';
pdfMake.addVirtualFileSystem(fonts);
const urls = new Set();
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message.target !== 'offscreen') return;
  (async () => {
    if (message.type === 'release') {
      if (urls.has(message.url)) { URL.revokeObjectURL(message.url); urls.delete(message.url); }
      return {};
    }
    const { conversation, format, download } = message;
    const mime = format === 'pdf' ? 'application/pdf' : 'text/markdown;charset=utf-8';
    let bytes;
    if (format === 'pdf') {
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
            { text: m.markdown, preserveLeadingSpaces: true },
          ]),
        ],
      }).getBuffer();
    } else bytes = new TextEncoder().encode(markdown(conversation));
    if (bytes.length > 20 * 1024 * 1024) throw new Error('Export exceeds the 20 MB limit.');
    const result = { name: filename(conversation.title, format), mime, size: bytes.length };
    if (download) {
      result.url = URL.createObjectURL(new Blob([bytes], { type: mime }));
      urls.add(result.url);
      setTimeout(() => { URL.revokeObjectURL(result.url); urls.delete(result.url); }, 10 * 60_000);
    } else result.base64 = bytesToBase64(bytes);
    return result;
  })().then(result => respond({ ok: true, ...result }), error => respond({ ok: false, error: error.message }));
  return true;
});
