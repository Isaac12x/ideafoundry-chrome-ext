import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTarget, normalizeProjects, chooseProject } from '../src/shared.js';
import { listProjectsInApp } from '../src/kb-upload.js';

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

function inApp(response) {
  globalThis.location = { origin: 'https://app.test' };
  globalThis.fetch = async () => { if (response instanceof Error) throw response; return response; };
}
const reply = (status, body, type = 'application/json') => ({ status, ok: status < 400, headers: { get: () => type }, json: async () => body });

test('project listing degrades to a reason when the app is older, locked, or unreachable', async () => {
  inApp(reply(200, { projects: [{ source: 0, rel: 'F', name: 'F', locked: false }] }));
  assert.deepEqual(await listProjectsInApp({ appUrl: 'https://app.test' }), { ok: true, projects: [{ source: 0, rel: 'F', name: 'F', locked: false }] });
  inApp(reply(404, {}));
  const old = await listProjectsInApp({ appUrl: 'https://app.test' });
  assert.equal(old.ok, false); assert.equal(old.unsupported, true);
  inApp(reply(200, null, 'text/html')); // typing lock redirects to an HTML page
  assert.match((await listProjectsInApp({ appUrl: 'https://app.test' })).error, /Unlock/);
  inApp(new Error('Failed to fetch'));
  assert.equal((await listProjectsInApp({ appUrl: 'https://app.test' })).error, 'Failed to fetch');
  assert.equal((await listProjectsInApp({ appUrl: 'https://other.test' })).ok, false);
});
