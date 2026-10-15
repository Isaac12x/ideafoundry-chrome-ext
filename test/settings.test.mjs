import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { defaults, withDefaults, validateSettings } from '../src/shared.js';

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
