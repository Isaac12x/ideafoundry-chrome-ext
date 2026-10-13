import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, cp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createQueue } from '../server/queue.mjs';
const temp = await mkdtemp(join(tmpdir(), 'idea-extension-e2e-'));
const token = 'browser-test-token-at-least-32-characters';
const uploads = [];
let locked = false;
const app = createServer(async (req, res) => {
  if (req.url === '/chat') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<title>Remote fixture</title><main><div data-message-author-role="user">Remote question</div><div data-message-author-role="assistant">Remote answer</div></main>'); }
  if (locked) { res.writeHead(423, { 'Content-Type': 'application/json' }); return res.end('{"error":"Workspace locked"}'); }
  if (req.method === 'GET' && req.headers.accept === 'application/json') { res.writeHead(406); return res.end('No JSON template'); }
  if (req.method === 'POST') {
    if (req.headers['x-csrf-token'] !== 'fixture-csrf') { res.writeHead(403); return res.end(); }
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    uploads.push(Buffer.concat(chunks));
    res.writeHead(302, { Location: '/knowledge-base' }); return res.end();
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<!doctype html><meta name="csrf-token" content="fixture-csrf"><h1>Knowledge base fixture</h1>');
});
const queue = createQueue({ token, storePath: join(temp, 'queue.json') });
let context;
try {
  await new Promise(r => app.listen(0, '127.0.0.1', r));
  await new Promise(r => queue.listen(0, '127.0.0.1', r));
  const appUrl = `http://127.0.0.1:${app.address().port}`;
  const queueUrl = `http://127.0.0.1:${queue.address().port}`;
  const extension = join(temp, 'extension'); await cp('dist', extension, { recursive: true });
  const manifest = JSON.parse(await readFile(join(extension, 'manifest.json')));
  // Fixture-only access avoids OS permission dialogs in CI. Production keeps optional permissions.
  manifest.host_permissions = ['http://127.0.0.1/*', 'https://chatgpt.com/*', 'https://claude.ai/*'];
  await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(join(temp, 'profile'), { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  let worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  console.log('Extension worker loaded.');
  const errors = [];
  context.on('page', p => p.on('pageerror', e => errors.push(e.message)));
  const target = await context.newPage(); await target.goto(`${appUrl}/chat`);
  const tabId = await worker.evaluate(async appUrl => (await chrome.tabs.query({ url: `${appUrl}/chat` }))[0].id, appUrl);
  const ui = await context.newPage(); await ui.goto(`chrome-extension://${id}/options.html`, { waitUntil: 'commit' }); console.log('Options committed.');
  await ui.evaluate(async ({ appUrl, queueUrl, token }) => {
    await chrome.storage.local.set({ settings: { appUrl, source: 0, directory: '', queueUrl, queueToken: token, remoteEnabled: true, allowedOrigins: ['https://chatgpt.com', appUrl] } });
    await chrome.runtime.sendMessage({ type: 'settings' });
  }, { appUrl, queueUrl, token });
  const send = message => ui.evaluate(message => chrome.runtime.sendMessage(message), message);
  const captured = await send({ type: 'capture', tabId });
  console.log('Capture response:', captured.ok, captured.error || '');
  assert.equal(captured.ok, true, captured.error); assert.equal(captured.conversation.messages.length, 2);
  for (const format of ['md', 'pdf']) {
    const response = await send({ type: 'export', destination: 'kb', format, conversation: captured.conversation });
    console.log(`${format} upload:`, response.ok, response.error || '');
    assert.equal(response.ok, true, response.error);
    assert.match(uploads.at(-1).toString(), format === 'md' ? /## Assistant/ : /%PDF-/);
  }
  locked = true;
  const rejected = await send({ type: 'export', destination: 'kb', format: 'md', conversation: captured.conversation });
  assert.equal(rejected.ok, false); assert.match(rejected.error, /unlock/i); assert.equal(uploads.length, 2);
  locked = false;
  const queueRequest = (path, body) => fetch(queueUrl + path, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const job = await (await queueRequest('/jobs', { url: `${appUrl}/chat`, format: 'md' })).json();
  await send({ type: 'poll' });
  let result;
  for (let i = 0; i < 60; i++) {
    result = await (await queueRequest(`/jobs/${job.id}`)).json();
    if (['completed', 'failed'].includes(result.state)) break;
    await new Promise(r => setTimeout(r, 500));
  }
  console.log('Remote queue:', result.state);
  assert.equal(result.state, 'completed', result.error || JSON.stringify(result)); assert.equal(uploads.length, 3);
  const blocked = await (await queueRequest('/jobs', { url: 'https://example.com/private', format: 'md' })).json();
  await send({ type: 'poll' });
  for (let i = 0; i < 30; i++) {
    result = await (await queueRequest(`/jobs/${blocked.id}`)).json();
    if (result.state === 'failed') break;
    await new Promise(r => setTimeout(r, 200));
  }
  assert.equal(result.state, 'failed'); assert.match(result.error, /not allowed/); assert.equal(uploads.length, 3);
  // Blob downloads exercise the offscreen renderer directly without a native Save dialog.
  const file = await ui.evaluate(async conversation => chrome.runtime.sendMessage({ target: 'offscreen', conversation, format: 'pdf', download: true }), captured.conversation);
  assert.equal(file.ok, true, file.error);
  const pdf = await ui.evaluate(async url => Array.from(new Uint8Array(await (await fetch(url)).arrayBuffer())), file.url);
  assert.equal(Buffer.from(pdf).subarray(0, 5).toString(), '%PDF-');
  await mkdir('artifacts', { recursive: true }); await writeFile('artifacts/conversation.pdf', Buffer.from(pdf));
  // Activate the fixture tab so the popup reads it even when opened as a test page.
  const popup = await context.newPage(); await popup.goto(`chrome-extension://${id}/popup.html`);
  await worker.evaluate(async tabId => chrome.tabs.update(tabId, { active: true }), tabId);
  await popup.reload();
  await popup.locator('#capture').waitFor({ state: 'visible' });
  await popup.setViewportSize({ width: 430, height: 700 });
  await popup.screenshot({ path: 'artifacts/popup.png', fullPage: true });
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log('Browser checks passed: extraction, MD/PDF KB upload, locked app, remote queue, allowlist rejection, PDF blob and popup.');
} finally {
  await context?.close();
  await Promise.all([new Promise(r => app.close(r)), new Promise(r => queue.close(r))]);
  await rm(temp, { recursive: true, force: true });
}
