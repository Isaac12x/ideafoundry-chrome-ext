import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createCaptureControls, installCollapseStyle } from '../src/controls.js';

// Mirrors ChatGPT's Nov 2026 markup: no article / role attrs, data-turn-key turns, CodeMirror code panel
// (no pre/code), Tailwind variant tokens naming "composer" on thread ancestors, ProseMirror composer.
const code = `<div data-client-defined-widget="code_block"><div class="CodeBlock-a" data-chatgpt-copy-code="x = 1\nprint(x)"><div class="CodeSurface-b" data-code-block="true" data-markdown-copy="code-block" style="border-radius:24px">
  <div data-markdown-copy="exclude" contenteditable="false"><span>python</span><button>Copy</button></div>
  <div class="cm-editor"><div class="cm-scroller chatgpt-code-scrollport"><div class="cm-content" contenteditable="true" role="textbox" aria-label="Edit code" data-language="python"><div class="cm-line">x = 1</div><div class="cm-line">print(x)</div></div></div></div></div></div></div>`;
const turn = (n, q, a, { withCode = false, attachment = false } = {}) => `<div data-turn-key="uuid-${n}"><div data-content-search-turn-key="fallback-turn-${n}"><div><div data-talvt-turn-state="complete"><div><div>
  <h4 data-conversation-role="user"><span>You said:</span><span>You</span></h4>
  <div data-chatgpt-search-unit-key="fallback-turn-${n}:0:user"><div>${attachment ? '<div role="button" aria-label="User attachment"><img src="https://cdn.example/a.png" alt=""></div>' : ''}<div data-content-search-unit-key="fallback-turn-${n}:0:user"><div><div data-user-message-bubble="true"><div><div><div data-search-result-target><div><div>${q}</div></div></div></div></div></div></div></div></div></div>
  <button>Edit</button><span data-chatgpt-agent-turn-start></span>
  <div data-content-search-unit-key="fallback-turn-${n}:1:assistant" data-chatgpt-search-unit-key="fallback-turn-${n}:1:assistant"><h4 data-conversation-role="assistant"><span>ChatGPT said:</span></h4>
    <div data-chatgpt-selection-conversation-id="c" data-chatgpt-selection-message-id="m${n}"><div data-markdown-text-style="assistant-message"><p>${a}</p>${withCode ? code : ''}</div></div></div>
  <button>Copy</button><button>Share</button>
</div></div></div></div></div></div>`;
const composer = `<form><fieldset><div data-composer-input data-composer-layout="x"><div class="pill" style="border-top-left-radius:28px;border-top-right-radius:28px;border-bottom-left-radius:28px;border-bottom-right-radius:28px;box-shadow:0 0 0 1px #ccc;background:#fff"><div class="ProseMirror" contenteditable="true" role="textbox" aria-label="Ask ChatGPT" data-composer-markdown><p>Ask</p></div></div></div></fieldset></form>`;
const scroller = 'thread-scroll-container group-has-[[data-expanded-composer]]/thread-scroll-layout:overflow-y-hidden [--thread-composer-disclaimer-visibility:initial] has-[[data-composer-expand-toggle]]:[container-type:size]';
const page = () => new JSDOM(`<!doctype html><html><body><style>.idea-capture-section-collapsed{display:none!important}</style><main>
  <div class="${scroller}" style="overflow-y:auto"><div data-thread-find-target="conversation"><div></div><div id="turns">
    ${turn(1, 'First question', 'First answer')}${turn(2, 'Second question', 'Second answer', { withCode: true })}${turn(3, 'Third question', 'Third answer', { attachment: true })}
  </div><div></div></div></div>${composer}</main></body></html>`, { url: 'https://chatgpt.com/c/1', pretendToBeVisual: true });
const setRect = (node, { left, right, top, bottom }) => { node.getBoundingClientRect = () => ({ left, right, top, bottom, width: right - left, height: bottom - top, x: left, y: top, toJSON() {} }); };
const start = (t, dom) => { installCollapseStyle(dom.window.document); const controls = createCaptureControls(dom.window.document, dom.window); t.after(() => { controls.destroy(); dom.window.close(); }); return controls; };

test('2026 markup: header is the first child of its turn, collapse hides only the turn content, expand restores', t => {
  const dom = page(); const { document } = dom.window;
  start(t, dom);
  const turns = [...document.querySelectorAll('[data-turn-key]')];
  const headers = [...document.querySelectorAll('.idea-capture-section-header')];
  assert.equal(headers.length, 3);
  assert.deepEqual(headers.map(h => h.querySelector('.idea-capture-section-label').textContent), ['First question', 'Second question', 'Third question']);
  headers.forEach((header, i) => assert.equal(turns[i].firstElementChild, header, `header ${i} is the first child of its turn (the virtualizer measures the turn)`));
  const content = turn => turn.querySelector('[data-content-search-turn-key]');
  headers[1].querySelector('button').click();
  assert.deepEqual([...document.querySelectorAll('.idea-capture-section-collapsed')], [content(turns[1])], 'only the second turn content (with its code block) collapses');
  assert.ok(document.querySelector('.cm-editor').closest('.idea-capture-section-collapsed'));
  document.querySelectorAll('.idea-capture-section-header button')[1].click();
  assert.equal(document.querySelectorAll('.idea-capture-section-collapsed').length, 0, 'expand restores everything');
  // All three collapsed: each header stays in its own visible turn, so every virtualized item keeps a non-zero box.
  document.querySelectorAll('.idea-capture-section-header button').forEach(button => button.click());
  assert.deepEqual([...document.querySelectorAll('.idea-capture-section-collapsed')], turns.map(content));
  turns.forEach((turnEl, i) => { assert.equal(turnEl.classList.contains('idea-capture-section-collapsed'), false); assert.equal(turnEl.firstElementChild, document.querySelectorAll('.idea-capture-section-header')[i]); });
  assert.ok(document.querySelector('form') && !document.querySelector('form').closest('.idea-capture-section-collapsed'));
});

test('2026 markup: export has user and assistant text, a fenced code block, and no sr-only headings', t => {
  const dom = page(); const controls = start(t, dom);
  const { messages } = controls.capture('export');
  assert.deepEqual(messages.map(m => m.role), ['User', 'Assistant', 'User', 'Assistant', 'User', 'Assistant']);
  assert.equal(messages[0].markdown, 'First question');
  assert.equal(messages[3].markdown, 'Second answer\n\n```python\nx = 1\nprint(x)\n```');
  assert.ok(messages.every(m => !/said:|Collapse|Expand/i.test(m.markdown)), 'no heading or header text');
  assert.deepEqual(controls.capture('export').sections.map(sec => sec.label), ['First question', 'Second question', 'Third question']);
});

test('2026 markup: the tab docks on the composer pill, not the code block header or editor', async t => {
  const dom = page(); const { document } = dom.window;
  Object.defineProperty(dom.window, 'innerWidth', { configurable: true, value: 1440 });
  Object.defineProperty(dom.window, 'innerHeight', { configurable: true, value: 900 });
  const surface = document.querySelector('[data-code-block]');
  setRect(document.querySelector('.thread-scroll-container'), { left: 0, right: 1440, top: 0, bottom: 900 });
  setRect(surface, { left: 336, right: 1104, top: 200, bottom: 420 });
  setRect(surface.firstElementChild, { left: 336, right: 1104, top: 200, bottom: 240 });
  setRect(document.querySelector('.cm-editor'), { left: 336, right: 1104, top: 240, bottom: 420 });
  setRect(document.querySelector('.cm-content'), { left: 336, right: 1104, top: 240, bottom: 420 });
  setRect(document.querySelector('form'), { left: 0, right: 1440, top: 800, bottom: 900 });
  setRect(document.querySelector('.pill'), { left: 336, right: 1104, top: 820, bottom: 872 });
  setRect(document.querySelector('.ProseMirror'), { left: 360, right: 1000, top: 830, bottom: 860 });
  start(t, dom);
  await new Promise(resolve => dom.window.requestAnimationFrame(resolve));
  const panel = document.querySelector('[data-idea-capture-owned="host"]').shadowRoot.querySelector('#idea-capture-panel');
  assert.equal(panel.classList.contains('is-docked'), true, 'docks');
  assert.equal(panel.style.getPropertyValue('--dock-bottom'), '79px', 'overlaps the pill top (y=820) by 1px, not the code block');
  assert.equal(panel.style.getPropertyValue('--dock-right'), '364px', 'inset by the 28px pill radius from its right edge');
});

test('2026 markup: with no composer on screen a code block (header or editor) is never a dock target', async t => {
  const dom = page(); const { document } = dom.window;
  Object.defineProperty(dom.window, 'innerWidth', { configurable: true, value: 1440 });
  Object.defineProperty(dom.window, 'innerHeight', { configurable: true, value: 900 });
  const surface = document.querySelector('[data-code-block]');
  surface.setAttribute('style', 'border-radius:24px;border:1px solid #888');
  surface.firstElementChild.setAttribute('style', 'border:1px solid #888;border-radius:8px');
  setRect(surface, { left: 336, right: 1104, top: 200, bottom: 420 });
  setRect(surface.firstElementChild, { left: 336, right: 1104, top: 200, bottom: 240 });
  setRect(document.querySelector('.cm-editor'), { left: 336, right: 1104, top: 240, bottom: 420 });
  setRect(document.querySelector('.cm-content'), { left: 336, right: 1104, top: 240, bottom: 420 });
  document.querySelector('form').remove();
  start(t, dom);
  await new Promise(resolve => dom.window.requestAnimationFrame(resolve));
  assert.equal(document.querySelector('[data-idea-capture-owned="host"]').shadowRoot.querySelector('#idea-capture-panel').classList.contains('is-docked'), false);
});

test('2026 markup: destroy removes headers and collapse state, leaving the turns intact', t => {
  const dom = page(); const { document } = dom.window;
  const controls = createCaptureControls(document, dom.window);
  installCollapseStyle(document);
  document.querySelectorAll('.idea-capture-section-header button').forEach((button, i) => { if (i !== 1) button.click(); });
  assert.equal(document.querySelectorAll('.idea-capture-section-collapsed').length, 2);
  controls.destroy(); t.after(() => dom.window.close());
  assert.equal(document.querySelectorAll('.idea-capture-section-header, .idea-capture-section-collapsed, [data-idea-capture-collapse-state]').length, 0);
  assert.equal(document.querySelectorAll('[data-turn-key]').length, 3);
  assert.equal(document.querySelectorAll('[data-content-search-turn-key]').length, 3);
  assert.ok([...document.querySelectorAll('[data-turn-key]')].every(turnEl => turnEl.children.length === 1 && turnEl.firstElementChild.hasAttribute('data-content-search-turn-key')), 'turn children are only ChatGPT\'s own');
});

// ChatGPT's composer overlay: abs-positioned, pointer-events:none, inside the scroller and outside the form.
const overlayPage = () => new JSDOM(`<!doctype html><html><body><style>.idea-capture-section-collapsed{display:none!important}</style><main>
  <div class="${scroller}" style="overflow-y:auto"><div data-thread-find-target="conversation">${turn(1, 'First question', 'First answer')}</div>
    <div id="overlay" style="position:absolute;bottom:0;z-index:20;pointer-events:none"><div style="position:relative;pointer-events:none"><div style="position:relative;z-index:10;pointer-events:none">${composer}</div></div></div></div></main></body></html>`,
  { url: 'https://chatgpt.com/c/1', pretendToBeVisual: true });
const sizeOverlayPage = dom => {
  Object.defineProperty(dom.window, 'innerWidth', { configurable: true, value: 1440 });
  Object.defineProperty(dom.window, 'innerHeight', { configurable: true, value: 900 });
  const { document } = dom.window;
  setRect(document.querySelector('.thread-scroll-container'), { left: 0, right: 1440, top: 0, bottom: 900 });
  setRect(document.querySelector('#overlay'), { left: 134, right: 1306, top: 824, bottom: 900 });
  setRect(document.querySelector('form'), { left: 336, right: 1104, top: 820, bottom: 872 });
  setRect(document.querySelector('.pill'), { left: 336, right: 1104, top: 820, bottom: 872 });
  setRect(document.querySelector('.ProseMirror'), { left: 360, right: 1000, top: 830, bottom: 860 });
};

test('2026 markup: the docked widget lives in the composer overlay (outside the form), absolute, and falls back to body', async t => {
  const dom = overlayPage(); const { document } = dom.window;
  sizeOverlayPage(dom);
  setRect(document.querySelector('.thread-scroll-container'), { left: 0, right: 1440, top: 52, bottom: 900 });
  const controls = start(t, dom);
  const frame = () => new Promise(resolve => dom.window.requestAnimationFrame(resolve));
  await frame();
  const host = document.querySelector('[data-idea-capture-owned="host"]');
  const panel = host.shadowRoot.querySelector('#idea-capture-panel');
  assert.equal(host.parentElement, document.querySelector('#overlay'), 'host mounted in the overlay');
  assert.equal(document.querySelector('form').contains(host), false, 'never inside ChatGPT\'s form');
  assert.equal(panel.classList.contains('is-docked') && panel.classList.contains('in-overlay'), true);
  assert.equal(panel.style.getPropertyValue('--dock-bottom'), '79px', 'offset from the overlay bottom edge');
  assert.equal(panel.style.getPropertyValue('--dock-right'), `${1306 - 1104 + 28}px`, 'offset from the overlay right edge, inset by the 28px radius');
  assert.equal(panel.style.getPropertyValue('--dock-max-height'), '752px', 'open panel top stays 8px below the clipping scroller (52px)');
  // Our interactions never reach ChatGPT's handlers above the host.
  let leaked = 0;
  document.querySelector('#overlay').addEventListener('click', () => leaked++);
  host.shadowRoot.querySelector('[data-action="toggle-panel"]').click();
  assert.equal(leaked, 0, 'panel clicks do not bubble past the host');
  // Overlay removed (React re-render): the host is recovered to <body> with today's fixed behaviour.
  document.querySelector('#overlay').remove();
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(host.parentElement, document.body, 'detached host recovered to body');
  assert.equal(panel.classList.contains('in-overlay'), false);
  controls.destroy();
  assert.equal(document.querySelector('[data-idea-capture-owned="host"]'), null, 'destroy removes the host wherever it is');
});

test('2026 markup: an overlay that captures fixed descendants keeps the widget on <body>', async t => {
  const dom = overlayPage(); const { document } = dom.window;
  sizeOverlayPage(dom);
  // jsdom has no layout: a probe that does not land at the viewport origin stands in for a transform/filter ancestor.
  const real = dom.window.Element.prototype.getBoundingClientRect;
  dom.window.Element.prototype.getBoundingClientRect = function () { return this.getAttribute('data-idea-capture-owned') === 'probe' ? { left: 341, top: 52, right: 341, bottom: 52, width: 0, height: 0 } : real.call(this); };
  start(t, dom);
  await new Promise(resolve => dom.window.requestAnimationFrame(resolve));
  assert.equal(document.querySelector('[data-idea-capture-owned="host"]').parentElement, document.body);
  assert.equal(document.querySelector('[data-idea-capture-owned="probe"]'), null, 'probe is removed');
});

test('2026 markup: a rejected overlay is probed once, not on every sync', async t => {
  const dom = overlayPage(); const { document } = dom.window;
  sizeOverlayPage(dom);
  let probes = 0;
  const real = dom.window.Element.prototype.getBoundingClientRect;
  dom.window.Element.prototype.getBoundingClientRect = function () { if (this.getAttribute('data-idea-capture-owned') === 'probe') { probes++; return { left: 341, top: 52, right: 341, bottom: 52, width: 0, height: 0 }; } return real.call(this); };
  start(t, dom);
  for (let i = 0; i < 3; i++) { document.querySelector('.thread-scroll-container').dispatchEvent(new dom.window.Event('scroll')); await new Promise(resolve => dom.window.requestAnimationFrame(resolve)); }
  assert.equal(probes, 1);
});
