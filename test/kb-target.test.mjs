import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTarget, normalizeProjects, chooseProject } from '../src/shared.js';
import { listKbProjects, uploadToKb } from '../src/kb-upload.js';

test('target validation reuses the source/directory rules and treats absence as the default', () => {
  assert.deepEqual(validateTarget(undefined), {});
  assert.deepEqual(validateTarget({ source: 1, directory: ' Ferment/Notes ' }), { source: 1, directory: 'Ferment/Notes' });
  for (const bad of [{ source: -1, directory: 'a' }, { source: 'x', directory: 'a' }, { source: 0, directory: '../a' }, { source: 0, directory: '/abs' }, { source: 0, directory: 5 }, {}]) {
    assert.throws(() => validateTarget(bad), JSON.stringify(bad));
  }
});

test('app project rows are sanitized before the widget sees them', () => {
  assert.deepEqual(normalizeProjects('nope'), []);
  const rows = normalizeProjects([
    { source: 0, rel: 'Ferment', name: 'Ferment', locked: false },
    { source: 1, rel: 'A/B', name: 'B', locked: true },
    { source: 0, rel: '../x', name: 'evil' },
    { source: 'a', rel: 'Y', name: 'Y' },
    { source: 0, rel: '', name: 'root' },
    null,
  ]);
  assert.deepEqual(rows, [{ source: 0, rel: 'Ferment', name: 'Ferment', locked: false }, { source: 1, rel: 'A/B', name: 'B', locked: true }]);
});

test('chosen project resolution: cached lists keep an unconfirmed project, fresh lists drop gone or locked ones', () => {
  const projects = [{ source: 0, rel: 'Ferment', name: 'Ferment', locked: false }, { source: 1, rel: 'Sealed', name: 'Sealed', locked: true }];
  const want = (source, directory) => ({ source, directory, name: directory });
  assert.deepEqual(chooseProject(projects, want(0, 'Ferment'), true), { list: projects, index: 0, missing: false });
  assert.deepEqual(chooseProject(projects, want(0, 'Gone'), true), { list: projects, index: -1, missing: true });
  assert.deepEqual(chooseProject(projects, want(1, 'Sealed'), false), { list: projects, index: -1, missing: true });
  const cached = chooseProject([], want(0, 'Ferment'), false); // remembered before any list load
  assert.equal(cached.index, 0); assert.equal(cached.list[0].rel, 'Ferment'); assert.equal(cached.missing, false);
  assert.equal(chooseProject([], want(0, 'Ferment'), true).missing, true);
  for (const wanted of [null, undefined, { default: true }]) assert.deepEqual(chooseProject(projects, wanted, true), { list: projects, index: -1, missing: false });
});

const config = { appUrl: 'https://app.test', queueUrl: 'https://app.test/api/v1/capture', queueToken: 'k'.repeat(40) };
const reply = (status, body) => ({ status, ok: status < 400, json: async () => body });
let seen;
function api(response) {
  seen = [];
  globalThis.fetch = async (url, init) => { seen.push({ url, init }); if (response instanceof Error) throw response; return response; };
}
const file = { name: 'a.md', mime: 'text/plain', base64: 'aGk=' };

test('KB calls use the Bearer key on the capture base and map errors', async () => {
  api(reply(200, { projects: [{ source: 0, rel: 'F', name: 'F', locked: false }] }));
  assert.deepEqual(await listKbProjects(config), [{ source: 0, rel: 'F', name: 'F', locked: false }]);
  assert.equal(seen[0].url, 'https://app.test/api/v1/capture/kb/projects');
  assert.equal(seen[0].init.headers.Authorization, `Bearer ${config.queueToken}`);
  api(reply(200, { ok: true, files: [] }));
  assert.equal((await uploadToKb(file, config, { source: 1, directory: 'd' })).name, 'a.md');
  assert.equal(seen[0].url, 'https://app.test/api/v1/capture/kb/upload');
  assert.equal(seen[0].init.body.get('src'), '1'); assert.equal(seen[0].init.body.get('files[]').name, 'a.md');
  api(reply(401, {}));
  await assert.rejects(listKbProjects(config), /API key invalid — update it in extension options/);
  api(reply(422, { error: 'Folder is locked.' }));
  await assert.rejects(uploadToKb(file, config, { source: 0, directory: 'd' }), /^Error: Folder is locked\.$/);
  api(new TypeError('Failed to fetch'));
  await assert.rejects(uploadToKb(file, config, { source: 0, directory: 'd' }), /Idea app not reachable/);
});

test('no key means no network call', async () => {
  api(reply(200, {}));
  const keyless = { ...config, queueToken: '' };
  await assert.rejects(listKbProjects(keyless), /Add an API key/);
  await assert.rejects(uploadToKb(file, keyless, { source: 0, directory: 'd' }), /Add an API key/);
  assert.equal(seen.length, 0);
});
