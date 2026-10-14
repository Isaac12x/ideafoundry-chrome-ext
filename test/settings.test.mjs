import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, withDefaults, validateSettings } from '../src/shared.js';

test('IdeaFoundry uses 8443 and upgrades only the previous bundled address', () => {
  assert.equal(defaults.appUrl, 'https://ideas.local:8443');
  assert.equal(withDefaults({ appUrl: 'http://localhost:3000' }).appUrl, defaults.appUrl);
  assert.equal(validateSettings({ appUrl: 'http://localhost:3000' }).appUrl, defaults.appUrl);
  assert.equal(withDefaults({ appUrl: 'https://research.local:9443' }).appUrl, 'https://research.local:9443');
});
