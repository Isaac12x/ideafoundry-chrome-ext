import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { defaults, withDefaults, validateSettings, urlMatchesCaptureSites, parseCaptureSitePattern, resolveCaptureSites } from '../src/shared.js';

test('IdeaFoundry uses 8443 and upgrades only the previous bundled address', () => {
  assert.equal(defaults.appUrl, 'https://ideas.local:8443');
  assert.equal(withDefaults({ appUrl: 'http://localhost:3000' }).appUrl, defaults.appUrl);
  assert.equal(validateSettings({ appUrl: 'http://localhost:3000' }).appUrl, defaults.appUrl);
  assert.equal(withDefaults({ appUrl: 'https://research.local:9443' }).appUrl, 'https://research.local:9443');
});

test('HTTP(S) access is declared as required host permission, not requested per site', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.host_permissions, ['http://*/*', 'https://*/*']);
  assert.equal('optional_host_permissions' in manifest, false);
  const options = await readFile(new URL('../src/options.js', import.meta.url), 'utf8');
  assert.doesNotMatch(options, /chrome\.permissions\.request/);
});

test('queue base URL accepts an optional path and migrates only the old default', () => {
  assert.equal(defaults.queueUrl, 'https://ideas.local:8443/api/v1/capture');
  assert.equal(validateSettings({}).queueUrl, defaults.queueUrl);
  assert.equal(validateSettings({ queueUrl: 'https://ideas.local:8443/api/v1/capture/' }).queueUrl, defaults.queueUrl);
  assert.equal(validateSettings({ queueUrl: 'http://localhost:4318' }).queueUrl, defaults.queueUrl);
  assert.equal(validateSettings({ queueUrl: 'http://localhost:4318/' }).queueUrl, 'http://localhost:4318');
  assert.equal(validateSettings({ queueUrl: 'http://localhost:4318', remoteEnabled: true, queueToken: 'x'.repeat(40), allowedOrigins: ['https://claude.ai'] }).queueUrl, 'http://localhost:4318');
  assert.equal(validateSettings({ queueUrl: 'http://127.0.0.1:9000' }).queueUrl, 'http://127.0.0.1:9000');
  assert.equal(validateSettings({ queueUrl: 'https://q.example/base/x' }).queueUrl, 'https://q.example/base/x');
  for (const bad of ['https://q.example/a?x=1', 'https://q.example/a#f', 'http://q.example/a', 'ftp://q.example', 'https://u:p@q.example']) assert.throws(() => validateSettings({ queueUrl: bad }), bad);
  assert.throws(() => validateSettings({ appUrl: 'https://ideas.local:8443/path' }));
});

test('capture URL patterns distinguish site root from subpaths', () => {
  const sites = [parseCaptureSitePattern('https://chatgpt.com'), parseCaptureSitePattern('https://claude.ai/*')];
  assert.equal(urlMatchesCaptureSites('https://chatgpt.com/', sites), true);
  assert.equal(urlMatchesCaptureSites('https://chatgpt.com?model=x', sites), true);
  assert.equal(urlMatchesCaptureSites('https://chatgpt.com/?model=x', sites), true);
  assert.equal(urlMatchesCaptureSites('https://chatgpt.com/c/abc', sites), false);
  assert.equal(urlMatchesCaptureSites('https://claude.ai/chat/1', sites), true);
  assert.equal(urlMatchesCaptureSites('https://claude.ai/', sites), false);
  assert.throws(() => parseCaptureSitePattern('https://chatgpt.com/c/*'));
});

test('bare ChatGPT site pattern remains root-only while wildcard allows only non-root paths', () => {
  const root = resolveCaptureSites({ allowedOrigins: ['https://chatgpt.com'] });
  const wildcard = resolveCaptureSites({ allowedOrigins: ['https://chatgpt.com/*'] });
  for (const href of ['https://chatgpt.com', 'https://chatgpt.com/', 'https://chatgpt.com/?model=x']) {
    assert.equal(urlMatchesCaptureSites(href, root), true, `${href} should match the root pattern`);
    assert.equal(urlMatchesCaptureSites(href, wildcard), false, `${href} should not match the wildcard pattern`);
  }
  assert.equal(urlMatchesCaptureSites('https://chatgpt.com/c/abc', root), false);
  assert.equal(urlMatchesCaptureSites('https://chatgpt.com/c/abc', wildcard), true);
  assert.deepEqual(withDefaults({ allowedOrigins: ['https://chatgpt.com'] }).allowedOrigins, ['https://chatgpt.com']);
});

test('capture sites resolve without validating KB or queue settings', () => {
  const sites = resolveCaptureSites({ appUrl: 'http://invalid-remote.example', allowedOrigins: ['https://chatgpt.com/*'] });
  assert.equal(urlMatchesCaptureSites('https://chatgpt.com/g/g-demo/c/123', sites), true);
  assert.equal(urlMatchesCaptureSites('https://chat.openai.com/g/g-demo/c/123', sites), true);
});

test('capture origin matching preserves explicit ports', () => {
  const sites = resolveCaptureSites({ allowedOrigins: ['https://chatgpt.com:8443/*'] });
  assert.equal(urlMatchesCaptureSites('https://chatgpt.com:8443/c/1', sites), true);
  assert.equal(urlMatchesCaptureSites('https://chatgpt.com/c/1', sites), false);
  assert.equal(urlMatchesCaptureSites('https://chat.openai.com:8443/c/1', sites), false);
});
