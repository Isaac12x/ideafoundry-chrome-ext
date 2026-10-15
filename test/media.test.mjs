import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { mediaFileEntries, mediaCompanionEntries, makeZip, mediaOrigins, pdfMessageContent, renderMediaMarkdown, resolveMedia } from '../src/media.js';
import { markdown } from '../src/shared.js';
import pdfMake from 'pdfmake/build/pdfmake.js';
import fonts from 'pdfmake/build/vfs_fonts.js';
pdfMake.addVirtualFileSystem(fonts);

const imageData = Buffer.from([137, 80, 78, 71]).toString('base64');
const conversation = media => ({
  title: 'A capture', url: 'https://chatgpt.com/c/1', provider: 'ChatGPT', capturedAt: '2026-01-01T00:00:00.000Z',
  messages: [{ role: 'Assistant', markdown: `Before\n\n{{idea-media:${media[0].id}}}\n\nAfter` }], media,
});

test('media host permissions cover credential-free HTTP(S) origins only', () => {
  const input = conversation([
    { id: 'https', url: 'https://cdn.example/path/image.png' },
    { id: 'http', url: 'http://assets.example/file' },
    { id: 'credentials', url: 'https://user:secret@cdn.example/private.png' },
    { id: 'blob', url: 'blob:https://chatgpt.com/id' },
    { id: 'data', url: 'data:image/png;base64,AAAA' },
  ]);
  assert.deepEqual(mediaOrigins(input), ['https://cdn.example/*', 'http://assets.example/*']);
});

test('data URL media resolves, stays at its message position, and becomes companion files', async () => {
  const input = conversation([{ id: 'img1', kind: 'image', url: `data:image/png;base64,${imageData}`, alt: 'chart', filename: 'chart.png' }]);
  const resolved = await resolveMedia(input);
  const rendered = renderMediaMarkdown(resolved, { includeMediaDirectory: true });
  assert.match(rendered.conversation.messages[0].markdown, /Before[\s\S]*!\[chart\]\(media\/media-[a-z0-9]+-chart\.png\)[\s\S]*After/);
  const files = mediaFileEntries(resolved);
  assert.equal(files.length, 2);
  assert.match(files[1].name, /^media-img1-media-[a-z0-9]+-chart\.png$/i);
  assert.deepEqual([...files[1].bytes], [137, 80, 78, 71]);
});

test('ordinary anchors remain web links while media placeholders receive explicit Markdown', () => {
  const input = conversation([{ id: 'img1', kind: 'image', url: 'https://cdn.example/chart.png', alt: 'chart' }]);
  input.messages[0].markdown = '[Reference](https://example.com/page) and {{idea-media:img1}}';
  const preview = markdown(input);
  assert.match(preview, /\[Reference\]\(https:\/\/example\.com\/page\)/);
  assert.match(preview, /!\[chart\]\(https:\/\/cdn\.example\/chart\.png\)/);
  assert.doesNotMatch(preview, /idea-media/);
});

test('percent-encoded Unicode survives SVG data URL decoding and sanitization', async () => {
  const dom = new JSDOM('');
  const previous = { DOMParser: globalThis.DOMParser, XMLSerializer: globalThis.XMLSerializer };
  globalThis.DOMParser = dom.window.DOMParser;
  globalThis.XMLSerializer = dom.window.XMLSerializer;
  try {
    const source = '<svg xmlns="http://www.w3.org/2000/svg"><text>café</text></svg>';
    const input = conversation([{ id: 'svg1', kind: 'image', url: `data:image/svg+xml,${encodeURIComponent(source)}`, filename: 'chart.svg' }]);
    const resolved = await resolveMedia(input);
    const saved = new TextDecoder().decode(Uint8Array.from(atob(resolved.media[0].data), c => c.charCodeAt(0)));
    assert.match(saved, /café/);
  } finally {
    if (previous.DOMParser === undefined) delete globalThis.DOMParser; else globalThis.DOMParser = previous.DOMParser;
    if (previous.XMLSerializer === undefined) delete globalThis.XMLSerializer; else globalThis.XMLSerializer = previous.XMLSerializer;
    dom.window.close();
  }
});

test('SVG data URLs with charset parameters decode and sanitize', async () => {
  const dom = new JSDOM('');
  const previous = { DOMParser: globalThis.DOMParser, XMLSerializer: globalThis.XMLSerializer };
  globalThis.DOMParser = dom.window.DOMParser;
  globalThis.XMLSerializer = dom.window.XMLSerializer;
  try {
    const source = '<svg xmlns="http://www.w3.org/2000/svg"><text>Chart</text></svg>';
    const input = conversation([{ id: 'svg-charset', kind: 'image', url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}` }]);
    const resolved = await resolveMedia(input);
    const saved = new TextDecoder().decode(Uint8Array.from(atob(resolved.media[0].data), c => c.charCodeAt(0)));
    assert.equal(resolved.media[0].mime, 'image/svg+xml');
    assert.match(saved, /Chart/);
  } finally {
    if (previous.DOMParser === undefined) delete globalThis.DOMParser; else globalThis.DOMParser = previous.DOMParser;
    if (previous.XMLSerializer === undefined) delete globalThis.XMLSerializer; else globalThis.XMLSerializer = previous.XMLSerializer;
    dom.window.close();
  }
});

test('HTTP media without a filename extension uses its MIME extension', async () => {
  const input = conversation([{ id: 'endpoint', kind: 'image', url: 'https://cdn.example/download?id=chart' }]);
  const resolved = await resolveMedia(input, async () => new Response(new Uint8Array([1, 2]), { headers: { 'content-type': 'image/png' } }));
  assert.match(resolved.media[0].filename, /\.png$/);
});

test('repeated exports use unique companion names and Markdown links match those names', async () => {
  const input = conversation([{ id: 'chart', kind: 'image', url: `data:image/png;base64,${imageData}`, filename: 'chart.png' }]);
  const first = await resolveMedia(input);
  const second = await resolveMedia(input);
  const firstMarkdown = new TextDecoder().decode(mediaFileEntries(first)[0].bytes);
  const secondMarkdown = new TextDecoder().decode(mediaFileEntries(second)[0].bytes);
  const firstName = mediaFileEntries(first)[1].name;
  const secondName = mediaFileEntries(second)[1].name;
  assert.notEqual(firstName, secondName);
  assert.ok(firstMarkdown.includes(`(${firstName})`));
  assert.ok(secondMarkdown.includes(`(${secondName})`));
  assert.equal(mediaCompanionEntries(first, { includeImages: true })[0].name, `media/${first.media[0].filename}`);
});

test('KB Markdown links point to the exact uploaded flat asset and encode source and directory', async () => {
  const input = conversation([{ id: 'chart', kind: 'image', url: `data:image/png;base64,${imageData}`, filename: 'chart.png' }]);
  const resolved = await resolveMedia(input);
  const files = mediaFileEntries(resolved, { appUrl: 'https://ideas.local:8443', source: 7, directory: 'Research/Ideas' });
  const text = new TextDecoder().decode(files[0].bytes);
  const link = text.match(/!\[[^\]]+\]\(([^)]+)\)/)?.[1];
  assert.ok(link);
  const parsed = new URL(link);
  assert.equal(parsed.origin, 'https://ideas.local:8443');
  assert.equal(parsed.pathname, '/knowledge-base/serve');
  assert.equal(parsed.searchParams.get('src'), '7');
  assert.equal(parsed.searchParams.get('file'), `Research/Ideas/${files[1].name}`);
});

test('all failed media exports only Markdown with visible unavailable notes', async () => {
  const input = conversation([{ id: 'bad', kind: 'image', url: 'https://cdn.example/missing.png', error: 'No access.' }]);
  const resolved = await resolveMedia(input);
  const files = mediaFileEntries(resolved);
  assert.equal(files.length, 1);
  assert.match(new TextDecoder().decode(files[0].bytes), /Media unavailable/);
  assert.doesNotMatch(new TextDecoder().decode(files[0].bytes), /\{\{idea-media:/);
});

test('fetch media is bounded and records a visible failure instead of buffering an oversized body', async () => {
  const fetchImpl = async () => new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/png', 'content-length': String(8 * 1024 * 1024 + 1) } });
  const input = conversation([{ id: 'large', kind: 'image', url: 'https://cdn.example/large.png' }]);
  const resolved = await resolveMedia(input, fetchImpl);
  assert.match(resolved.media[0].error, /8 MB/);
  assert.match(new TextDecoder().decode(mediaFileEntries(resolved)[0].bytes), /Media unavailable/);
});

test('aggregate retrieval budget includes streamed bytes from failed attempts and stops later downloads', async () => {
  const chunk = new Uint8Array(8 * 1024 * 1024);
  const media = [0, 1, 2, 3].map(index => ({ id: `m${index}`, kind: 'image', url: `https://cdn.example/${index}.png` }));
  const input = conversation(media);
  let calls = 0;
  let cancelled = false;
  const fetchImpl = async () => {
    const call = calls++;
    const stream = call < 2
      ? new ReadableStream({ start(controller) { controller.enqueue(chunk); controller.close(); } })
      : new ReadableStream({
        start(controller) { controller.enqueue(new Uint8Array(4 * 1024 * 1024)); controller.enqueue(new Uint8Array([1])); },
        cancel() { cancelled = true; },
      });
    return new Response(stream, { headers: { 'content-type': 'image/png' } });
  };
  const resolved = await resolveMedia(input, fetchImpl);
  assert.equal(calls, 3, 'no fourth request starts after the aggregate budget is spent');
  assert.equal(cancelled, true, 'the response stream that crosses the remaining budget is cancelled');
  assert.match(resolved.media[2].error, /20 MB total/);
  assert.match(resolved.media[3].error, /20 MB total/);
});

test('PDF content keeps surrounding text around an inline image resource', () => {
  const input = conversation([{ id: 'img1', kind: 'image', data: imageData, mime: 'image/png', url: 'https://cdn.example/chart.png' }]);
  const parts = pdfMessageContent(input.messages[0], { ...input, media: [{ ...input.media[0], pdfData: `data:image/png;base64,${imageData}` }] });
  assert.deepEqual(parts.map(part => part.image ? 'image' : part.text.map(run => run.text).join('').trim()), ['Before', 'image', 'After']);
  assert.match(parts[1].image, /^data:image\/png;base64,/);
});

test('PDF turns Markdown tables, emphasis, headings, links and lists into semantic pdfmake nodes', () => {
  const input = conversation([{ id: 'unused', kind: 'file', url: 'https://cdn.example/doc.pdf' }]);
  input.messages[0].markdown = '# Findings\n\nA **bold** and *italic* [source](https://example.com).\n\n| Name | Count |\n|---|---:|\n| Alpha | 3 |\n\n- one\n- two';
  const content = pdfMessageContent(input.messages[0], input);
  assert.equal(content[0].fontSize, 18);
  assert.ok(content[1].text.some(run => run.text === 'bold' && run.bold));
  assert.ok(content[1].text.some(run => run.text === 'italic' && run.italics));
  assert.ok(content[1].text.some(run => run.text === 'source' && run.link === 'https://example.com'));
  const table = content.find(item => item.table);
  assert.ok(table);
  assert.deepEqual(table.table.body.map(row => row.map(cell => cell.text.map(run => run.text).join(''))), [['Name', 'Count'], ['Alpha', '3']]);
  assert.ok(content.some(item => item.ul?.length === 2));
});

test('PDF generation accepts rendered Markdown and keeps image placeholders inside table cells readable', async () => {
  const input = conversation([{ id: 'chart', kind: 'image', url: 'https://cdn.example/chart.png', alt: 'Chart' }]);
  input.messages[0].markdown = '| Item | Detail |\n|---|---|\n| Graph | {{idea-media:chart}} |\n\n**Done**';
  const content = pdfMessageContent(input.messages[0], input);
  assert.ok(content[0].table);
  assert.ok(content[0].table.body[1][1].text.some(run => /Media unavailable: file data was not captured/.test(run.text) && run.link === 'https://cdn.example/chart.png'));
  const buffer = await pdfMake.createPdf({ defaultStyle: { font: 'Roboto' }, content }).getBuffer();
  assert.ok(buffer.length > 1000);
});

test('PDF references local companion paths and KB companion URLs using the uploaded filename', () => {
  const item = { id: 'doc1', kind: 'file', filename: 'media-capture-report.pdf', mime: 'application/pdf', data: imageData, url: 'https://cdn.example/report.pdf' };
  const input = conversation([item]);
  const message = input.messages[0];
  const local = pdfMessageContent(message, { ...input, media: [item] });
  assert.match(local[1].text, /companion: media\/media-capture-report\.pdf/);
  assert.equal(local[2].link, item.url);

  const assetBase = { appUrl: 'https://ideas.local:8443', source: 2, directory: 'Research' };
  const remote = pdfMessageContent(message, { ...input, media: [item] }, assetBase);
  const uploadedName = mediaCompanionEntries({ ...input, media: [item] }, { assetBase })[0].name;
  const link = new URL(remote[1].link);
  assert.equal(link.searchParams.get('file'), `Research/${uploadedName}`);
  assert.match(remote[1].text, new RegExp(uploadedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('PDF keeps table media embedded and preserves code, nested lists, list starts, and following content', async () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
  const item = { id: 'chart', kind: 'image', filename: 'chart.png', mime: 'image/png', data: png, pdfData: `data:image/png;base64,${png}`, url: 'https://cdn.example/chart.png', alt: 'Chart' };
  const input = conversation([item]);
  input.messages[0].markdown = [
    '| Item | Detail |', '|---|---|', '| Graph | before {{idea-media:chart}} after |', '',
    '```js', 'const literal = "{{idea-media:chart}}";', '```', '',
    '3. first', '   - nested', '   - second nested', '4. second', '',
    'After the list.',
  ].join('\n');
  const content = pdfMessageContent(input.messages[0], input);
  const table = content.find(block => block.table);
  assert.ok(table, 'table remains a semantic pdfmake table');
  const cell = table.table.body[1][1];
  assert.ok(cell.stack.some(block => block.image?.startsWith('data:image/png;base64,')), 'image stays in its table cell');
  assert.ok(cell.stack.some(block => block.text?.some(run => run.text === 'before ')));
  assert.ok(cell.stack.some(block => block.text?.some(run => run.text === ' after')));
  const code = content.find(block => block.fontSize === 8 && block.text === 'const literal = "{{idea-media:chart}}";');
  assert.ok(code, 'placeholder-looking code remains literal code');
  const ordered = content.find(block => block.ol);
  assert.ok(ordered);
  assert.equal(ordered.start, 3, 'ordered list start is retained');
  assert.ok(ordered.ol.length === 2);
  assert.ok(ordered.ol[0].stack?.some(block => block.ul?.length === 2), 'nested list items are attached to the correct parent');
  assert.ok(content.some(block => block.text?.some?.(run => run.text === 'After the list.')), 'content after nested lists is retained');
  const buffer = await pdfMake.createPdf({ defaultStyle: { font: 'Roboto' }, content }).getBuffer();
  assert.ok(buffer.length > 1000, 'pdfmake successfully renders the mixed document');
});

test('local media ZIP includes the Markdown and relative companion paths', async () => {
  const files = [{ name: 'capture.md', bytes: new TextEncoder().encode('![](media/chart.png)') }, { name: 'media/chart.png', bytes: new Uint8Array([1, 2, 3]) }];
  const zip = makeZip(files);
  const bytes = new Uint8Array(await zip.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  const text = new TextDecoder().decode(bytes);
  assert.match(text, /capture\.md/);
  assert.match(text, /media\/chart\.png/);
});
