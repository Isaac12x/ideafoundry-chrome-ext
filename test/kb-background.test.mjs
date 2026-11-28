import test from 'node:test';
import assert from 'node:assert/strict';

// Drive the real background worker with a chrome mock: capture its onMessage listener and call it.
const store = {};
const calls = { fetch: 0 };
let apiReply = { status: 200, body: { projects: [{ source: 0, rel: 'Ferment', name: 'Ferment', locked: false }] } };
globalThis.fetch = async () => { calls.fetch++; return { status: apiReply.status, ok: apiReply.status < 400, json: async () => apiReply.body }; };
const noop = { addListener() {} };
let onMessage;
globalThis.chrome = {
  runtime: { id: 'me', getURL: path => `chrome-extension://me/${path}`, onInstalled: noop, onStartup: noop, onMessage: { addListener: fn => { onMessage = fn; } } },
  contextMenus: { onClicked: noop }, alarms: { onAlarm: noop }, action: { onClicked: noop },
  storage: {
    onChanged: noop,
    local: {
      get: async keys => Object.fromEntries([].concat(keys).filter(k => k in store).map(k => [k, store[k]])),
      set: async values => Object.assign(store, values),
    },
  },
  permissions: { contains: async () => true },
};
await import('../src/background.js');

const send = message => new Promise(resolve => onMessage(message, { id: 'me', tab: { id: 1 }, url: 'https://chatgpt.com/' }, resolve));
const conversation = { title: 'T', url: 'https://chatgpt.com/c/1', messages: [{ role: 'user', text: 'hi' }] };
const sendKb = () => new Promise(resolve => onMessage({ type: 'export', destination: 'kb', format: 'md', conversation }, { id: 'me', url: 'chrome-extension://me/popup.html' }, resolve));
chrome.offscreen = { hasDocument: async () => true };
chrome.runtime.sendMessage = async () => ({ ok: true, name: 'x.md', mime: 'text/markdown', base64: 'aGk=' });
const reset = () => { for (const k of Object.keys(store)) delete store[k]; calls.fetch = 0; store.settings = { queueToken: 'k'.repeat(40) }; };

test('projects refresh from the API and cache; a failed refresh keeps the cache', async () => {
  reset();
  store.kbProjectsCache = { appUrl: 'https://ideas.local:8443', projects: [{ source: 0, rel: 'Old', name: 'Old', locked: false }] };
  let reply = await send({ type: 'kb-projects' });
  assert.equal(reply.fresh, true);
  assert.deepEqual(reply.projects.map(p => p.rel), ['Ferment']);
  assert.deepEqual(store.kbProjectsCache.projects.map(p => p.rel), ['Ferment']);
  apiReply = { status: 401, body: {} };
  reply = await send({ type: 'kb-projects' });
  apiReply = { status: 200, body: { projects: [{ source: 0, rel: 'Ferment', name: 'Ferment', locked: false }] } };
  assert.equal(reply.fresh, false);
  assert.match(reply.unavailable, /API key invalid/);
  assert.deepEqual(reply.projects.map(p => p.rel), ['Ferment']);
});

test('without an API key the list and send make no network call and say why', async () => {
  reset(); delete store.settings;
  const reply = await send({ type: 'kb-projects' });
  assert.match(reply.noKey, /Add an API key/);
  assert.match((await sendKb()).error, /Add an API key/);
  assert.equal(calls.fetch, 0);
});

test('the choice is remembered on change, including an explicit default', async () => {
  reset();
  await send({ type: 'kb-remember', target: { source: 2, directory: 'Deep/Proj', name: 'Proj' } });
  assert.deepEqual(store.lastKbTarget, { source: 2, directory: 'Deep/Proj', name: 'Proj' });
  assert.equal((await send({ type: 'kb-projects' })).remembered.name, 'Proj');
  await send({ type: 'kb-remember', target: null });
  assert.deepEqual(store.lastKbTarget, { default: true });
  const bad = await send({ type: 'kb-remember', target: { source: 0, directory: '../x', name: 'x' } });
  assert.equal(bad.ok, false);
  assert.deepEqual(store.lastKbTarget, { default: true });
});

test('a cache from another app address is ignored', async () => {
  reset(); delete store.settings;
  store.kbProjectsCache = { appUrl: 'https://elsewhere.test', projects: [{ source: 0, rel: 'X', name: 'X', locked: false }] };
  assert.deepEqual((await send({ type: 'kb-projects' })).projects, []);
});

test('KB upload posts straight to the API; 422 text surfaces', async () => {
  reset();
  apiReply = { status: 200, body: { ok: true, files: [] } };
  const ok = await sendKb(); assert.equal(ok.name, 'x.md', JSON.stringify(ok));
  apiReply = { status: 422, body: { error: 'Folder is locked.' } };
  assert.equal((await sendKb()).error, 'Folder is locked.');
  assert.equal(calls.fetch, 2);
});
