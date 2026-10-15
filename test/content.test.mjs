import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

test('capture controls follow SPA routes and updated capture settings', async t => {
  const dom = new JSDOM('<!doctype html><html><body><main><div data-message-author-role="user">Prompt</div><div data-message-author-role="assistant">Answer</div></main></body></html>', {
    url: 'https://chatgpt.com/', pretendToBeVisual: true,
  });
  const previous = {
    document: globalThis.document, window: globalThis.window, chrome: globalThis.chrome,
    controller: globalThis.__ideaCaptureController, version: globalThis.__ideaCaptureControllerVersion, status: globalThis.__ideaCapture,
    boot: globalThis.__ideaCaptureBoot, acceptSites: globalThis.__ideaCaptureAcceptSites,
    listenerInstalled: globalThis.__ideaCaptureSettingsMessageListenerInstalled,
    siteError: globalThis.__ideaCaptureSiteError,
    generation: globalThis.__ideaCaptureExecutionGeneration,
  };
  const pagePushState = dom.window.history.pushState.bind(dom.window.history);
  let captureSites = [{ origin: 'https://chatgpt.com', subpathsOnly: true }];
  let onMessage;
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.chrome = {
    runtime: {
      getManifest: () => ({ version: '0.3.1' }), id: 'test-extension',
      sendMessage: async () => ({ ok: true, captureSites }),
      onMessage: { addListener: listener => { onMessage = listener; } },
    },
  };
  delete globalThis.__ideaCaptureController;
  delete globalThis.__ideaCaptureControllerVersion;
  t.after(() => {
    globalThis.__ideaCaptureController?.destroy?.();
    dom.window.close();
    for (const [key, value] of Object.entries({ document: previous.document, window: previous.window, chrome: previous.chrome })) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
    if (previous.controller === undefined) delete globalThis.__ideaCaptureController; else globalThis.__ideaCaptureController = previous.controller;
    if (previous.version === undefined) delete globalThis.__ideaCaptureControllerVersion; else globalThis.__ideaCaptureControllerVersion = previous.version;
    if (previous.status === undefined) delete globalThis.__ideaCapture; else globalThis.__ideaCapture = previous.status;
    if (previous.boot === undefined) delete globalThis.__ideaCaptureBoot; else globalThis.__ideaCaptureBoot = previous.boot;
    if (previous.acceptSites === undefined) delete globalThis.__ideaCaptureAcceptSites; else globalThis.__ideaCaptureAcceptSites = previous.acceptSites;
    if (previous.listenerInstalled === undefined) delete globalThis.__ideaCaptureSettingsMessageListenerInstalled; else globalThis.__ideaCaptureSettingsMessageListenerInstalled = previous.listenerInstalled;
    if (previous.siteError === undefined) delete globalThis.__ideaCaptureSiteError; else globalThis.__ideaCaptureSiteError = previous.siteError;
    if (previous.generation === undefined) delete globalThis.__ideaCaptureExecutionGeneration; else globalThis.__ideaCaptureExecutionGeneration = previous.generation;
  });

  await import(`../src/content.js?route-${Date.now()}`);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(globalThis.__ideaCapture.ok, false, 'wildcard must not enable controls at the root');
  pagePushState({}, '', '/c/1');
  await new Promise(resolve => setTimeout(resolve, 550));
  assert.ok(globalThis.__ideaCaptureController, 'controls should activate when the SPA enters a non-root path');
  pagePushState({}, '', '/');
  await new Promise(resolve => setTimeout(resolve, 550));
  assert.equal(globalThis.__ideaCaptureController, undefined, 'controls should be removed when the SPA returns to root');

  captureSites = [{ origin: 'https://chatgpt.com', homepageOnly: true }];
  onMessage({ type: 'capture-sites-updated', captureSites });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(globalThis.__ideaCapture.ok, true, 'a root-only setting update should activate controls at root');
});

test('a settings broadcast wins over an older pending site-pattern query', async t => {
  const dom = new JSDOM('<!doctype html><html><body><main><div data-message-author-role="user">Prompt</div><div data-message-author-role="assistant">Answer</div></main></body></html>', {
    url: 'https://chatgpt.com/', pretendToBeVisual: true,
  });
  const saved = Object.fromEntries(['document', 'window', 'chrome', '__ideaCapture', '__ideaCaptureController', '__ideaCaptureControllerVersion', '__ideaCaptureBoot', '__ideaCaptureAcceptSites', '__ideaCaptureSettingsMessageListenerInstalled', '__ideaCaptureSiteError'].map(key => [key, globalThis[key]]));
  let resolveInitialResponse;
  let onMessage;
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.chrome = {
    runtime: {
      getManifest: () => ({ version: '0.3.1' }), id: 'test-extension',
      sendMessage: () => new Promise(resolve => { resolveInitialResponse = resolve; }),
      onMessage: { addListener: listener => { onMessage = listener; } },
    },
  };
  delete globalThis.__ideaCaptureController;
  delete globalThis.__ideaCaptureControllerVersion;
  t.after(() => {
    globalThis.__ideaCaptureController?.destroy?.();
    dom.window.close();
    for (const key of ['document', 'window', 'chrome']) {
      if (saved[key] === undefined) delete globalThis[key]; else globalThis[key] = saved[key];
    }
    for (const key of ['__ideaCapture', '__ideaCaptureController', '__ideaCaptureControllerVersion', '__ideaCaptureBoot', '__ideaCaptureAcceptSites', '__ideaCaptureSettingsMessageListenerInstalled', '__ideaCaptureSiteError']) {
      if (saved[key] === undefined) delete globalThis[key]; else globalThis[key] = saved[key];
    }
  });

  await import(`../src/content.js?settings-race-${Date.now()}`);
  const initialBoot = globalThis.__ideaCaptureBoot;
  const latestSites = [{ origin: 'https://chatgpt.com', homepageOnly: true }];
  onMessage({ type: 'capture-sites-updated', captureSites: latestSites });
  await globalThis.__ideaCaptureBoot;
  assert.ok(globalThis.__ideaCaptureController, 'the newly allowed root should activate immediately');

  resolveInitialResponse({ ok: true, captureSites: [{ origin: 'https://chatgpt.com', subpathsOnly: true }] });
  await initialBoot;
  assert.ok(globalThis.__ideaCaptureController, 'a stale initial query must not replace the newer root-only setting');
  assert.equal(globalThis.__ideaCapture.ok, true);
});

test('a pending boot from before reinjection cannot tear down the current controller', async t => {
  const dom = new JSDOM('<!doctype html><html><body><main><div data-message-author-role="user">Prompt</div><div data-message-author-role="assistant">Answer</div></main></body></html>', {
    url: 'https://chatgpt.com/', pretendToBeVisual: true,
  });
  const keys = ['document', 'window', 'chrome', '__ideaCapture', '__ideaCaptureController', '__ideaCaptureControllerVersion', '__ideaCaptureBoot', '__ideaCaptureAcceptSites', '__ideaCaptureSettingsMessageListenerInstalled', '__ideaCaptureSiteError', '__ideaCaptureExecutionGeneration'];
  const saved = Object.fromEntries(keys.map(key => [key, globalThis[key]]));
  let resolveOldResponse;
  let requests = 0;
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.chrome = {
    runtime: {
      getManifest: () => ({ version: '0.3.1' }), id: 'test-extension',
      sendMessage: () => ++requests === 1
        ? new Promise(resolve => { resolveOldResponse = resolve; })
        : Promise.resolve({ ok: true, captureSites: [{ origin: 'https://chatgpt.com', homepageOnly: true }] }),
      onMessage: { addListener: () => {} },
    },
  };
  delete globalThis.__ideaCaptureController;
  delete globalThis.__ideaCaptureControllerVersion;
  t.after(() => {
    globalThis.__ideaCaptureController?.destroy?.();
    dom.window.close();
    for (const key of keys) {
      if (saved[key] === undefined) delete globalThis[key]; else globalThis[key] = saved[key];
    }
  });

  await import(`../src/content.js?old-boot-${Date.now()}`);
  const oldBoot = globalThis.__ideaCaptureBoot;
  await import(`../src/content.js?new-boot-${Date.now()}`);
  await globalThis.__ideaCaptureBoot;
  const currentController = globalThis.__ideaCaptureController;
  assert.ok(currentController, 'the latest root-only settings should mount controls');

  resolveOldResponse({ ok: true, captureSites: [{ origin: 'https://chatgpt.com', subpathsOnly: true }] });
  await oldBoot;
  assert.equal(globalThis.__ideaCaptureController, currentController, 'an older injection must not tear down the latest controller');
  assert.equal(globalThis.__ideaCapture.ok, true);
});

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
    boot: globalThis.__ideaCaptureBoot, acceptSites: globalThis.__ideaCaptureAcceptSites,
    listenerInstalled: globalThis.__ideaCaptureSettingsMessageListenerInstalled,
    siteError: globalThis.__ideaCaptureSiteError,
    generation: globalThis.__ideaCaptureExecutionGeneration,
  };
  let oldDestroyed = false;
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.chrome = {
    runtime: {
      getManifest: () => ({ version: '0.3.1' }), id: 'test-extension',
      sendMessage: async () => ({ ok: true, captureSites: [{ origin: 'https://chatgpt.com', subpathsOnly: true }] }),
      onMessage: { addListener: () => {} },
    },
  };
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
    if (previous.boot === undefined) delete globalThis.__ideaCaptureBoot; else globalThis.__ideaCaptureBoot = previous.boot;
    if (previous.acceptSites === undefined) delete globalThis.__ideaCaptureAcceptSites; else globalThis.__ideaCaptureAcceptSites = previous.acceptSites;
    if (previous.listenerInstalled === undefined) delete globalThis.__ideaCaptureSettingsMessageListenerInstalled; else globalThis.__ideaCaptureSettingsMessageListenerInstalled = previous.listenerInstalled;
    if (previous.siteError === undefined) delete globalThis.__ideaCaptureSiteError; else globalThis.__ideaCaptureSiteError = previous.siteError;
    if (previous.generation === undefined) delete globalThis.__ideaCaptureExecutionGeneration; else globalThis.__ideaCaptureExecutionGeneration = previous.generation;
  });

  await import(`../src/content.js?stale-${Date.now()}`);
  await new Promise(resolve => {
    const deadline = Date.now() + 1000;
    const wait = () => {
      if (globalThis.__ideaCaptureController || Date.now() > deadline) return resolve();
      setTimeout(wait, 0);
    };
    wait();
  });
  const installed = globalThis.__ideaCaptureController;
  assert.equal(oldDestroyed, true);
  assert.ok(installed);
  assert.equal(globalThis.__ideaCaptureControllerVersion, '0.3.1');
  assert.equal(globalThis.__ideaCapture.ok, true);

  await import(`../src/content.js?current-${Date.now()}`);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(globalThis.__ideaCaptureController, installed, 'same-version reinjection preserves the current controller');

  const oldHost = document.querySelector('[data-idea-capture-owned="host"]');
  const roleNode = document.querySelector('[data-message-author-role="assistant"]');
  roleNode.classList.add('idea-capture-section-collapsed');
  roleNode.setAttribute('data-idea-capture-collapse-state', 'false');
  delete globalThis.__ideaCaptureController;
  delete globalThis.__ideaCaptureControllerVersion;
  await import(`../src/content.js?orphan-${Date.now()}`);
  await new Promise(resolve => {
    const deadline = Date.now() + 1000;
    const wait = () => {
      if (globalThis.__ideaCaptureController || Date.now() > deadline) return resolve();
      setTimeout(wait, 0);
    };
    wait();
  });
  assert.notEqual(globalThis.__ideaCaptureController, installed, 'a surviving orphan host is rebuilt when controller globals were reset');
  assert.ok(!oldHost.isConnected);
  assert.ok(!roleNode.classList.contains('idea-capture-section-collapsed'), 'orphan collapse state is restored from its marker');
  assert.ok(document.querySelector('[data-idea-capture-owned="host"]')?.getAttribute('data-idea-capture-version') === '0.3.1');
  assert.ok(document.querySelector('[data-idea-capture-owned="host"]').shadowRoot.querySelector('[data-diagnostics-fallback]'));
});
