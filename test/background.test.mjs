import test from 'node:test';
import assert from 'node:assert/strict';
import { handleActionClick } from '../src/action.js';

test('toolbar opens settings on browser pages without trying to inject', async () => {
  let opened = 0;
  let injected = 0;
  const result = await handleActionClick({ id: 1, url: 'chrome://extensions' }, {
    getSettings: async () => { throw new Error('must not read settings'); },
    openOptions: async () => { opened++; },
    injectCapture: async () => { injected++; },
  });
  assert.equal(result.settingsOpened, true);
  assert.equal(opened, 1);
  assert.equal(injected, 0);
});

test('toolbar opens settings for excluded sites and never injects them', async () => {
  let opened = 0;
  let injected = 0;
  const result = await handleActionClick({ id: 2, url: 'https://chatgpt.com/c/123' }, {
    getSettings: async () => ({ allowedOrigins: ['https://chatgpt.com'] }),
    openOptions: async () => { opened++; },
    injectCapture: async () => { injected++; },
  });
  assert.deepEqual(result, { settingsOpened: true, excluded: true });
  assert.equal(opened, 1);
  assert.equal(injected, 0);
});

test('toolbar injects only when the saved capture pattern allows the current URL', async () => {
  let opened = 0;
  const injected = [];
  const result = await handleActionClick({ id: 3, url: 'https://chatgpt.com/c/123' }, {
    getSettings: async () => ({ allowedOrigins: ['https://chatgpt.com/*'] }),
    openOptions: async () => { opened++; },
    injectCapture: async tabId => { injected.push(tabId); },
  });
  assert.deepEqual(result, { captured: true });
  assert.equal(opened, 0);
  assert.deepEqual(injected, [3]);
});

test('toolbar falls back to settings when site access prevents injection', async () => {
  let opened = 0;
  const result = await handleActionClick({ id: 4, url: 'https://chatgpt.com/c/123' }, {
    getSettings: async () => ({ allowedOrigins: ['https://chatgpt.com/*'] }),
    openOptions: async () => { opened++; },
    injectCapture: async () => { throw new Error('scripting access denied'); },
  });
  assert.equal(result.settingsOpened, true);
  assert.match(result.error.message, /access denied/);
  assert.equal(opened, 1);
});

test('get-capture-sites background response exposes only allowlist patterns', async () => {
  const listeners = {};
  const event = name => ({ addListener: callback => { listeners[name] = callback; } });
  const chrome = {
    runtime: {
      id: 'extension-id', getURL: path => `chrome-extension://extension-id/${path}`,
      onInstalled: event('installed'), onStartup: event('startup'), onMessage: event('message'),
    },
    contextMenus: { removeAll: async () => {}, create() {}, onClicked: event('menu') },
    alarms: { onAlarm: event('alarm'), create: async () => {}, clear: async () => {} },
    action: { onClicked: event('action'), setBadgeText: async () => {}, setTitle: async () => {}, setBadgeBackgroundColor: async () => {} },
    storage: {
      local: { get: async () => ({ settings: { allowedOrigins: ['https://chatgpt.com/*'], queueToken: 'private-token', appUrl: 'https://private.example' } }), setAccessLevel: async () => {} },
      onChanged: event('storage'),
    },
  };
  globalThis.chrome = chrome;
  try {
    await import(`../src/background.js?test=${Date.now()}`);
    let response;
    const pending = listeners.message({ type: 'get-capture-sites' }, { id: 'extension-id', tab: { id: 10 }, url: 'https://chatgpt.com/c/123' }, value => { response = value; });
    assert.equal(pending, true);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(response, { ok: true, captureSites: [{ origin: 'https://chatgpt.com', subpathsOnly: true }] });
    assert.doesNotMatch(JSON.stringify(response), /private-token|private\.example/);
  } finally {
    delete globalThis.chrome;
  }
});
