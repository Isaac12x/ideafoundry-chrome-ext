import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { extractConversation } from '../src/extract.js';
import { conversationHtml } from '../src/html-export.js';

test('layout snapshot exports sanitized computed presentation only when requested', () => {
  const dom = new JSDOM(`<!doctype html><title>Styled Chat - ChatGPT</title><style>.idea-capture-section-collapsed{display:none!important}.chart{fill:rgb(20, 80, 40)}main{background-image:linear-gradient(white, #eee)}</style><main style="display:flex;gap:17px;height:2400px;min-height:1900px"><section style="display:grid;grid-template-columns:1fr 2fr"><div class="idea-capture-section-collapsed" data-message-author-role="user" style="color: rgb(12, 34, 56); background-color: rgb(230, 240, 250); padding: 9px"><p style="font-weight: 700">Question</p><button>Copy</button><script>steal()</script></div><div data-message-author-role="assistant"><pre><code>const answer = 42;</code></pre><svg viewBox="0 0 20 20" aria-label="Chart"><path class="chart" d="M0 0L20 20"/></svg></div><aside>Unrelated sidebar content</aside></section></main>`, { url: 'https://chatgpt.com/c/123' });
  const ordinary = extractConversation(dom.window.document, dom.window.location.href);
  const layout = extractConversation(dom.window.document, dom.window.location.href, { includeLayout: true });
  assert.equal(ordinary.messages[0].html, undefined, 'routine capture does not retain layout snapshots');
  assert.match(layout.messages[0].html, /color:rgb\(12, 34, 56\)/);
  assert.match(layout.messages[0].html, /background-color:rgb\(230, 240, 250\)/);
  assert.match(layout.messages[0].html, /font-weight:700/);
  assert.doesNotMatch(layout.messages[0].html, /<button|<script|steal\(/);
  assert.match(layout.layoutHtml, /display:flex/);
  assert.match(layout.layoutHtml, /display:grid/);
  assert.match(layout.layoutHtml, /background-image:linear-gradient\(white, rgb\(238, 238, 238\)\)/, 'computed gradients survive in the portable snapshot');
  assert.match(layout.layoutHtml, /<svg/, 'inline chart SVG survives layout export');
  assert.match(layout.layoutHtml, /stroke|fill/, 'SVG paint styles are copied into the diagram');
  assert.match(layout.layoutHtml, /height:auto/);
  assert.doesNotMatch(layout.layoutHtml, /Unrelated sidebar/);
  assert.match(layout.layoutHtml, /data-idea-export-section=/);
  assert.match(layout.layoutHtml, /Question/, 'the shared layout tree retains selected message text');
  assert.doesNotMatch(layout.layoutHtml, /display:none/);
  assert.ok(dom.window.document.querySelector('[data-message-author-role="user"]').classList.contains('idea-capture-section-collapsed'), 'snapshot measurement restores collapse state after capture');
});

test('standalone HTML embeds media, retains code, selection content and provenance', () => {
  const dom = new JSDOM('');
  globalThis.DOMParser = dom.window.DOMParser;
  const output = conversationHtml({
    title: 'A <study>', url: 'https://chatgpt.com/c/123', provider: 'ChatGPT', capturedAt: '2026-10-21T10:00:00.000Z',
    layoutHtml: '<div style="display:grid"><div aria-label="Assistant"><pre style="white-space:pre-wrap"><code>const x = 1;</code></pre><p>{{idea-media:media-0-0}}</p><p>{{idea-media:media-0-1}}</p><p>{{idea-media:media-0-2}}</p><a href="data:audio/mpeg;base64,YXVkaW8=" download="clip.mp3">clip.mp3</a></div></div>',
    messages: [{ role: 'Assistant', html: '<pre style="white-space:pre-wrap"><code>const x = 1;</code></pre><p>{{idea-media:media-0-0}}</p>' }],
    media: [
      { id: 'media-0-0', kind: 'image', mime: 'image/png', data: 'aGVsbG8=', alt: 'Chart' },
      { id: 'media-0-1', kind: 'audio', mime: 'audio/mpeg', data: 'YXVkaW8=', filename: 'voice.mp3' },
      { id: 'media-0-2', kind: 'video', mime: 'video/mp4', data: 'dmlkZW8=', filename: 'clip.mp4', layoutStyle: 'width:320px;height:180px' },
    ],
  });
  assert.match(output, /data:image\/png;base64,aGVsbG8=/);
  assert.match(output, /href="data:audio\/mpeg;base64,YXVkaW8=" download="clip\.mp3"/);
  assert.match(output, /<audio controls="" preload="metadata" src="data:audio\/mpeg;base64,YXVkaW8="/);
  assert.match(output, /<video controls="" preload="metadata" src="data:video\/mp4;base64,dmlkZW8=" style="width:320px;height:180px"><\/video>/);
  assert.match(output, /download="voice\.mp3" aria-label="Download audio"/);
  assert.match(output, /media-src data:/);
  assert.doesNotMatch(output, /src="https?:/i, 'remote media sources are not retained');
  assert.match(output, /const x = 1/);
  assert.match(output, /display:grid/);
  assert.match(output, /Source: <a href="https:\/\/chatgpt.com\/c\/123">/);
  assert.match(output, /Captured: 2026-10-21T10:00:00.000Z/);
  assert.match(output, /Content-Security-Policy/);
  assert.doesNotMatch(output, /idea-media:|<script/);
});

test('standalone HTML drops active content and remote resources while retaining normal links', () => {
  const dom = new JSDOM('');
  globalThis.DOMParser = dom.window.DOMParser;
  const output = conversationHtml({
    title: 'Safety', url: 'https://chatgpt.com/c/123', capturedAt: 'now',
    layoutHtml: `<main><script>steal()</script><iframe src="https://evil.test"></iframe><meta http-equiv="refresh" content="0;url=https://evil.test"><img src="https://evil.test/image.png" onerror="steal()"><a href="javascript:steal()" onclick="steal()">bad</a><a href="https://example.com/source">source</a><a href="#answer">answer</a><a href="data:image/svg+xml;base64,PHN2Zy8+" download="bad.svg">unsafe svg</a><div style="color:red;background-image:url(https://evil.test/x)">safe text</div><p id="answer">Answer</p></main>`,
    messages: [], media: [],
  });
  assert.doesNotMatch(output, /steal\(|<iframe|http-equiv="refresh"|evil\.test|javascript:|href="data:image\/svg/i);
  assert.match(output, /href="https:\/\/example\.com\/source"/);
  assert.match(output, /href="#answer"/);
  assert.match(output, /safe text/);
});

test('standalone HTML preserves native disclosures and safe control state without restoring forms', () => {
  const dom = new JSDOM('');
  globalThis.DOMParser = dom.window.DOMParser;
  const output = conversationHtml({
    title: 'Controls', url: 'https://chatgpt.com/c/123', capturedAt: 'now',
    layoutHtml: `<details open><summary>Reasoning</summary><p>Visible content</p></details><label><input type="checkbox" checked disabled> Done</label><label><input type="radio" name="choice" value="a" checked> A</label><label><input type="radio" name="choice" value="b"> B</label><input type="text" value="draft"><input type="password" value="secret"><form action="https://evil.test"><button>Submit</button><select><option selected>One</option></select></form>`,
    messages: [], media: [],
  });
  assert.match(output, /<details open(?:="")?>/);
  assert.match(output, /<summary>Reasoning<\/summary>/);
  assert.match(output, /type="checkbox" checked(?:="")? disabled(?:="")?/);
  assert.match(output, /type="radio" name="idea-export-radio-\d+" value="a" checked(?:="")?/);
  assert.match(output, /type="text" value="draft"/);
  assert.match(output, /<select><option selected(?:="")?>One<\/option><\/select>/);
  assert.doesNotMatch(output, /type="password"|secret|<form|<button|evil\.test/);
});

test('standalone HTML scopes radio groups to their captured section', () => {
  const dom = new JSDOM('');
  globalThis.DOMParser = dom.window.DOMParser;
  const output = conversationHtml({
    title: 'Radio groups', url: 'https://chatgpt.com/c/123', capturedAt: 'now',
    layoutHtml: `<section data-idea-export-section="m1"><input type="radio" name="answer" value="yes" checked><input type="radio" name="answer" value="no"></section><section data-idea-export-section="m2"><input type="radio" name="answer" value="yes"></section>`,
    messages: [], media: [],
  });
  const names = [...output.matchAll(/<input type="radio" name="([^"]+)"/g)].map(match => match[1]);
  assert.equal(names.length, 3);
  assert.equal(names[0], names[1], 'choices in one captured section remain grouped');
  assert.notEqual(names[0], names[2], 'separate messages do not affect each other');
});

test('standalone HTML keeps empty radio names ungrouped and separates neutralized forms', () => {
  const dom = new JSDOM('');
  globalThis.DOMParser = dom.window.DOMParser;
  const output = conversationHtml({
    title: 'Form radio groups', url: 'https://chatgpt.com/c/123', capturedAt: 'now',
    layoutHtml: `<section data-idea-export-section="m1"><form><input type="radio" name="" value="free"><input type="radio" name="answer" value="one"></form><form><input type="radio" name="answer" value="two"></form></section>`,
    messages: [], media: [],
  });
  assert.match(output, /type="radio" name="" value="free"/);
  const names = [...output.matchAll(/<input type="radio" name="([^"]*)"/g)].map(match => match[1]);
  assert.equal(names.length, 3);
  assert.notEqual(names[1], names[2], 'separate form groups do not uncheck each other');
});

test('standalone HTML keeps hostile interaction annotations inert and drops executable handlers', () => {
  const dom = new JSDOM('');
  globalThis.DOMParser = dom.window.DOMParser;
  const output = conversationHtml({
    title: 'Hostile annotations', url: 'https://chatgpt.com/c/123', capturedAt: 'now',
    layoutHtml: `<button data-idea-action="copy" data-idea-copy-text="steal()" onclick="steal()">Copy</button><details ontoggle="steal()"><summary>Safe disclosure</summary>Text</details><input type="checkbox" onclick="steal()">`,
    messages: [], media: [],
  });
  assert.doesNotMatch(output, /<script|onclick=|ontoggle=|steal\(\)/);
  assert.match(output, /<details><summary>Safe disclosure<\/summary>/);
  assert.match(output, /<input type="checkbox">/);
});

test('standalone HTML turns a resolved local disclosure control into native details', () => {
  const dom = new JSDOM('');
  globalThis.DOMParser = dom.window.DOMParser;
  const output = conversationHtml({
    title: 'Disclosure', url: 'https://chatgpt.com/c/123', capturedAt: 'now',
    layoutHtml: `<section data-idea-export-section="m1"><button data-idea-interaction="disclosure" aria-controls="panel" aria-expanded="false" class="toggle">Show steps</button><div id="panel" hidden style="display:none;color:red"><p>Steps</p></div></section>`,
    messages: [], media: [],
  });
  assert.match(output, /<details><summary class="toggle" style="list-style: none;">Show steps<\/summary><div id="panel" style="color: red;"><p>Steps<\/p><\/div><\/details>/);
  assert.doesNotMatch(output, /aria-expanded|aria-controls|hidden|display:none/);
});

test('standalone HTML keeps open disclosure layout and rejects cross-message targets', () => {
  const dom = new JSDOM('');
  globalThis.DOMParser = dom.window.DOMParser;
  const output = conversationHtml({
    title: 'Disclosure layout', url: 'https://chatgpt.com/c/123', capturedAt: 'now',
    layoutHtml: `<article><button data-idea-interaction="disclosure" aria-controls="local" aria-expanded="true">Local</button><div id="local" style="display:grid;gap:8px"><p>A</p></div><button data-idea-interaction="disclosure" aria-controls="remote" aria-expanded="true">Remote</button></article><article><div id="remote">Other message</div></article>`,
    messages: [], media: [],
  });
  assert.match(output, /<details open=""><summary style="list-style: none;">Local<\/summary><div id="local" style="display:grid;gap:8px"><p>A<\/p><\/div><\/details>/);
  assert.doesNotMatch(output, /<details[^>]*><summary[^>]*>Remote/);
  assert.match(output, /id="remote">Other message/);
});
