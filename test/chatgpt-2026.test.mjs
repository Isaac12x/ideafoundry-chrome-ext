import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createCaptureControls, installCollapseStyle } from '../src/controls.js';

// Mirrors ChatGPT's Nov 2026 markup: no article / role attrs, data-turn-key turns, CodeMirror code panel
// (no pre/code), Tailwind variant tokens naming "composer" on thread ancestors, ProseMirror composer.
const code = `<div data-client-defined-widget="code_block"><div class="CodeBlock-a" data-chatgpt-copy-code="x = 1"><div class="CodeSurface-b" data-code-block="true" data-markdown-copy="code-block" style="border-radius:24px">
  <div data-markdown-copy="exclude" contenteditable="false"><span>Plain text</span><button>Copy</button></div>
  <div class="cm-editor"><div class="cm-scroller chatgpt-code-scrollport"><div class="cm-content" contenteditable="true" role="textbox" aria-label="Edit code" data-language="python"><div class="cm-line">x = 1</div></div></div></div></div></div></div>`;
const turn = (n, q, a) => `<div data-turn-key="uuid-${n}"><div data-content-search-turn-key="fallback-turn-${n}"><div data-talvt-turn-state="complete">
  <div data-content-search-unit-key="fallback-turn-${n}:0:user"><div data-conversation-role="user"><div data-user-message-bubble="true" class="user-message-bubble-color">${q}</div></div></div>
  <div data-content-search-unit-key="fallback-turn-${n}:1:assistant"><div data-chatgpt-selection-message-id="m${n}"><div data-markdown-text-style="assistant-message" class="markdown prose"><p>${a}</p>${n === 1 ? code : ''}</div></div></div>
</div></div></div>`;
const composer = `<form><fieldset><div data-composer-input data-composer-layout="x"><div class="pill" style="border-top-left-radius:28px;border-top-right-radius:28px;border-bottom-left-radius:28px;border-bottom-right-radius:28px;box-shadow:0 0 0 1px #ccc;background:#fff"><div class="ProseMirror" contenteditable="true" role="textbox" aria-label="Ask ChatGPT" data-composer-markdown><p>Ask</p></div></div></div></fieldset></form>`;
const scroller = 'thread-scroll-container group-has-[[data-expanded-composer]]/thread-scroll-layout:overflow-y-hidden [--thread-composer-disclaimer-visibility:initial] has-[[data-composer-expand-toggle]]:[container-type:size]';
const page = (extra = '') => new JSDOM(`<!doctype html><html><body><style>.idea-capture-section-collapsed{display:none!important}</style><main>
  <div class="${scroller}" style="overflow-y:auto">${turn(1, 'First question', 'First answer')}${turn(2, 'Second question', 'Second answer')}</div>${extra}${composer}</main></body></html>`,
  { url: 'https://chatgpt.com/c/1', pretendToBeVisual: true });
const setRect = (node, { left, right, top, bottom }) => { node.getBoundingClientRect = () => ({ left, right, top, bottom, width: right - left, height: bottom - top, x: left, y: top, toJSON() {} }); };
const start = (t, dom) => { installCollapseStyle(dom.window.document); const controls = createCaptureControls(dom.window.document, dom.window); t.after(() => { controls.destroy(); dom.window.close(); }); return controls; };

test('2026 markup: collapsing a section hides the whole Q-A including its code block, expand restores it', t => {
  const dom = page(); const { document } = dom.window;
  start(t, dom);
  const headers = document.querySelectorAll('.idea-capture-section-header');
  assert.equal(headers.length, 2);
  headers[0].querySelector('button').click();
  const turns = document.querySelectorAll('[data-turn-key]');
  assert.ok(turns[0].classList.contains('idea-capture-section-collapsed') || turns[0].querySelector('[data-content-search-unit-key$=":0:user"]').closest('.idea-capture-section-collapsed'), 'question collapses');
  assert.ok(document.querySelector('.cm-editor').closest('.idea-capture-section-collapsed'), 'code block collapses');
  assert.ok(document.querySelector('[data-code-block]').closest('.idea-capture-section-collapsed'));
  assert.equal(turns[1].closest('.idea-capture-section-collapsed'), null, 'neighbor stays visible');
  assert.equal(document.querySelector('form').closest('.idea-capture-section-collapsed'), null, 'composer stays visible');
  assert.equal(headers[0].closest('.idea-capture-section-collapsed'), null, 'its own header stays visible');
  document.querySelector('.idea-capture-section-header button').click();
  assert.equal(document.querySelectorAll('.idea-capture-section-collapsed').length, 0, 'expand restores everything');
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
