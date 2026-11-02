import test from 'node:test';
import assert from 'node:assert/strict';

// Drive the real background worker with a chrome mock: capture its onMessage listener and call it.
const store = {};
const calls = { create: 0, remove: 0, exec: 0 };
let appTabs = [];
let listing = { ok: true, projects: [{ source: 0, rel: 'Ferment', name: 'Ferment', locked: false }] };
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
  tabs: {
    query: async () => appTabs,
    create: async () => { calls.create++; return { id: 99 }; },
    get: async () => ({ status: 'complete' }),
    remove: async () => { calls.remove++; },
  },
  scripting: { executeScript: async () => { calls.exec++; return [{ result: listing }]; } },
};
await import('../src/background.js');

const send = message => new Promise(resolve => onMessage(message, { id: 'me', tab: { id: 1 }, url: 'https://chatgpt.com/' }, resolve));
const reset = () => { for (const k of Object.keys(store)) delete store[k]; calls.create = calls.remove = calls.exec = 0; appTabs = []; };

test('panel open without an app tab opens no hidden tab and serves the cached list', async () => {
  reset();
  store.kbProjectsCache = { appUrl: 'https://ideas.local:8443', projects: [{ source: 0, rel: 'Cached', name: 'Cached', locked: false }] };
  store.lastKbTarget = { source: 0, directory: 'Cached', name: 'Cached' };
  const reply = await send({ type: 'kb-projects', hidden: false });
  assert.equal(calls.create, 0);
  assert.equal(calls.exec, 0);
  assert.equal(reply.fresh, false);
  assert.deepEqual(reply.projects.map(p => p.rel), ['Cached']);
  assert.equal(reply.remembered.directory, 'Cached');
});

test('menu focus may open a hidden tab, closes it, and refreshes the cache', async () => {
  reset();
  const reply = await send({ type: 'kb-projects', hidden: true });
  assert.equal(calls.create, 1);
  assert.equal(calls.remove, 1);
  assert.equal(reply.fresh, true);
  assert.deepEqual(store.kbProjectsCache.projects.map(p => p.rel), ['Ferment']);
});

test('an already-open app tab refreshes on panel open without a hidden tab; a failed refresh keeps the cache', async () => {
  reset();
  store.kbProjectsCache = { appUrl: 'https://ideas.local:8443', projects: [{ source: 0, rel: 'Old', name: 'Old', locked: false }] };
  appTabs = [{ id: 5 }];
  let reply = await send({ type: 'kb-projects', hidden: false });
  assert.equal(calls.create, 0);
  assert.deepEqual(reply.projects.map(p => p.rel), ['Ferment']); // refreshed list replaces the cache
  listing = { ok: false, error: 'Unlock the IdeaFoundry workspace to list projects.' };
  reply = await send({ type: 'kb-projects', hidden: false });
  listing = { ok: true, projects: [{ source: 0, rel: 'Ferment', name: 'Ferment', locked: false }] };
  assert.equal(reply.fresh, false);
  assert.match(reply.unavailable, /Unlock/);
  assert.deepEqual(reply.projects.map(p => p.rel), ['Ferment']);
});

test('the choice is remembered on change, including an explicit default', async () => {
  reset();
  await send({ type: 'kb-remember', target: { source: 2, directory: 'Deep/Proj', name: 'Proj' } });
  assert.deepEqual(store.lastKbTarget, { source: 2, directory: 'Deep/Proj', name: 'Proj' });
  assert.equal((await send({ type: 'kb-projects', hidden: false })).remembered.name, 'Proj');
  await send({ type: 'kb-remember', target: null });
  assert.deepEqual(store.lastKbTarget, { default: true });
  const bad = await send({ type: 'kb-remember', target: { source: 0, directory: '../x', name: 'x' } });
  assert.equal(bad.ok, false);
  assert.deepEqual(store.lastKbTarget, { default: true });
});

test('a cache from another app address is ignored', async () => {
  reset();
  store.kbProjectsCache = { appUrl: 'https://elsewhere.test', projects: [{ source: 0, rel: 'X', name: 'X', locked: false }] };
  assert.deepEqual((await send({ type: 'kb-projects', hidden: false })).projects, []);
});
