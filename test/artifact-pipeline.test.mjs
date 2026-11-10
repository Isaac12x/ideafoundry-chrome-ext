import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { resolveArtifactResources } from '../src/artifact-resources.js';
import { resolveArtifactSources } from '../src/artifact-sources.js';
import { conversationHtml } from '../src/html-export.js';
const dom = new JSDOM('');
globalThis.DOMParser = dom.window.DOMParser;

test('selected artifact frame source is read only from the requested live frame', async () => {
  let request;
  const conversation = { artifacts: [{ id: 'artifact-1', frameUrl: 'https://preview.test/app', unavailableReason: 'cross origin' }] };
  const result = await resolveArtifactSources(conversation, 42, { executeScript: async value => {
    request = value;
    return [{ frameId: 0, result: null }, { frameId: 7, result: { url: 'https://preview.test/app', html: '<button>Hi</button><script>boot()</script>' } }];
  } });
  assert.deepEqual(request.target, { tabId: 42, allFrames: true });
  assert.deepEqual(request.args, [['https://preview.test/app']]);
  assert.equal(result.artifacts[0].unavailableReason, undefined);
  assert.equal(result.artifacts[0].source.baseUrl, 'https://preview.test/app');
  assert.match(result.artifacts[0].source.html, /boot/);
});

test('ambiguous frame matches fail instead of silently choosing a different artifact', async () => {
  const result = await resolveArtifactSources({ artifacts: [{ id: 'artifact-1', frameUrl: 'https://preview.test/app', unavailableReason: 'cross origin' }] }, 42, { executeScript: async () => [1,2].map(frameId => ({ frameId, result: { url: 'https://preview.test/app', html: '<script>boot()</script>' } })) });
  assert.match(result.artifacts[0].unavailableReason, /uniquely/);
});

test('artifact resources are resolved relative to their stylesheet without account credentials', async () => {
  const requests = [];
  const resources = {
    'https://preview.test/app.js': ['text/javascript', 'document.body.dataset.ready="yes"'],
    'https://preview.test/css/main.css': ['text/css', '@import "./colors.css";body{background:url(../image.png)}'],
    'https://preview.test/css/colors.css': ['text/css', 'p{color:red}'],
    'https://preview.test/image.png': ['image/png', new Uint8Array([1,2,3])],
  };
  const resolved = await resolveArtifactResources({ id: 'artifact-1', kind: 'html', source: { baseUrl: 'https://preview.test/page', html: '<link rel="stylesheet" href="/css/main.css"><script src="/app.js"></script>' } }, async (url, init) => {
    requests.push(url);
    assert.equal(init.credentials, 'omit');
    assert.equal(init.redirect, 'error');
    const [mime, body] = resources[url];
    return new Response(body, { headers: { 'content-type': mime } });
  });
  assert.deepEqual(new Set(requests), new Set(Object.keys(resources)));
  assert.equal(resolved.source.assets['https://preview.test/image.png'].data, 'AQID');
  assert.match(resolved.source.assets['https://preview.test/css/main.css'].text, /@import/);
});

test('artifact resources fail visibly for credentials, inaccessible assets and blob URLs', async () => {
  for (const url of ['https://user:secret@assets.test/a.png', 'blob:https://preview.test/123']) {
    await assert.rejects(resolveArtifactResources({ source: { html: `<img src="${url}">` } }, () => { throw Error('should not fetch'); }), /cannot be packaged/);
  }
  await assert.rejects(resolveArtifactResources({ source: { html: '<img src="https://assets.test/a.png">' } }, async () => new Response('', { status: 404 })), /404/);
});

test('only prepared artifact text tokens become opaque executable frames', () => {
  const output = conversationHtml({ title: 'Capture', layoutHtml: '<article>{{idea-artifact:artifact-1}}<script>unsafe()</script></article>', artifacts: [{ id: 'artifact-1', title: 'Counter', width: 400, height: 300, preparedHtml: '<!doctype html><script>document.body.textContent="Hello"</script>' }] });
  const parsed = new DOMParser().parseFromString(output, 'text/html');
  const frame = parsed.querySelector('iframe');
  assert.equal(frame.getAttribute('sandbox'), 'allow-scripts');
  assert.equal(frame.style.width, '400px');
  assert.match(frame.srcdoc, /Hello/);
  assert.equal(parsed.querySelectorAll('script').length, 0);
  assert.equal(parsed.querySelector('meta[name="idea-capture-artifacts"]').content, '1');
  assert.throws(() => conversationHtml({ layoutHtml: '{{idea-artifact:artifact-1}}{{idea-artifact:artifact-1}}', artifacts: [{ id: 'artifact-1', preparedHtml: '<p>App</p>' }] }), /more than one/);
  assert.throws(() => conversationHtml({ layoutHtml: '<p>Missing token</p>', artifacts: [{ id: 'artifact-1', preparedHtml: '<p>App</p>' }] }), /missing from/);
  assert.throws(() => conversationHtml({ layoutHtml: '{{idea-artifact:artifact-1}}', artifacts: [{ id: 'artifact-1' }] }), /not packaged/);
});

test('unquoted and cyclic stylesheet imports finish without duplicate fetches', { timeout: 1000 }, async () => {
  const requests = [];
  const resolved = await resolveArtifactResources({ source: { baseUrl: 'https://preview.test/', html: '<style>@import url(a.css);</style>' } }, async url => {
    requests.push(url);
    return new Response(url.endsWith('a.css') ? '@import url(b.css);p{color:red}' : '@import "a.css";p{padding:2px}', { headers: { 'content-type': 'text/css' } });
  });
  assert.deepEqual(requests, ['https://preview.test/a.css', 'https://preview.test/b.css']);
  assert.equal(Object.keys(resolved.source.assets).length, 2);
});
