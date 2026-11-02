import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createCaptureControls, installCollapseStyle } from '../src/controls.js';

function setRect(node, { left, right, top, bottom }) {
  node.getBoundingClientRect = () => ({ left, right, top, bottom, width: right - left, height: bottom - top, x: left, y: top, toJSON() {} });
}

function clickAt(win, target, x, y) {
  const event = new win.MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  target.dispatchEvent(event);
  return event;
}

test('either conversation gutter toggles the section whose visible vertical span contains the click', t => {
  const dom = new JSDOM(`<!doctype html><html><body><main>
    <div data-message-author-role="user">First prompt</div><div data-message-author-role="assistant">First answer</div>
    <div data-message-author-role="user">Second prompt</div><div data-message-author-role="assistant">Second answer</div>
  </main></body></html>`, { url: 'https://chatgpt.com/c/1', pretendToBeVisual: true });
  const { document } = dom.window;
  const controls = createCaptureControls(document, dom.window);
  t.after(() => { controls.destroy(); dom.window.close(); });

  const main = document.querySelector('main');
  setRect(main, { left: 180, right: 820, top: 0, bottom: 700 });
  const [firstUser, firstAssistant, secondUser, secondAssistant] = document.querySelectorAll('[data-message-author-role]');
  setRect(firstUser, { left: 320, right: 680, top: 100, bottom: 150 });
  setRect(firstAssistant, { left: 320, right: 680, top: 160, bottom: 300 });
  setRect(secondUser, { left: 320, right: 680, top: 360, bottom: 410 });
  setRect(secondAssistant, { left: 320, right: 680, top: 420, bottom: 560 });

  const leftClick = clickAt(dom.window, main, 250, 120);
  assert.equal(leftClick.defaultPrevented, true, 'a blank left gutter click is handled by the extension');
  assert.ok(firstUser.classList.contains('idea-capture-section-collapsed'));
  assert.ok(firstAssistant.classList.contains('idea-capture-section-collapsed'), 'the user prompt and following assistant reply collapse together');
  assert.ok(!secondUser.classList.contains('idea-capture-section-collapsed'));

  clickAt(dom.window, main, 750, 470);
  assert.ok(secondUser.classList.contains('idea-capture-section-collapsed'), 'the right gutter maps to the second section by its vertical position');
  assert.ok(secondAssistant.classList.contains('idea-capture-section-collapsed'));

  clickAt(dom.window, main, 250, 120);
  assert.ok(!firstUser.classList.contains('idea-capture-section-collapsed'), 'the same gutter toggles the section back open');
  clickAt(dom.window, main, 750, 470);
  assert.ok(!secondUser.classList.contains('idea-capture-section-collapsed'));
});

test('gutter clicks ignore inter-section gaps, provider sidebars, and content links', t => {
  const dom = new JSDOM(`<!doctype html><html><body><aside><div>Provider navigation</div></aside><main>
    <div data-message-author-role="user"><a href="#">First prompt link</a></div><div data-message-author-role="assistant">First answer</div>
    <div data-message-author-role="user">Second prompt</div><div data-message-author-role="assistant">Second answer</div>
  </main></body></html>`, { url: 'https://chatgpt.com/c/1', pretendToBeVisual: true });
  const { document } = dom.window;
  const controls = createCaptureControls(document, dom.window);
  t.after(() => { controls.destroy(); dom.window.close(); });

  const main = document.querySelector('main');
  const aside = document.querySelector('aside');
  setRect(main, { left: 0, right: 1000, top: 0, bottom: 700 });
  const [firstUser, firstAssistant, secondUser, secondAssistant] = document.querySelectorAll('[data-message-author-role]');
  setRect(firstUser, { left: 320, right: 680, top: 100, bottom: 150 });
  setRect(firstAssistant, { left: 320, right: 680, top: 160, bottom: 300 });
  setRect(secondUser, { left: 320, right: 680, top: 360, bottom: 410 });
  setRect(secondAssistant, { left: 320, right: 680, top: 420, bottom: 560 });

  const gapClick = clickAt(dom.window, main, 250, 330);
  assert.equal(gapClick.defaultPrevented, false, 'blank space between sections remains ordinary page space');
  clickAt(dom.window, aside, 120, 120);
  clickAt(dom.window, document.querySelector('a'), 250, 120);
  assert.ok(!firstUser.classList.contains('idea-capture-section-collapsed'));
  assert.ok(!firstAssistant.classList.contains('idea-capture-section-collapsed'));
});

test('blank padding inside full-width role wrappers toggles while gallery media remains protected', t => {
  const dom = new JSDOM(`<!doctype html><html><body><main><section id="thread">
    <div data-message-author-role="user"><p>Prompt</p></div>
    <div class="assistant-turn" data-message-author-role="assistant"><div class="markdown"><p>Answer</p></div><div class="image-gallery"><img src="https://cdn.example/chart.png" alt="Chart"></div></div>
  </section></main></body></html>`, { url: 'https://chatgpt.com/c/1', pretendToBeVisual: true });
  const { document } = dom.window;
  const controls = createCaptureControls(document, dom.window);
  t.after(() => { controls.destroy(); dom.window.close(); });

  const thread = document.querySelector('#thread');
  const user = document.querySelector('[data-message-author-role="user"]');
  const assistant = document.querySelector('.assistant-turn');
  const prompt = user.querySelector('p');
  const prose = assistant.querySelector('p');
  const image = assistant.querySelector('img');
  setRect(thread, { left: 0, right: 1000, top: 0, bottom: 700 });
  setRect(user, { left: 0, right: 1000, top: 100, bottom: 150 });
  setRect(prompt, { left: 300, right: 700, top: 110, bottom: 140 });
  setRect(assistant, { left: 0, right: 1000, top: 160, bottom: 320 });
  setRect(prose, { left: 300, right: 700, top: 170, bottom: 220 });
  setRect(image, { left: 730, right: 920, top: 230, bottom: 300 });

  const blankWrapperPadding = clickAt(dom.window, assistant, 150, 250);
  assert.equal(blankWrapperPadding.defaultPrevented, true);
  assert.ok(user.classList.contains('idea-capture-section-collapsed'));
  assert.ok(assistant.classList.contains('idea-capture-section-collapsed'));
  clickAt(dom.window, image, 800, 260);
  assert.ok(assistant.classList.contains('idea-capture-section-collapsed'), 'a gallery image click does not expand or collapse the section');
  assert.equal(clickAt(dom.window, assistant, 150, 250).defaultPrevented, true);
  assert.ok(!assistant.classList.contains('idea-capture-section-collapsed'));
});

test('gutter hit regions are clipped by scroll containers and the viewport', t => {
  const dom = new JSDOM(`<!doctype html><html><body><main><section id="thread" style="overflow-y:hidden">
    <div data-message-author-role="user"><p>Prompt</p></div><div data-message-author-role="assistant"><p>Answer</p></div>
  </section></main></body></html>`, { url: 'https://chatgpt.com/c/1', pretendToBeVisual: true });
  const { document } = dom.window;
  const controls = createCaptureControls(document, dom.window);
  t.after(() => { controls.destroy(); dom.window.close(); });
  const thread = document.querySelector('#thread');
  const [user, assistant] = document.querySelectorAll('[data-message-author-role]');
  setRect(thread, { left: 0, right: 1000, top: 100, bottom: 220 });
  setRect(user, { left: 0, right: 1000, top: 40, bottom: 90 });
  setRect(user.querySelector('p'), { left: 300, right: 700, top: 45, bottom: 80 });
  setRect(assistant, { left: 0, right: 1000, top: 100, bottom: 260 });
  setRect(assistant.querySelector('p'), { left: 300, right: 700, top: 120, bottom: 180 });

  const aboveClip = clickAt(dom.window, thread, 150, 60);
  assert.equal(aboveClip.defaultPrevented, false);
  assert.ok(!user.classList.contains('idea-capture-section-collapsed'));
  const insideClip = clickAt(dom.window, thread, 150, 150);
  assert.equal(insideClip.defaultPrevented, true);
  assert.ok(user.classList.contains('idea-capture-section-collapsed'));
  assert.ok(assistant.classList.contains('idea-capture-section-collapsed'));
});

test('ChatGPT conversation can scroll the final reply above its fixed composer', async t => {
  const dom = new JSDOM(`<!doctype html><html><body><main id="thread" style="overflow-y:auto;padding-bottom:12px">
    <div data-message-author-role="user">Question</div><div data-message-author-role="assistant">Final answer</div>
    <form style="border:1px solid #aaa"><textarea></textarea></form>
  </main></body></html>`, { url: 'https://chatgpt.com/c/1', pretendToBeVisual: true });
  const observers = [];
  Object.defineProperty(dom.window, 'ResizeObserver', { configurable: true, value: class {
    constructor(callback) { this.callback = callback; this.nodes = new Set(); observers.push(this); }
    observe(node) { this.nodes.add(node); }
    unobserve(node) { this.nodes.delete(node); }
    disconnect() { this.nodes.clear(); }
  } });
  const { document } = dom.window;
  const thread = document.querySelector('#thread');
  const form = document.querySelector('form');
  const textarea = form.querySelector('textarea');
  setRect(thread, { left: 160, right: 1000, top: 0, bottom: 800 });
  setRect(form, { left: 280, right: 880, top: 680, bottom: 790 });
  setRect(textarea, { left: 300, right: 860, top: 690, bottom: 760 });
  installCollapseStyle(document);
  const controls = createCaptureControls(document, dom.window);
  t.after(() => { controls.destroy(); dom.window.close(); });
  await new Promise(resolve => dom.window.requestAnimationFrame(resolve));

  assert.equal(thread.hasAttribute('data-idea-capture-scroll-clearance'), false, 'a composer in normal flow does not need extra scroll space');
  form.style.position = 'fixed';
  dom.window.dispatchEvent(new dom.window.Event('resize'));
  await new Promise(resolve => dom.window.requestAnimationFrame(resolve));

  assert.equal(thread.getAttribute('data-idea-capture-scroll-clearance'), '');
  assert.equal(thread.style.getPropertyValue('--idea-capture-original-padding-bottom'), '12px');
  assert.equal(thread.style.getPropertyValue('--idea-capture-composer-clearance'), '108px');
  assert.match(document.querySelector('style[data-idea-capture-owned="style"]').textContent, /padding-bottom:calc\(var\(--idea-capture-original-padding-bottom,0px\) \+ var\(--idea-capture-composer-clearance,0px\)\)!important/);

  setRect(form, { left: 280, right: 880, top: 650, bottom: 790 });
  observers[0].callback([]);
  await new Promise(resolve => dom.window.requestAnimationFrame(resolve));
  assert.equal(thread.style.getPropertyValue('--idea-capture-composer-clearance'), '138px', 'growing the positioned composer ancestor updates the scroll allowance');

  controls.refresh();
  await new Promise(resolve => dom.window.requestAnimationFrame(resolve));
  assert.equal(thread.style.getPropertyValue('--idea-capture-original-padding-bottom'), '12px', 'refreshes do not compound the existing padding');
  assert.equal(thread.style.getPropertyValue('--idea-capture-composer-clearance'), '138px');

  thread.querySelectorAll('[data-message-author-role]').forEach(node => node.remove());
  dom.window.history.pushState({}, '', '/');
  controls.refresh();
  await new Promise(resolve => dom.window.requestAnimationFrame(resolve));
  assert.equal(thread.hasAttribute('data-idea-capture-scroll-clearance'), false, 'changing to an empty route restores the scroller');
  assert.equal(thread.style.paddingBottom, '12px');

  controls.destroy();
  assert.equal(thread.hasAttribute('data-idea-capture-scroll-clearance'), false);
  assert.equal(thread.style.getPropertyValue('--idea-capture-original-padding-bottom'), '');
  assert.equal(thread.style.getPropertyValue('--idea-capture-composer-clearance'), '');
  assert.equal(thread.style.paddingBottom, '12px');
});

test('a sticky composer inside the ChatGPT scroll root keeps its native scrollport geometry', async t => {
  const dom = new JSDOM(`<!doctype html><html><body><main id="thread" style="overflow-y:auto">
    <div data-message-author-role="user">Question</div><div data-message-author-role="assistant">Final answer</div>
    <form style="position:sticky;bottom:0;border:1px solid #aaa"><textarea></textarea></form>
  </main></body></html>`, { url: 'https://chatgpt.com/c/1', pretendToBeVisual: true });
  Object.defineProperty(dom.window, 'innerWidth', { configurable: true, value: 1200 });
  Object.defineProperty(dom.window, 'innerHeight', { configurable: true, value: 800 });
  const { document } = dom.window;
  const thread = document.querySelector('#thread');
  const form = thread.querySelector('form');
  const textarea = form.querySelector('textarea');
  setRect(thread, { left: 160, right: 1000, top: 0, bottom: 800 });
  setRect(form, { left: 280, right: 880, top: 680, bottom: 800 });
  setRect(textarea, { left: 300, right: 860, top: 690, bottom: 760 });

  const controls = createCaptureControls(document, dom.window);
  t.after(() => { controls.destroy(); dom.window.close(); });
  await new Promise(resolve => dom.window.requestAnimationFrame(resolve));

  assert.equal(thread.hasAttribute('data-idea-capture-scroll-clearance'), false, 'a sticky composer in the scroll root already participates in its layout');
  assert.equal(thread.style.getPropertyValue('--idea-capture-composer-clearance'), '', 'the extension leaves the scrollport bottom edge unchanged');
  const panel = document.querySelector('[data-idea-capture-owned="host"]').shadowRoot.querySelector('#idea-capture-panel');
  assert.equal(panel.classList.contains('is-docked'), true, 'the capture tab still docks to the visible composer');

  thread.dispatchEvent(new dom.window.Event('scroll'));
  await new Promise(resolve => dom.window.requestAnimationFrame(resolve));
  assert.equal(thread.hasAttribute('data-idea-capture-scroll-clearance'), false, 'scroll updates do not introduce clearance that shifts the sticky edge');
  assert.equal(thread.style.paddingBottom, '');
});

test('ChatGPT docks the closed tab to the visible rounded input surface, not its broad composer or code textbox', async t => {
  const dom = new JSDOM(`<!doctype html><html><body><main id="thread">
    <div data-message-author-role="user">Question</div><div data-message-author-role="assistant">Answer</div>
    <form class="composer" style="background:#f6f7f6"><div class="input-surface" data-visible-input-border style="border:1px solid #aeb8b0;border-radius:22px;background:white">
      <div contenteditable="true" aria-label="Message composer">Ask anything</div><div>Send</div></div>
      <pre role="textbox" aria-readonly="true">readonly code textbox decoy</pre>
    </form>
  </main></body></html>`, { url: 'https://chatgpt.com/g/demo/c/1', pretendToBeVisual: true });
  Object.defineProperty(dom.window, 'innerWidth', { configurable: true, value: 1200 });
  Object.defineProperty(dom.window, 'innerHeight', { configurable: true, value: 800 });
  const { document } = dom.window;
  const thread = document.querySelector('#thread');
  const form = document.querySelector('.composer');
  const surface = document.querySelector('[data-visible-input-border]');
  const editor = surface.querySelector('[contenteditable="true"]');
  const code = form.querySelector('pre');
  setRect(thread, { left: 120, right: 1080, top: 0, bottom: 800 });
  setRect(form, { left: 0, right: 1200, top: 650, bottom: 800 });
  setRect(surface, { left: 250, right: 950, top: 690, bottom: 790 });
  setRect(editor, { left: 270, right: 930, top: 700, bottom: 748 });
  setRect(code, { left: 250, right: 950, top: 755, bottom: 785 });

  const controls = createCaptureControls(document, dom.window);
  t.after(() => { controls.destroy(); dom.window.close(); });
  await new Promise(resolve => dom.window.requestAnimationFrame(resolve));
  const panel = document.querySelector('[data-idea-capture-owned="host"]').shadowRoot.querySelector('#idea-capture-panel');
  assert.equal(panel.classList.contains('is-docked'), true);
  assert.equal(surface.getAttribute('data-visible-input-border'), '');
  assert.equal(panel.style.getPropertyValue('--dock-right'), '262px', 'tab right edge follows the bordered input surface, not the viewport-wide form');
  assert.equal(panel.style.getPropertyValue('--dock-bottom'), '109px', 'tab overlaps the visible input surface top border by one pixel');
  assert.equal(thread.hasAttribute('data-idea-capture-scroll-clearance'), false, 'input anchoring does not alter native scroll geometry');
});

test('ChatGPT keeps a compact launcher available when no input edge is available', async t => {
  const dom = new JSDOM('<!doctype html><html><body><main><p>Conversation without a composer</p></main></body></html>', { url: 'https://chatgpt.com/c/1', pretendToBeVisual: true });
  const controls = createCaptureControls(dom.window.document, dom.window);
  t.after(() => { controls.destroy(); dom.window.close(); });
  const panel = dom.window.document.querySelector('[data-idea-capture-owned="host"]').shadowRoot.querySelector('#idea-capture-panel');
  await new Promise(resolve => dom.window.requestAnimationFrame(resolve));
  assert.equal(panel.hidden, false, 'the compact launcher remains available without a detected composer');
  assert.equal(panel.querySelector('.panel-body').hidden, true, 'the panel still starts closed');
  controls.open();
  assert.equal(panel.hidden, false, 'opening the capture controls remains available to callers');
});

test('ChatGPT reattaches its widget if an SPA removes the shadow host during a rebuild', async t => {
  const dom = new JSDOM('<!doctype html><html><body><main><div data-message-author-role="user">Question</div><div data-message-author-role="assistant">Answer</div></main></body></html>', { url: 'https://chatgpt.com/c/1', pretendToBeVisual: true });
  const controls = createCaptureControls(dom.window.document, dom.window);
  t.after(() => { controls.destroy(); dom.window.close(); });
  const host = dom.window.document.querySelector('[data-idea-capture-owned="host"]');
  host.remove();
  await new Promise(resolve => dom.window.setTimeout(resolve, 0));
  assert.equal(host.isConnected, true, 'the existing controller restores its shadow host after a page rebuild');
  assert.ok(host.shadowRoot.querySelector('[data-idea-panel]'));
});

test('ChatGPT keeps the launcher undocked when the prompt has no painted edge and retains its identity while disabled', async t => {
  const dom = new JSDOM(`<!doctype html><html><body><main><form data-testid="composer">
    <div id="surface" style="border-radius:20px"><textarea id="prompt-textarea"></textarea></div>
  </form></main></body></html>`, { url: 'https://chatgpt.com/c/1', pretendToBeVisual: true });
  Object.defineProperty(dom.window, 'innerWidth', { configurable: true, value: 1200 });
  Object.defineProperty(dom.window, 'innerHeight', { configurable: true, value: 800 });
  const { document } = dom.window;
  const surface = document.querySelector('#surface');
  const prompt = document.querySelector('#prompt-textarea');
  setRect(surface, { left: 250, right: 950, top: 690, bottom: 790 });
  setRect(prompt, { left: 270, right: 930, top: 700, bottom: 748 });
  const controls = createCaptureControls(document, dom.window);
  t.after(() => { controls.destroy(); dom.window.close(); });
  const panel = document.querySelector('[data-idea-capture-owned="host"]').shadowRoot.querySelector('#idea-capture-panel');
  await new Promise(resolve => dom.window.requestAnimationFrame(resolve));
  assert.equal(panel.hidden, false, 'the closed launcher remains reachable');
  assert.equal(panel.classList.contains('is-docked'), false, 'a decorative radius without painted fill, border, or shadow is not an input edge');

  surface.style.border = '1px solid rgb(180, 190, 180)';
  await new Promise(resolve => dom.window.requestAnimationFrame(resolve));
  await new Promise(resolve => dom.window.requestAnimationFrame(resolve));
  assert.equal(panel.hidden, false);
  assert.equal(panel.style.getPropertyValue('--dock-bottom'), '109px');
  prompt.disabled = true;
  await new Promise(resolve => dom.window.requestAnimationFrame(resolve));
  await new Promise(resolve => dom.window.requestAnimationFrame(resolve));
  assert.equal(panel.hidden, false, 'generation disabling the prompt does not discard its visible surface');
  assert.equal(panel.style.getPropertyValue('--dock-bottom'), '109px');
});

test('an absolute composer inside a sticky wrapper also keeps the scroll root unchanged', async t => {
  const dom = new JSDOM(`<!doctype html><html><body><main id="thread" style="overflow-y:auto">
    <div data-message-author-role="user">Question</div><div data-message-author-role="assistant">Final answer</div>
    <div id="sticky-wrapper" style="position:sticky;bottom:0"><form style="position:absolute;background:white;border:1px solid black"><textarea></textarea></form></div>
  </main></body></html>`, { url: 'https://chatgpt.com/c/1', pretendToBeVisual: true });
  Object.defineProperty(dom.window, 'innerWidth', { configurable: true, value: 1200 });
  Object.defineProperty(dom.window, 'innerHeight', { configurable: true, value: 800 });
  const { document } = dom.window;
  const thread = document.querySelector('#thread');
  const wrapper = document.querySelector('#sticky-wrapper');
  const form = wrapper.querySelector('form');
  const textarea = form.querySelector('textarea');
  setRect(thread, { left: 160, right: 1000, top: 0, bottom: 800 });
  // The absolute form reaches the scrollport edge while its sticky wrapper ends
  // two pixels above it, so overlay selection sees the form rather than wrapper.
  setRect(wrapper, { left: 280, right: 880, top: 690, bottom: 798 });
  setRect(form, { left: 280, right: 880, top: 680, bottom: 800 });
  setRect(textarea, { left: 300, right: 860, top: 690, bottom: 770 });

  const controls = createCaptureControls(document, dom.window);
  t.after(() => { controls.destroy(); dom.window.close(); });
  await new Promise(resolve => dom.window.requestAnimationFrame(resolve));

  assert.equal(thread.hasAttribute('data-idea-capture-scroll-clearance'), false, 'sticky ancestors keep their native edge even when an absolute child is selected as the overlay');
  assert.equal(thread.style.getPropertyValue('--idea-capture-composer-clearance'), '');
});

test('unmarked replies collapse with their prompt and direct media keeps margin controls outside the gallery', t => {
  const dom = new JSDOM(`<!doctype html><html><body><main>
    <div class="prompt-branch"><div class="bg-user-message">Question</div></div>
    <div class="reply-branch"><p>Unmarked answer</p><img src="https://cdn.example/chart.png" alt="Chart"></div>
  </main></body></html>`, { url: 'https://chatgpt.com/c/1', pretendToBeVisual: true });
  Object.defineProperty(dom.window, 'innerWidth', { configurable: true, value: 1200 });
  const { document } = dom.window;
  const controls = createCaptureControls(document, dom.window);
  t.after(() => { controls.destroy(); dom.window.close(); });
  const shadow = document.querySelector('[data-idea-capture-owned="host"]').shadowRoot;
  const header = document.querySelector('.idea-capture-section-header');
  assert.ok(header, 'the inferred prompt and unmarked reply form a section');
  const prompt = document.querySelector('.bg-user-message');
  const promptBranch = document.querySelector('.prompt-branch');
  const reply = document.querySelector('.reply-branch');
  const paragraph = reply.querySelector('p');
  const image = reply.querySelector('img');
  setRect(prompt, { left: 200, right: 500, top: 100, bottom: 150 });
  setRect(reply, { left: 0, right: 1200, top: 160, bottom: 320 });
  setRect(paragraph, { left: 200, right: 500, top: 170, bottom: 220 });
  setRect(image, { left: 700, right: 1100, top: 230, bottom: 300 });
  controls.refresh();

  const rail = shadow.querySelector('#idea-capture-margin-controls');
  assert.equal(rail.hidden, false);
  const railButton = rail.querySelector('button');
  assert.equal(railButton.getAttribute('aria-label'), 'Collapse section: Question');
  assert.equal(railButton.textContent, '', 'the side action has no text glyph');
  assert.equal(railButton.dataset.direction, 'right', 'the left-side rail points inward toward the conversation');
  assert.equal(rail.style.left, 'auto');
  assert.equal(rail.style.right, '1004px', 'the cached section bounds include media extending beyond the text');
  assert.match(rail.querySelector('button').getAttribute('aria-label'), /Collapse section/);
  railButton.click();
  assert.ok(promptBranch.classList.contains('idea-capture-section-collapsed'));
  assert.ok(reply.classList.contains('idea-capture-section-collapsed'), 'the inferred reply branch collapses with its prompt');
  assert.equal(rail.hidden, true, 'the side button hides after collapse while the inline header offers Expand');
  assert.equal(header.querySelector('button').textContent, 'Expand');
});

test('media in a section is retained when its shared article also contains another section', t => {
  const dom = new JSDOM(`<!doctype html><html><body><main><article>
    <div data-message-author-role="user"><p>First question</p></div>
    <div data-message-author-role="assistant"><p>First answer</p></div>
    <div data-message-author-role="user"><p>Second question</p></div>
    <div data-message-author-role="assistant"><p>Second answer</p><div class="image-gallery"><img src="https://cdn.example/chart.png" alt="Chart"></div></div>
  </article></main></body></html>`, { url: 'https://chatgpt.com/c/1', pretendToBeVisual: true });
  Object.defineProperty(dom.window, 'innerWidth', { configurable: true, value: 1200 });
  const { document } = dom.window;
  const controls = createCaptureControls(document, dom.window);
  t.after(() => { controls.destroy(); dom.window.close(); });

  const article = document.querySelector('article');
  const [firstUser, firstAssistant, secondUser, secondAssistant] = document.querySelectorAll('[data-message-author-role]');
  const image = document.querySelector('img');
  setRect(article, { left: 300, right: 700, top: 0, bottom: 600 });
  for (const node of [firstUser, firstAssistant, secondUser, secondAssistant]) setRect(node, { left: 300, right: 700, top: 100, bottom: 400 });
  for (const node of document.querySelectorAll('p')) setRect(node, { left: 300, right: 700, top: 110, bottom: 150 });
  setRect(image, { left: 900, right: 1100, top: 250, bottom: 320 });
  controls.refresh();

  const secondHeader = [...document.querySelectorAll('.idea-capture-section-header')][1];
  const rail = document.querySelector('[data-idea-capture-owned="host"]').shadowRoot.querySelector('#idea-capture-margin-controls');
  assert.equal(rail.hidden, false);
  assert.equal(rail.style.right, '904px', 'the rail is positioned against the gallery-expanded section bounds');
  secondHeader.querySelector('button').click();
  assert.equal(rail.hidden, true, 'collapsed sections keep their inline Expand button and hide the side chevron');
});

test('a grouped prompt and unmarked reply keep the section header visible when collapsed', t => {
  const dom = new JSDOM(`<!doctype html><html><body><main>
    <article><div class="bg-user-message">Question</div><div class="reply-content"><p>Unmarked answer</p></div></article>
  </main></body></html>`, { url: 'https://chatgpt.com/c/1', pretendToBeVisual: true });
  const { document } = dom.window;
  const controls = createCaptureControls(document, dom.window);
  t.after(() => { controls.destroy(); dom.window.close(); });
  const header = document.querySelector('.idea-capture-section-header');
  assert.ok(header);
  header.querySelector('button').click();
  assert.ok(header.isConnected, 'collapsing a grouped turn does not hide the controls placed before it');
  assert.equal(header.closest('.idea-capture-section-collapsed'), null, 'the collapsed display rule cannot hide the section header');
  assert.equal(header.nextElementSibling, document.querySelector('article'));
  assert.ok(document.querySelector('article').classList.contains('idea-capture-section-collapsed'));
});

test('empty state copies structural diagnostics and exposes a readonly fallback when clipboard access fails', async t => {
  const dom = new JSDOM('<!doctype html><html><body><main><p>Private transcript text</p></main></body></html>', {
    url: 'https://chatgpt.com/c/private-conversation-id', pretendToBeVisual: true,
  });
  const { document } = dom.window;
  Object.defineProperty(dom.window.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async () => { throw new Error('Clipboard denied'); } },
  });
  const controls = createCaptureControls(document, dom.window);
  t.after(() => { controls.destroy(); dom.window.close(); });
  const shadow = document.querySelector('[data-idea-capture-owned="host"]').shadowRoot;
  assert.equal(shadow.querySelector('.panel-body').hidden, true, 'diagnostics do not open the panel automatically');
  shadow.querySelector('[data-action="toggle-panel"]').click();
  shadow.querySelector('[data-action="copy-diagnostics"]').click();
  await new Promise(resolve => setTimeout(resolve, 0));

  const fallback = shadow.querySelector('[data-diagnostics-fallback]');
  assert.equal(fallback.hidden, false);
  assert.match(shadow.querySelector('[data-diagnostics-status]').textContent, /Select and copy/);
  const diagnostics = JSON.parse(fallback.value);
  assert.match(diagnostics.version, /^\d+\.\d+\.\d+$/);
  assert.equal(diagnostics.provider, 'ChatGPT');
  assert.doesNotMatch(fallback.value, /Private transcript text|private-conversation-id/);
});
