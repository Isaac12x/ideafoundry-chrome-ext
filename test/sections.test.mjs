import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { extractConversation } from '../src/extract.js';
import { createCaptureControls, installCollapseStyle } from '../src/controls.js';

const page = () => new JSDOM(`<!doctype html><html><head><title>Topic - ChatGPT</title></head><body><main>
  <div data-message-author-role="user">Continue</div><div data-message-author-role="assistant">First answer</div>
  <div data-message-author-role="user">Continue</div><div data-message-author-role="assistant">Second answer</div>
</main></body></html>`, { url: 'https://chatgpt.com/c/1', pretendToBeVisual: true });

test('empty discovery keeps a closed launcher visible and Retry finds messages after load', t => {
  const dom = new JSDOM('<!doctype html><html><body><main><p>Loading conversation…</p></main></body></html>', { url: 'https://chatgpt.com/g/g-p-demo/c/123', pretendToBeVisual: true });
  const { document } = dom.window;
  const controls = createCaptureControls(document, dom.window);
  t.after(() => { controls.destroy(); dom.window.close(); });
  const shadow = document.querySelector('[data-idea-capture-owned="host"]').shadowRoot;
  const panel = shadow.querySelector('[data-idea-panel]');
  const open = shadow.querySelector('[data-action="toggle-panel"]');
  assert.equal(panel.hidden, false, 'the launcher stays visible when no turns are found');
  assert.equal(shadow.querySelector('.panel-body').hidden, true, 'the launcher starts closed');
  open.click();
  assert.match(shadow.querySelector('[data-empty-message]').textContent, /No conversation found/);

  document.querySelector('main').innerHTML = '<article data-testid="conversation-turn-0"><h5>You said:</h5><p>Loaded question</p></article><article data-testid="conversation-turn-1"><h6>ChatGPT said:</h6><p>Loaded answer</p></article>';
  shadow.querySelector('[data-action="retry"]').click();
  assert.equal(shadow.querySelector('.empty').hidden, true);
  assert.equal(shadow.querySelectorAll('.row').length, 1);
});

test('recognized conversations expose diagnostics inside the closed-by-default panel', async t => {
  const dom = new JSDOM('<!doctype html><html><body><main><div data-message-author-role="user">Private prompt</div><div data-message-author-role="assistant">Private answer</div></main></body></html>', {
    url: 'https://chatgpt.com/c/123', pretendToBeVisual: true,
  });
  let copied = '';
  Object.defineProperty(dom.window.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async value => { copied = value; } },
  });
  const controls = createCaptureControls(dom.window.document, dom.window);
  t.after(() => { controls.destroy(); dom.window.close(); });
  const shadow = dom.window.document.querySelector('[data-idea-capture-owned="host"]').shadowRoot;
  assert.equal(shadow.querySelector('.panel-body').hidden, true);
  const copyButton = shadow.querySelector('.tools [data-action="copy-diagnostics"]');
  assert.ok(copyButton, 'diagnostics are available when messages are recognized');
  shadow.querySelector('[data-action="toggle-panel"]').click();
  copyButton.click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.match(shadow.querySelector('[data-diagnostics-status]').textContent, /copied to clipboard/);
  assert.doesNotMatch(copied, /Private prompt|Private answer|123/);
});

test('generic page fallback keeps its media attached when selection filters media by message index', () => {
  const dom = new JSDOM('<main><h1>Notes</h1><p>Chart <img src="https://cdn.example/chart.png" alt="chart"></p></main>', { url: 'https://example.com/notes', pretendToBeVisual: true });
  const controls = createCaptureControls(dom.window.document, dom.window);
  try {
    const captured = controls.capture('export');
    assert.equal(captured.messages[0].role, 'Page content');
    assert.equal(captured.messages[0].messageIndex, 0);
    assert.equal(captured.media.length, 1);
    assert.match(captured.messages[0].markdown, /\{\{idea-media:media-0-0\}\}/);
  } finally {
    controls.destroy();
    dom.window.close();
  }
});

test('section selection removes excluded media and its placeholder with the excluded messages', () => {
  const dom = new JSDOM(`<main>
    <div data-message-author-role="user">Question <img src="https://cdn.example/old.png" alt="old"></div>
    <div data-message-author-role="assistant">Answer</div>
    <div data-message-author-role="user">Keep this question</div>
    <div data-message-author-role="assistant">Keep this answer</div>
  </main>`, { url: 'https://chatgpt.com/c/1', pretendToBeVisual: true });
  const controls = createCaptureControls(dom.window.document, dom.window);
  try {
    const checkbox = dom.window.document.querySelector('.idea-capture-section-header input');
    checkbox.checked = false;
    checkbox.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    const captured = controls.capture('export');
    assert.deepEqual(captured.media, []);
    assert.equal(captured.messages.length, 2);
    assert.doesNotMatch(captured.messages.map(message => message.markdown).join('\n'), /idea-media|old\.png/);
  } finally {
    controls.destroy();
    dom.window.close();
  }
});

test('groups each user prompt with following replies and gives duplicate prompts distinct stable IDs', () => {
  const dom = page();
  const result = extractConversation(dom.window.document, dom.window.location.href);
  assert.equal(result.sections.length, 2);
  assert.notEqual(result.sections[0].id, result.sections[1].id);
  assert.deepEqual(result.messages.map(message => message.sectionId), [result.sections[0].id, result.sections[0].id, result.sections[1].id, result.sections[1].id]);
  assert.equal(result.sections[0].label, 'Continue');
  dom.window.close();
});

test('inline controls preserve selection through updates, collapse reversibly, and reject empty exports', async () => {
  const dom = page();
  const { document, location } = dom.window;
  installCollapseStyle(document);
  const controls = createCaptureControls(document, dom.window);
  let current = controls.capture('preview');
  assert.equal(current.sections.filter(section => section.selected).length, 2);
  const headers = [...document.querySelectorAll('.idea-capture-section-header')];
  assert.equal(headers.length, 2);
  assert.equal(headers[0].nextElementSibling.dataset.messageAuthorRole, 'user');
  const collapse = headers[0].querySelector('button');
  collapse.click();
  const firstId = headers[0].querySelector('input').dataset.ideaSectionId;
  const firstNodes = [...document.querySelectorAll('[data-message-author-role]')].slice(0, 2);
  assert.ok(firstNodes.every(node => node.classList.contains('idea-capture-section-collapsed')));
  assert.ok(document.querySelector('.idea-capture-section-header'));
  current = controls.capture('export');
  assert.equal(current.messages.length, 4, 'collapsed content remains part of selected export');

  const firstCheckbox = document.querySelector(`.idea-capture-section-header input[data-idea-section-id="${firstId}"]`);
  firstCheckbox.checked = false;
  firstCheckbox.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  document.querySelector('[data-message-author-role="assistant"]').textContent = 'First answer, still streaming';
  await new Promise(resolve => setTimeout(resolve, 10));
  current = controls.capture('preview');
  assert.equal(current.messages.length, 2);
  assert.equal(current.sections.find(section => section.id === firstId).selected, false);
  await new Promise(resolve => setTimeout(resolve, 180));
  assert.equal(controls.capture('preview').sections.find(section => section.id === firstId).selected, false, 'stream updates preserve the section selection');
  assert.throws(() => {
    for (const checkbox of document.querySelectorAll('.idea-capture-section-header input')) {
      checkbox.checked = false; checkbox.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    }
    controls.capture('export');
  }, /Select at least one section/);
  assert.equal(controls.capture('preview').messages.length, 0, 'preview retains usable section metadata with no selection');

  const newUser = document.createElement('div'); newUser.dataset.messageAuthorRole = 'user'; newUser.textContent = 'A new question';
  const newAssistant = document.createElement('div'); newAssistant.dataset.messageAuthorRole = 'assistant'; newAssistant.textContent = 'A new answer';
  document.querySelector('main').append(newUser, newAssistant);
  await new Promise(resolve => setTimeout(resolve, 220));
  current = controls.capture('preview');
  const added = current.sections.find(section => section.label === 'A new question');
  assert.equal(added.selected, true, 'new section starts selected');

  controls.destroy();
  assert.ok(firstNodes.every(node => !node.classList.contains('idea-capture-section-collapsed')));
  dom.window.close();
});

test('controller collapses read-only code surfaces and panels without hiding a neighbor or composer', t => {
  const dom = new JSDOM(`<style>.idea-capture-section-collapsed{display:none!important}</style><main id="thread">
    <div class="bg-user-message">Explain SQL</div>
    <div class="markdown"><p>Example</p><pre id="readonly-code" role="textbox" aria-readonly="true"><code>SELECT * FROM orders;</code></pre></div>
    <div class="streamed-tail"><section id="code-panel"><header>Code actions</header><pre><code>const value = 1;</code></pre><textarea readonly>const value = 1;</textarea></section>
      <div class="bg-user-message">Next</div></div><div class="markdown">Next answer <pre id="next-code"><code>keep visible</code></pre></div>
    <form class="composer"><textarea>Draft</textarea><pre id="composer-code" role="textbox" aria-readonly="true"><code>keep composer content</code></pre></form>
  </main>`, { url: 'https://chatgpt.com/c/123', pretendToBeVisual: true });
  const { document } = dom.window;
  installCollapseStyle(document);
  const controls = createCaptureControls(document, dom.window);
  t.after(() => { controls.destroy(); dom.window.close(); });

  const headers = [...document.querySelectorAll('.idea-capture-section-header')];
  assert.equal(headers.length, 2);
  headers[0].querySelector('button').click();
  assert.ok(document.querySelector('#readonly-code').closest('.idea-capture-section-collapsed'));
  assert.ok(document.querySelector('#code-panel').classList.contains('idea-capture-section-collapsed'));
  assert.ok(document.querySelector('#code-panel textarea').closest('.idea-capture-section-collapsed'));
  assert.equal(document.querySelectorAll('.bg-user-message')[1].classList.contains('idea-capture-section-collapsed'), false);
  assert.equal(document.querySelector('#next-code').closest('.idea-capture-section-collapsed'), null);
  assert.equal(document.querySelector('form.composer').classList.contains('idea-capture-section-collapsed'), false);
  assert.equal(document.querySelector('#composer-code').closest('.idea-capture-section-collapsed'), null);
});

test('controller leaves a read-only textarea outside a marked code frame visible', t => {
  const dom = new JSDOM(`<style>.idea-capture-section-collapsed{display:none!important}</style><main id="thread">
    <div class="bg-user-message">Question</div>
    <div class="markdown"><p>Answer</p><pre><code>SELECT 1;</code></pre><textarea readonly placeholder="Draft">keep visible</textarea></div>
    <div class="bg-user-message">Next</div><div class="markdown">Next answer</div>
  </main>`, { url: 'https://chatgpt.com/c/123', pretendToBeVisual: true });
  const { document } = dom.window;
  installCollapseStyle(document);
  const controls = createCaptureControls(document, dom.window);
  t.after(() => { controls.destroy(); dom.window.close(); });
  document.querySelector('.idea-capture-section-header button').click();
  assert.ok(document.querySelector('pre').closest('.idea-capture-section-collapsed'));
  assert.equal(document.querySelector('textarea').closest('.idea-capture-section-collapsed'), null);
  assert.equal(document.querySelectorAll('.bg-user-message')[1].classList.contains('idea-capture-section-collapsed'), false);
});

test('a collapsed latest section absorbs and exports content appended by a streaming reply', async t => {
  const dom = new JSDOM(`<style>.idea-capture-section-collapsed{display:none!important}</style><main id="thread">
    <div class="turn"><div class="bg-user-message">Show a Python example</div>
      <div class="reply-shell"><div class="markdown">Starting answer.</div></div>
    </div>
  </main>`, { url: 'https://chatgpt.com/c/stream', pretendToBeVisual: true });
  const { document } = dom.window;
  const controls = createCaptureControls(document, dom.window);
  t.after(() => { controls.destroy(); dom.window.close(); });
  const shadow = document.querySelector('[data-idea-capture-owned="host"]').shadowRoot;
  shadow.querySelector('button.collapse').click();
  const streamedCode = document.createElement('div');
  streamedCode.className = 'generated-code-panel';
  streamedCode.innerHTML = '<pre><code>print("arrived after collapse")</code></pre>';
  document.querySelector('.reply-shell').append(streamedCode);
  await new Promise(resolve => setTimeout(resolve, 240));
  assert.ok(streamedCode.closest('.idea-capture-section-collapsed'), 'the refresh adds late streamed content to the collapsed section');
  const exported = controls.capture('export');
  assert.match(exported.messages.map(message => message.markdown).join('\n'), /arrived after collapse/);
});

test('section headers stay in chronological DOM order while later and earlier turns are toggled', () => {
  const dom = new JSDOM(`<!doctype html><html><body><main style="display:flex;flex-direction:column">
    <article data-testid="conversation-turn-0" style="order:1"><div data-message-author-role="user">First prompt</div><div data-message-author-role="assistant">First reply</div></article>
    <article data-testid="conversation-turn-1" style="order:2"><div data-message-author-role="user">Second prompt</div><div data-message-author-role="assistant">Second reply</div></article>
    <article data-testid="conversation-turn-2" style="order:3"><div data-message-author-role="user">Third prompt</div><div data-message-author-role="assistant">Third reply</div></article>
  </main></body></html>`, { url: 'https://chatgpt.com/c/1', pretendToBeVisual: true });
  const { document } = dom.window;
  installCollapseStyle(document);
  const controls = createCaptureControls(document, dom.window);
  const turns = [...document.querySelectorAll('article')];
  const shadow = document.querySelector('[data-idea-capture-owned="host"]').shadowRoot;
  assert.equal(shadow.querySelector('[data-action="allow-media"]'), null, 'the capture panel does not request media access');
  const headersInOrder = () => [...document.querySelectorAll('.idea-capture-section-header')]
    .map(header => header.querySelector('.idea-capture-section-label').textContent);
  const assertNativeOrder = () => {
    assert.deepEqual(headersInOrder(), ['First prompt', 'Second prompt', 'Third prompt']);
    for (const [index, turn] of turns.entries()) {
      const matchingHeader = [...document.querySelectorAll('.idea-capture-section-header')][index];
      assert.equal(matchingHeader.parentElement, turn.parentElement);
      assert.equal(matchingHeader.nextElementSibling, turn, 'each header stays immediately before its own turn');
      assert.equal(matchingHeader.style.order, turn.style.order, 'the header shares its turn’s visual order in a flex or grid parent');
    }
  };
  try {
    assertNativeOrder();
    let headers = [...document.querySelectorAll('.idea-capture-section-header')];
    headers[2].querySelector('button').click();
    headers = [...document.querySelectorAll('.idea-capture-section-header')];
    headers[0].querySelector('button').click();
    headers = [...document.querySelectorAll('.idea-capture-section-header')];
    headers[0].querySelector('button').click();
    assertNativeOrder();
  } finally {
    controls.destroy();
    dom.window.close();
  }
});

test('prepended duplicate prompts keep node-based selection and panel focus', () => {
  const dom = page();
  const { document } = dom.window;
  installCollapseStyle(document);
  const controls = createCaptureControls(document, dom.window);
  const panel = document.querySelector('#idea-capture-controls')?.shadowRoot || [...document.querySelectorAll('[data-idea-capture-owned="host"]')][0].shadowRoot;
  assert.equal(panel.querySelector('.panel-body').hidden, true, 'the floating panel starts closed');
  panel.querySelector('[data-action="toggle-panel"]').click();
  assert.equal(panel.querySelector('.panel-body').hidden, false);
  const checks = panel.querySelectorAll('input[data-section-id]');
  checks[1].focus();
  checks[1].checked = false;
  checks[1].dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.equal(panel.activeElement?.dataset.sectionId, checks[1].dataset.sectionId, 'panel checkbox keeps keyboard focus across render');
  const oldSecondUser = document.querySelectorAll('[data-message-author-role="user"]')[1];
  const prependUser = document.createElement('div'); prependUser.dataset.messageAuthorRole = 'user'; prependUser.textContent = 'Continue';
  const prependAssistant = document.createElement('div'); prependAssistant.dataset.messageAuthorRole = 'assistant'; prependAssistant.textContent = 'Earlier answer';
  document.querySelector('main').prepend(prependAssistant);
  document.querySelector('main').prepend(prependUser);
  controls.refresh();
  const retained = controls.capture('preview').sections.find(section => section.label === 'Continue' && section.id === checks[1].dataset.sectionId);
  assert.ok(retained, 'the existing duplicate section keeps its ID after an identical prompt is prepended');
  assert.equal(retained.selected, false);
  assert.ok(oldSecondUser.isConnected);
  controls.destroy();
  dom.window.close();
});

test('immediate DOM replacement before export keeps matching section selection', () => {
  const dom = page();
  const { document } = dom.window;
  installCollapseStyle(document);
  const controls = createCaptureControls(document, dom.window);
  const headers = [...document.querySelectorAll('.idea-capture-section-header')];
  const secondId = headers[1].querySelector('input').dataset.ideaSectionId;
  const secondCheckbox = headers[1].querySelector('input');
  secondCheckbox.checked = false;
  secondCheckbox.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

  // Simulate a site replacing its conversation before the popup requests export.
  document.querySelector('main').innerHTML = `
    <div data-message-author-role="user">Continue</div><div data-message-author-role="assistant">Replacement first answer</div>
    <div data-message-author-role="user">Continue</div><div data-message-author-role="assistant">Replacement second answer</div>`;
  const exported = controls.capture('export');
  assert.equal(exported.sections.find(section => section.id === secondId).selected, false);
  assert.equal(exported.messages.length, 2);
  assert.match(exported.messages[1].markdown, /Replacement first answer/);
  assert.doesNotMatch(exported.messages.map(message => message.markdown).join('\n'), /Replacement second answer/);
  controls.destroy();
  dom.window.close();
});

test('replacing only a user node preserves its section state through immediate export', () => {
  const dom = page();
  const { document } = dom.window;
  installCollapseStyle(document);
  const controls = createCaptureControls(document, dom.window);
  const secondHeader = [...document.querySelectorAll('.idea-capture-section-header')][1];
  const secondId = secondHeader.querySelector('input').dataset.ideaSectionId;
  secondHeader.querySelector('button').click();
  const checkbox = document.querySelector(`.idea-capture-section-header input[data-idea-section-id="${secondId}"]`);
  checkbox.checked = false;
  checkbox.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

  const oldUser = [...document.querySelectorAll('[data-message-author-role="user"]')][1];
  const replacementUser = document.createElement('div');
  replacementUser.dataset.messageAuthorRole = 'user';
  replacementUser.textContent = oldUser.textContent;
  oldUser.replaceWith(replacementUser);

  const exported = controls.capture('export');
  const secondSection = exported.sections.find(section => section.id === secondId);
  assert.equal(secondSection.selected, false);
  assert.equal(secondSection.collapsed, true);
  assert.equal(exported.messages.length, 2);
  assert.ok(replacementUser.classList.contains('idea-capture-section-collapsed'));
  assert.ok(document.querySelectorAll('[data-message-author-role="assistant"]')[1].classList.contains('idea-capture-section-collapsed'));
  controls.destroy();
  dom.window.close();
});

test('destroy and reinstall removes only owned DOM, styles, listeners, and collapse classes', () => {
  const dom = page();
  const { document } = dom.window;
  const pageHost = document.createElement('div'); pageHost.id = 'idea-capture-controls'; pageHost.textContent = 'page-owned'; document.body.append(pageHost);
  const pageStyle = document.createElement('style'); pageStyle.id = 'idea-capture-section-style'; document.head.append(pageStyle);
  installCollapseStyle(document);
  const controls = createCaptureControls(document, dom.window);
  assert.equal(pageHost.textContent, 'page-owned');
  assert.ok(document.querySelector('[data-idea-capture-owned="host"]')?.id !== pageHost.id);
  assert.equal(document.querySelectorAll('style[data-idea-capture-owned="style"]').length, 1);
  const message = document.querySelector('[data-message-author-role="user"]');
  document.querySelector('.idea-capture-section-header button').click();
  assert.ok(message.classList.contains('idea-capture-section-collapsed'));
  controls.destroy();
  assert.ok(!message.classList.contains('idea-capture-section-collapsed'));
  assert.equal(document.querySelectorAll('[data-idea-capture-owned="host"]').length, 0);
  assert.equal(document.querySelectorAll('style[data-idea-capture-owned="style"]').length, 0);
  assert.equal(document.getElementById('idea-capture-section-style'), pageStyle);
  installCollapseStyle(document);
  const reinstalled = createCaptureControls(document, dom.window);
  assert.equal(document.querySelectorAll('[data-idea-capture-owned="host"]').length, 1);
  reinstalled.destroy();
  dom.window.close();
});
