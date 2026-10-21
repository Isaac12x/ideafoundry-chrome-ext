// Real-server e2e: extension <-> IdeaFoundry Rails app. See README "Testing against IdeaFoundry".
// Env: IDEA_APP_URL (http://localhost:PORT), IDEA_API_KEY, IDEA_KB_DIR (the source's folder), IDEA_KB_SOURCE (default 0).
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { IDEA_APP_URL: appUrl, IDEA_API_KEY: apiKey, IDEA_KB_DIR: kbDir, IDEA_KB_SOURCE: source = '0' } = process.env;
if (!appUrl || !apiKey || !kbDir) throw new Error('Set IDEA_APP_URL, IDEA_API_KEY and IDEA_KB_DIR (see README, "Testing against IdeaFoundry").');
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(appUrl)) throw new Error('IDEA_APP_URL must be a local http://localhost:PORT server; refusing to run against anything else.');
const browserOptions = process.env.IDEA_BROWSER_PATH ? { executablePath: process.env.IDEA_BROWSER_PATH } : { channel: process.env.IDEA_BROWSER_CHANNEL || 'chromium' };
const queueUrl = `${appUrl}/api/v1/capture`;
const chat = 'https://chatgpt.com';
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const pdf = Buffer.from('%PDF-1.4\n% e2e fixture\n%%EOF\n', 'latin1');
// Local fixture host for remote jobs: tabs the extension opens itself are not reliably intercepted by Playwright routes.
const fixture = createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  if (path === '/media/brief.pdf') { res.writeHead(200, { 'Content-Type': 'application/pdf' }); return res.end(pdf); }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><meta charset="utf-8"><title>Remote fixture</title><main>
<div data-message-author-role="user"><p>Compare two research approaches.</p></div>
<div data-message-author-role="assistant"><p>Interviews give context; surveys give breadth.</p><p><a href="/media/brief.pdf" download="brief.pdf">Read the linked PDF brief</a></p></div>
<div data-message-author-role="user"><p>What should the pilot include?</p></div>
<div data-message-author-role="assistant"><p>Test the interview guide with three participants.</p></div></main>`);
});
await new Promise(r => fixture.listen(0, '127.0.0.1', r));
const fixtureOrigin = `http://127.0.0.1:${fixture.address().port}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const api = async (path, init = {}) => {
  const r = await fetch(queueUrl + path, { ...init, headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' } });
  return { status: r.status, body: r.status === 204 ? null : await r.json() };
};
const kbFiles = async () => (await allKbFiles()).filter(f => !preexisting.has(f));
const preexisting = new Set();
const allKbFiles = async () => (await readdir(kbDir, { recursive: true, withFileTypes: true })).filter(e => e.isFile()).map(e => join(e.parentPath, e.name).slice(kbDir.length + 1)).sort();
const until = async (fn, what, tries = 90) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(500); } throw new Error(`Timed out: ${what}`); };
const pageHtml = `<!doctype html><meta charset="utf-8"><title>E2E fixture · ChatGPT</title><main>
<article data-testid="conversation-turn-1"><h2>You said:</h2><div class="markdown"><p>Compare two research approaches.</p></div></article>
<article data-testid="conversation-turn-2"><h2>ChatGPT said:</h2><div class="markdown"><p>Interviews give context; surveys give breadth.</p><img alt="Evidence chart" src="data:image/png;base64,${png}"><p><a href="${chat}/media/brief.pdf" download="brief.pdf">Read the linked PDF brief</a></p></div></article>
<article data-testid="conversation-turn-3"><h2>You said:</h2><div class="markdown"><p>What should the pilot include?</p></div></article>
<article data-testid="conversation-turn-4"><h2>ChatGPT said:</h2><div class="markdown"><p>Test the interview guide with three participants.</p></div></article></main>`;

const temp = await mkdtemp(join(tmpdir(), 'idea-app-e2e-'));
let context;
try {
  (await allKbFiles()).forEach(f => preexisting.add(f)); // only files created by this run count
  assert.equal((await api('/health')).status, 200, 'API key accepted by /api/v1/capture/health');
  const extension = join(process.cwd(), 'dist');
  context = await chromium.launchPersistentContext(join(temp, 'profile'), { ...browserOptions, headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  await context.route(`${chat}/**`, route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/media/brief.pdf') return route.fulfill({ status: 200, contentType: 'application/pdf', body: pdf });
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: pageHtml });
  });

  // Configure through the real options form.
  const ui = await context.newPage();
  await ui.goto(`chrome-extension://${id}/options.html`);
  const saveSettings = async remote => {
    await ui.fill('#appUrl', appUrl); await ui.fill('#source', source); await ui.fill('#directory', '');
    await ui.fill('#queueUrl', queueUrl); await ui.fill('#queueToken', apiKey);
    await ui.setChecked('#remoteEnabled', remote); await ui.fill('#allowedOrigins', `${chat}\n${fixtureOrigin}`);
    await ui.click('button[type=submit]');
    await ui.locator('#status', { hasText: 'Connections saved.' }).waitFor();
  };

  // 1. Extension -> KB through the on-page widget, Markdown then styled HTML.
  await saveSettings(false);
  const page = await context.newPage();
  await page.goto(`${chat}/c/e2e`);
  const widget = page.locator('#idea-capture-panel');
  const toggle = widget.locator('[data-action="toggle-panel"]');
  await toggle.waitFor();
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  const sendKb = async format => {
    await widget.locator(`[name="format"][value="${format}"]`).check();
    await widget.locator('[data-action="send-kb"]').click();
    await page.waitForFunction(() => /Saved to knowledge base:|failed|error|unlock|allow/i.test(document.querySelector('#idea-capture-controls')?.shadowRoot?.querySelector('[data-capture-status]')?.textContent || ''), null, { timeout: 30000 });
    const status = await page.evaluate(() => document.querySelector('#idea-capture-controls').shadowRoot.querySelector('[data-capture-status]').textContent);
    assert.match(status, /Saved to knowledge base:/, status);
  };
  await sendKb('md');
  const afterMd = await kbFiles();
  console.log('KB after md:', afterMd);
  const mdName = afterMd.find(f => f.endsWith('.md'));
  const pdfCompanion = afterMd.find(f => f.endsWith('brief.pdf'));
  const pngCompanion = afterMd.find(f => f.endsWith('.png'));
  assert.ok(mdName && pdfCompanion && pngCompanion, `md + PDF and PNG companions stored: ${afterMd}`);
  const md = await readFile(join(kbDir, mdName), 'utf8');
  assert.match(md, /Interviews give context/); assert.match(md, /three participants/);
  for (const stored of [pdfCompanion, pngCompanion]) {
    const link = md.match(/\((http[^)\s]*\/knowledge-base\/serve\?[^)\s]*)\)/g).map(m => m.slice(1, -1)).find(u => new URL(u).searchParams.get('file') === stored);
    assert.ok(link, `md links the stored file name ${stored}`);
    const served = await fetch(link); // the link resolves through the real app
    assert.equal(served.status, 200, `${link} -> ${served.status}`);
    assert.deepEqual(Buffer.from(await served.arrayBuffer()), await readFile(join(kbDir, stored)));
  }
  assert.equal((await readFile(join(kbDir, pdfCompanion))).subarray(0, 5).toString(), '%PDF-');
  assert.equal((await readFile(join(kbDir, pngCompanion))).subarray(1, 4).toString(), 'PNG');
  await sendKb('html');
  const afterHtml = await kbFiles();
  const conversationHtml = afterHtml.find(f => f.endsWith('.html') && !afterMd.includes(f));
  assert.ok(conversationHtml, `a styled conversation HTML was stored: ${afterHtml}`);
  assert.match(await readFile(join(kbDir, conversationHtml), 'utf8'), /Interviews give context/);
  console.log('KB after html:', afterHtml);

  // 2. App -> extension: jobs from the in-app settings form and from the API.
  await saveSettings(true);
  const app = await context.newPage();
  const claims = [];
  context.on('response', async r => { if (r.url() === `${queueUrl}/jobs/claim` && r.status() === 200) claims.push(await r.json().catch(() => null)); });
  const listRow = url => app.locator('.api-key-row', { hasText: url });
  const createViaForm = async (url, format = 'md') => {
    await app.goto(`${appUrl}/settings/api_keys`);
    await app.fill('input[name=url]', url); await app.selectOption('select[name=file_format]', format);
    await app.click('input[value="Queue Capture"]');
    await app.waitForURL(/settings\/api_keys/);
    await listRow(url).first().locator('.api-key-meta', { hasText: /queued/ }).waitFor(); // queued, visible in the UI list
  };
  const createViaApi = async (url, format = 'md') => {
    const { status, body } = await api('/jobs', { method: 'POST', body: JSON.stringify({ url, format }) });
    assert.equal(status, 201); assert.equal(body.state, 'queued');
    return body.id;
  };
  // Click "Check queue now"; the claim response reveals the job id the extension took. Returns states seen up to the end.
  const runPoll = async url => {
    const seen = ['queued'];
    claims.length = 0;
    await ui.bringToFront(); await ui.click('#poll');
    const claim = await until(() => claims.find(c => c?.url === url), `claim of ${url}`, 40);
    assert.equal(claim.state, 'running'); seen.push(claim.state);
    const job = await until(async () => { const j = (await api(`/jobs/${claim.id}`)).body; return ['completed', 'failed'].includes(j.state) ? j : null; }, `job ${claim.id} to finish`, 120);
    seen.push(job.state);
    console.log(`job ${claim.id} states ${seen.join(' -> ')}:`, JSON.stringify(job));
    return job;
  };
  const showsInList = async (url, text) => {
    await app.goto(`${appUrl}/settings/api_keys`);
    const meta = await listRow(url).first().locator('.api-key-meta').innerText();
    assert.match(meta, text, `settings list for ${url}: ${meta}`);
  };

  // 2a. Job created through the real settings form (CSRF + UI).
  const formUrl = `${fixtureOrigin}/c/from-form`;
  const filesBeforeForm = await kbFiles();
  await createViaForm(formUrl);
  const formJob = await runPoll(formUrl);
  assert.equal(formJob.state, 'completed', formJob.error);
  assert.ok(formJob.filename?.endsWith('.md'), 'filename recorded');
  const filesAfterForm = await kbFiles();
  assert.ok(filesAfterForm.includes(formJob.filename) && !filesBeforeForm.includes(formJob.filename), `${formJob.filename} landed in the KB dir`);
  assert.match(await readFile(join(kbDir, formJob.filename), 'utf8'), /three participants/);
  assert.ok(filesAfterForm.some(f => f.endsWith('brief.pdf') && !filesBeforeForm.includes(f)), 'remote job also stored its PDF media companion');
  await showsInList(formUrl, new RegExp(`MD · completed · ${formJob.filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));

  // 2b. Jobs created straight through the JSON API support Markdown and direct PDF delivery.
  for (const format of ['md', 'pdf']) {
    const url = `${fixtureOrigin}/c/from-api-${format}`;
    await createViaApi(url, format);
    const job = await runPoll(url);
    assert.equal(job.state, 'completed', job.error);
    assert.ok(job.filename.endsWith(`.${format}`));
    assert.ok((await kbFiles()).includes(job.filename), `${job.filename} landed in the KB dir`);
    if (format === 'pdf') assert.equal((await readFile(join(kbDir, job.filename))).subarray(0, 5).toString(), '%PDF-');
    await showsInList(url, /completed/);
  }

  // 3. Negative: origin not in the extension's allow list fails with a visible error.
  const badUrl = 'https://example.com/private';
  await createViaForm(badUrl);
  const filesBeforeBad = await kbFiles();
  const bad = await runPoll(badUrl);
  assert.equal(bad.state, 'failed'); assert.match(bad.error, /not allowed/);
  assert.deepEqual(await kbFiles(), filesBeforeBad, 'a rejected job stores nothing');
  await showsInList(badUrl, /failed.*not allowed for remote capture/s);
  console.log('Final KB dir:', await kbFiles());
  console.log('IdeaFoundry app e2e passed: widget md+pdf to KB with companions, form + API jobs completed, disallowed origin failed.');
} finally {
  await context?.close();
  await new Promise(r => fixture.close(r));
  await rm(temp, { recursive: true, force: true });
}
