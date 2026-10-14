import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

test('content reinjection replaces a controller from an older extension version and reuses the current one', async t => {
  const dom = new JSDOM('<!doctype html><html><body><main><div data-message-author-role="user">Prompt</div><div data-message-author-role="assistant">Answer</div></main></body></html>', {
    url: 'https://chatgpt.com/c/1', pretendToBeVisual: true,
  });
  const previous = {
    document: globalThis.document,
    window: globalThis.window,
    chrome: globalThis.chrome,
    controller: globalThis.__ideaCaptureController,
    version: globalThis.__ideaCaptureControllerVersion,
    status: globalThis.__ideaCapture,
  };
  let oldDestroyed = false;
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.chrome = { runtime: { getManifest: () => ({ version: '0.3.1' }) } };
  globalThis.__ideaCaptureController = { destroy() { oldDestroyed = true; } };
  globalThis.__ideaCaptureControllerVersion = '0.3.0';
  t.after(() => {
    globalThis.__ideaCaptureController?.destroy?.();
    dom.window.close();
    for (const [key, value] of Object.entries({ document: previous.document, window: previous.window, chrome: previous.chrome })) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
    if (previous.controller === undefined) delete globalThis.__ideaCaptureController; else globalThis.__ideaCaptureController = previous.controller;
    if (previous.version === undefined) delete globalThis.__ideaCaptureControllerVersion; else globalThis.__ideaCaptureControllerVersion = previous.version;
    if (previous.status === undefined) delete globalThis.__ideaCapture; else globalThis.__ideaCapture = previous.status;
  });

  await import(`../src/content.js?stale-${Date.now()}`);
  const installed = globalThis.__ideaCaptureController;
  assert.equal(oldDestroyed, true);
  assert.ok(installed);
  assert.equal(globalThis.__ideaCaptureControllerVersion, '0.3.1');
  assert.equal(globalThis.__ideaCapture.ok, true);

  await import(`../src/content.js?current-${Date.now()}`);
  assert.equal(globalThis.__ideaCaptureController, installed, 'same-version reinjection preserves the current controller');

  const oldHost = document.querySelector('[data-idea-capture-owned="host"]');
  const roleNode = document.querySelector('[data-message-author-role="assistant"]');
  roleNode.classList.add('idea-capture-section-collapsed');
  roleNode.setAttribute('data-idea-capture-collapse-state', 'false');
  delete globalThis.__ideaCaptureController;
  delete globalThis.__ideaCaptureControllerVersion;
  await import(`../src/content.js?orphan-${Date.now()}`);
  assert.notEqual(globalThis.__ideaCaptureController, installed, 'a surviving orphan host is rebuilt when controller globals were reset');
  assert.ok(!oldHost.isConnected);
  assert.ok(!roleNode.classList.contains('idea-capture-section-collapsed'), 'orphan collapse state is restored from its marker');
  assert.ok(document.querySelector('[data-idea-capture-owned="host"]')?.getAttribute('data-idea-capture-version') === '0.3.1');
  assert.ok(document.querySelector('[data-idea-capture-owned="host"]').shadowRoot.querySelector('[data-diagnostics-fallback]'));
});
