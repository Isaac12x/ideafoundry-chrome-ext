import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Exercise the built extension through its actual page widget and upload path.
// IDEA_BROWSER_PATH and IDEA_BROWSER_CHANNEL mirror scripts/browser-test.mjs.
const browserOptions = process.env.IDEA_BROWSER_PATH
  ? { executablePath: process.env.IDEA_BROWSER_PATH }
  : { channel: process.env.IDEA_BROWSER_CHANNEL || 'chromium' };
const temp = await mkdtemp(join(tmpdir(), 'idea-artifact-extension-'));
const uploads = [];
let excludedResourceRequests = 0;
let protectedChildRequests = 0;
const csrfToken = 'artifact-extension-test-csrf';
const artifactCsp = "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:; media-src data: blob:; frame-src about:; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'";
let app;
let context;

function multipartFiles(contentType, buffer) {
  const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i)?.slice(1).find(Boolean);
  assert.ok(boundary, 'upload request has a multipart boundary');
  const files = [];
  for (const rawPart of buffer.toString('utf8').split(`--${boundary}`)) {
    const separator = rawPart.indexOf('\r\n\r\n');
    if (separator < 0) continue;
    const headers = rawPart.slice(0, separator);
    const disposition = headers.match(/content-disposition:\s*form-data;[^\r\n]*/i)?.[0] || '';
    const filename = disposition.match(/filename="([^"]+)"/i)?.[1];
    if (!filename) continue;
    const content = rawPart.slice(separator + 4).replace(/\r\n$/, '');
    files.push({
      filename,
      mime: headers.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim() || 'application/octet-stream',
      content,
    });
  }
  return files;
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function sendHtml(response, body, headers = {}) {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...headers });
  response.end(body);
}

async function waitForWidgetStatus(page, expression, label) {
  try {
    await page.waitForFunction(regex => regex.test(document.querySelector('#idea-capture-controls')?.shadowRoot?.querySelector('[data-capture-status]')?.textContent || ''), expression, { timeout: 20000 });
  } catch (error) {
    const status = await page.locator('#idea-capture-controls').evaluate(host => host.shadowRoot?.querySelector('[data-capture-status]')?.textContent || '(empty status)').catch(() => '(widget unavailable)');
    throw new Error(`${label} did not complete: ${status} (${error.message})`);
  }
}

const escapeMarkup = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const chatgptPanel = (id, title, code, css) => `<section data-testid="artifact-panel" data-artifact-id="${id}">
  <h3>${title}</h3>
  <pre><code data-language="jsx">${escapeMarkup(code)}</code></pre>
  <pre><code data-language="css">${escapeMarkup(css)}</code></pre>
</section>`;
const chatgptApp = `import React, { useState } from 'react';
export default function App() {
  const [count, setCount] = useState(0);
  return <main className="chatgpt-artifact"><h2>ChatGPT artifact board</h2><button onClick={() => setCount(count + 1)}>Count {count}</button></main>;
}`;
const chatgptCss = `.chatgpt-artifact { min-height: 240px; padding: 28px; color: rgb(22, 75, 51); background: linear-gradient(135deg, rgb(238, 247, 239), white); font: 18px/1.4 Georgia, serif; }
.chatgpt-artifact button { padding: 10px 16px; color: white; background: rgb(22, 75, 51); border: 0; border-radius: 8px; }`;
const claudeBrokenCode = `import React from 'react';
import MissingChart from 'missing-chart-package';
export default function App() { return <main><h2>Claude artifact</h2><MissingChart /></main>; }
`;
const claudeApp = `import React, { useState } from 'react';
export default function App() {
  const [count, setCount] = useState(0);
  return <main className="claude-artifact"><h2>Claude artifact board</h2><button onClick={() => setCount(count + 1)}>Claude count {count}</button></main>;
}`;
const claudeCss = `.claude-artifact{padding:24px;color:rgb(70,53,35);background:linear-gradient(120deg,#f5efe5,#fff);font:18px Georgia,serif}.claude-artifact button{color:white;background:rgb(102,73,45);border:0;border-radius:6px;padding:8px 12px}`;

const appServer = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://fixture');
  if (request.method === 'GET' && url.pathname === '/knowledge-base') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': 'artifact-test-session=present; Path=/; HttpOnly; SameSite=Lax' });
    return response.end(`<!doctype html><meta name="csrf-token" content="${csrfToken}"><h1>Knowledge base fixture</h1>`);
  }
  if (request.method === 'POST' && url.pathname === '/knowledge-base/fs/upload') {
    if (request.headers['x-csrf-token'] !== csrfToken || !/artifact-test-session=present/.test(request.headers.cookie || '')) {
      response.writeHead(403); return response.end();
    }
    const bytes = await readBody(request);
    uploads.push({ files: multipartFiles(request.headers['content-type'] || '', bytes), bytes });
    response.writeHead(302, { Location: '/knowledge-base' });
    return response.end();
  }
  if (request.method === 'GET' && url.pathname === '/excluded.css') {
    excludedResourceRequests++;
    response.writeHead(200, { 'Content-Type': 'text/css' });
    return response.end('.excluded { color: red; }');
  }
  if (request.method === 'GET' && url.pathname === '/knowledge-base/private-child') {
    protectedChildRequests++;
    return sendHtml(response, '<!doctype html><p>Private app child</p>');
  }
  if (request.method === 'GET' && url.pathname === '/knowledge-base/view') {
    if (!uploads.length) { response.writeHead(404); return response.end(); }
    const uploaded = uploads.at(-1).files.find(file => file.mime.startsWith('text/html'));
    if (!uploaded) { response.writeHead(404); return response.end(); }
    const name = encodeURIComponent(uploaded.filename);
    return sendHtml(response, `<!doctype html><meta charset="utf-8"><div id="app-secret">App-only content</div><iframe id="artifact-viewer" sandbox="allow-scripts" src="/uploads/${name}" title="Uploaded artifact"></iframe>`);
  }
  if (request.method === 'GET' && url.pathname.startsWith('/uploads/')) {
    const name = decodeURIComponent(url.pathname.slice('/uploads/'.length));
    const uploaded = uploads.flatMap(item => item.files).find(file => file.filename === name && file.mime.startsWith('text/html'));
    if (!uploaded) { response.writeHead(404); return response.end(); }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': artifactCsp, 'X-Content-Type-Options': 'nosniff' });
    return response.end(uploaded.content);
  }
  response.writeHead(404); response.end();
});

function sectionTurn(index, userText, assistantHtml) {
  return `<article data-testid="conversation-turn-${index}">
    <div data-message-author-role="user"><p>${userText}</p></div>
    <div data-message-author-role="assistant">${assistantHtml}</div>
  </article>`;
}

const chatgptFixture = `<!doctype html><meta charset="utf-8"><title>ChatGPT artifacts</title>
<style>body{margin:0;padding:24px;font:15px/1.5 system-ui,sans-serif;background:#f5f6f5}article{margin:18px auto;max-width:800px;padding:18px;background:white;border-radius:12px}</style>
<main id="thread">
  ${sectionTurn(1, 'Keep the generated research board.', chatgptPanel('chatgpt-selected', 'Research board source', chatgptApp, chatgptCss))}
  ${sectionTurn(2, 'This artifact is unchecked and must not be resolved.', chatgptPanel('chatgpt-excluded', 'Excluded source panel', chatgptApp.replaceAll('ChatGPT', 'Excluded'), `@import url("http://127.0.0.1:PORT/excluded.css");\n.excluded{color:red}`))}
</main>`;
const claudeFixture = `<!doctype html><meta charset="utf-8"><title>Claude artifacts</title>
<style>body{margin:0;padding:24px;font:15px/1.5 system-ui,sans-serif;background:#f3f2ee}article{margin:18px auto;max-width:800px;padding:18px;background:white;border-radius:12px}</style>
<main id="thread"><article data-testid="user-message"><p>Review this generated canvas.</p></article>
<article class="font-claude-response"><section aria-label="Canvas" data-artifact-id="claude-missing-import"><h2>Missing imported package</h2>
<pre><code class="language-jsx">${escapeMarkup(claudeBrokenCode)}</code></pre></section></article></main>`;
const claudeSuccessFixture = `<!doctype html><meta charset="utf-8"><title>Claude Canvas source</title>
<style>body{margin:0;padding:24px;font:15px/1.5 system-ui,sans-serif;background:#f3f2ee}article{margin:18px auto;max-width:800px;padding:18px;background:white;border-radius:12px}</style>
<main id="thread"><article data-testid="user-message"><p>Keep this generated canvas.</p></article>
<article class="font-claude-response"><section data-testid="artifact-preview" data-artifact-id="claude-source"><h2>Claude canvas source</h2>
<pre><code class="language-jsx">${escapeMarkup(claudeApp)}</code></pre><pre><code class="language-css">${escapeMarkup(claudeCss)}</code></pre></section></article></main>`;

try {
  await new Promise(resolve => appServer.listen(0, '127.0.0.1', resolve));
  const appUrl = `http://127.0.0.1:${appServer.address().port}`;
  const extension = join(temp, 'extension');
  await cp('dist', extension, { recursive: true });
  const manifestPath = join(extension, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.host_permissions = [`${appUrl}/*`, 'https://chatgpt.com/*', 'https://claude.ai/*'];
  manifest.content_scripts[0].matches = ['https://chatgpt.com/*', 'https://claude.ai/*', `${appUrl}/*`];
  await writeFile(manifestPath, JSON.stringify(manifest));

  context = await chromium.launchPersistentContext(join(temp, 'profile'), {
    ...browserOptions,
    headless: true,
    viewport: { width: 1280, height: 900 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  const setup = await context.newPage();
  await setup.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'domcontentloaded' });
  await setup.evaluate(async ({ appUrl }) => {
    await chrome.storage.local.set({ settings: {
      appUrl, source: 0, directory: '', queueUrl: `${appUrl}/api/v1/capture`, queueToken: 'artifact-extension-test-token-at-least-32',
      remoteEnabled: false, allowedOrigins: ['https://chatgpt.com/*', 'https://claude.ai/*'],
    } });
    await chrome.runtime.sendMessage({ type: 'settings' });
  }, { appUrl });

  await context.route('https://chatgpt.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: chatgptFixture.replaceAll('PORT', String(appServer.address().port)) }));
  await context.route('https://claude.ai/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: new URL(route.request().url()).pathname.endsWith('/artifact-missing-import') ? claudeFixture : claudeSuccessFixture }));

  const chatgpt = await context.newPage();
  await chatgpt.goto('https://chatgpt.com/c/artifact-widget');
  const widget = chatgpt.locator('#idea-capture-panel');
  await widget.locator('[data-action="toggle-panel"]').waitFor();
  if (await widget.locator('[data-action="toggle-panel"]').getAttribute('aria-expanded') !== 'true') await widget.locator('[data-action="toggle-panel"]').click();
  await widget.locator('.panel-body').waitFor({ state: 'visible' });
  const sections = widget.locator('input[data-section-id]');
  await sections.nth(1).waitFor();
  assert.equal(await sections.count(), 2, 'ChatGPT fixture exposes both artifact conversation sections');
  assert.equal(await sections.nth(0).isChecked(), true);
  assert.equal(await sections.nth(1).isChecked(), true);
  await sections.nth(1).uncheck();
  await widget.locator('[name="format"][value="html"]').check();
  const beforeChatgptUpload = uploads.length;
  await widget.locator('[data-action="send-kb"]').click();
  await waitForWidgetStatus(chatgpt, /Saved to knowledge base:/i, 'ChatGPT artifact upload');
  assert.equal(uploads.length, beforeChatgptUpload + 1, 'the ChatGPT widget completes one HTML KB upload');
  assert.equal(uploads.at(-1).files.length, 1, 'the widget uploads one standalone HTML file');
  const uploadedHtml = uploads.at(-1).files[0];
  assert.match(uploadedHtml.mime, /^text\/html/i);
  assert.match(uploadedHtml.content, /name="idea-capture-artifacts" content="1"/i, 'the uploaded outer document marks its interactive artifact');
  assert.match(uploadedHtml.content, /data-idea-artifact=/, 'the selected artifact is embedded in the uploaded conversation');
  assert.doesNotMatch(uploadedHtml.content, /Excluded source panel|This artifact is unchecked/, 'the unchecked artifact is omitted from the uploaded file');
  assert.equal(excludedResourceRequests, 0, 'the unchecked artifact did not trigger its deliberately missing CSS import');

  const viewer = await context.newPage();
  await viewer.goto(`${appUrl}/knowledge-base/view`);
  const outer = viewer.frameLocator('#artifact-viewer');
  const reactArtifact = outer.frameLocator('iframe[data-idea-artifact]');
  await reactArtifact.getByRole('heading', { name: 'ChatGPT artifact board' }).waitFor();
  const counter = reactArtifact.getByRole('button', { name: 'Count 0' });
  const initialCss = await counter.evaluate(button => ({ color: getComputedStyle(button).color, background: getComputedStyle(button).backgroundColor, radius: getComputedStyle(button).borderRadius }));
  assert.deepEqual(initialCss, { color: 'rgb(255, 255, 255)', background: 'rgb(22, 75, 51)', radius: '8px' }, 'artifact source CSS is still inline in the standalone upload');
  await counter.click();
  await reactArtifact.getByRole('button', { name: 'Count 1' }).waitFor();

  const outerAccess = await outer.locator('body').evaluate(() => {
    try { return parent.document.querySelector('#app-secret')?.textContent || 'accessible'; }
    catch { return 'blocked'; }
  });
  assert.equal(outerAccess, 'blocked', 'the idea-app viewer sandbox keeps the uploaded HTML away from the app DOM');
  const nestedFrameRequestsBefore = protectedChildRequests;
  await outer.locator('body').evaluate(() => {
    const frame = document.createElement('iframe');
    frame.src = '/knowledge-base/private-child';
    frame.id = 'blocked-private-child';
    document.body.append(frame);
  });
  await viewer.waitForTimeout(300);
  assert.equal(protectedChildRequests, nestedFrameRequestsBefore, 'frame-src about: blocks an artifact from loading a same-origin app route');

  const claude = await context.newPage();
  await claude.goto('https://claude.ai/chat/artifact-source');
  const claudeWidget = claude.locator('#idea-capture-panel');
  await claudeWidget.locator('[data-action="toggle-panel"]').waitFor();
  if (await claudeWidget.locator('[data-action="toggle-panel"]').getAttribute('aria-expanded') !== 'true') await claudeWidget.locator('[data-action="toggle-panel"]').click();
  await claudeWidget.locator('[name="format"][value="html"]').check();
  const beforeClaudeUpload = uploads.length;
  await claudeWidget.locator('[data-action="send-kb"]').click();
  await waitForWidgetStatus(claude, /Saved to knowledge base:/i, 'Claude artifact upload');
  assert.equal(uploads.length, beforeClaudeUpload + 1, 'the Claude widget completes one HTML KB upload');
  assert.match(uploads.at(-1).files[0].content, /Claude artifact board/, 'Claude source-panel JSX is bundled into the upload');
  assert.match(uploads.at(-1).files[0].content, /data-idea-artifact=/, 'Claude source panel is embedded as an interactive artifact');

  const claudeFailurePage = await context.newPage();
  await claudeFailurePage.goto('https://claude.ai/chat/artifact-missing-import');
  const failingWidget = claudeFailurePage.locator('#idea-capture-panel');
  await failingWidget.locator('[data-action="toggle-panel"]').waitFor();
  if (await failingWidget.locator('[data-action="toggle-panel"]').getAttribute('aria-expanded') !== 'true') await failingWidget.locator('[data-action="toggle-panel"]').click();
  await failingWidget.locator('[name="format"][value="html"]').check();
  const beforeClaudeAttempt = uploads.length;
  await failingWidget.locator('[data-action="send-kb"]').click();
  const failure = failingWidget.locator('[data-capture-status].is-error');
  await failure.waitFor({ state: 'visible', timeout: 20000 });
  assert.match(await failure.textContent(), /Unsupported React artifact import: missing-chart-package/, 'Claude source panel import failures are visible to the user');
  assert.equal(uploads.length, beforeClaudeAttempt, 'a missing artifact import never reports a successful upload');

  console.log('Artifact extension integration passed: ChatGPT and Claude widget uploads, selected-only packaging, missing-import error, opaque app viewer, nested React counter, and inline CSS.');
} finally {
  await context?.close();
  await new Promise(resolve => appServer.close(resolve));
  await rm(temp, { recursive: true, force: true });
}
