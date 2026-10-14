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
const longResearch = Array.from({ length: 18 }, (_, i) => `<p>Research note ${i + 1}: interview evidence needs careful coding, participant context, and a clear link to the decision being made.</p>`).join('');
const longConsent = Array.from({ length: 14 }, (_, i) => `<p>Consent detail ${i + 1}: explain the purpose, storage period, access rules, and withdrawal process in plain language.</p>`).join('');
const fixtureCss = 'body{margin:0;background:#f5f5f2;color:#242824;font:16px/1.6 Georgia,serif}main.chat{max-width:700px;margin:0 auto;padding:32px 24px;min-height:100vh}[data-message-author-role]{display:block;margin:18px 0;padding:16px 20px;border-radius:12px;background:white;box-shadow:0 1px 3px #0001}[data-message-author-role="user"]{margin-left:90px;background:#e9eee9;font-family:system-ui,sans-serif}.long-answer p{margin:0 0 18px}';
let locked = false;
const app = createServer(async (req, res) => {
  if (new URL(req.url, 'http://fixture').pathname === '/fixture.css') {
    res.writeHead(200, { 'Content-Type': 'text/css' }); return res.end(fixtureCss);
  }
  if (new URL(req.url, 'http://fixture').pathname === '/chat') {
    res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Security-Policy': "default-src 'none'; style-src 'self'" });
    return res.end(`<!doctype html><title>Remote fixture</title><link rel="stylesheet" href="/fixture.css"><main class="chat">
      <div data-message-author-role="user"><p>Compare the first research approaches.</p></div>
      <div data-message-author-role="assistant"><div class="long-answer">${longResearch}<div data-message-author-role="assistant"><p>Approach Alpha uses interviews.</p></div></div></div>
      <div data-message-author-role="assistant"><div class="long-answer"><p>It also needs a consent plan.</p>${longConsent}</div></div>
      <div data-message-author-role="user"><p>Now estimate the project timeline.</p></div>
      <div data-message-author-role="assistant"><p>The pilot takes three weeks.</p></div>
      <div data-message-author-role="user"><p>Summarize the main risks.</p></div>
      <div data-message-author-role="assistant"><p>Recruitment and review time are the main risks.</p></div>
    </main>`);
  }
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
  manifest.content_scripts[0].matches.push('http://127.0.0.1/*');
  await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(join(temp, 'profile'), { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  let worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  console.log('Extension worker loaded.');
  const errors = [];
  const cspErrors = [];
  context.on('page', p => p.on('pageerror', e => errors.push(e.message)));
  const target = await context.newPage();
  target.on('console', message => {
    if (message.type() === 'error' && /Content Security Policy|Refused to apply inline style|style-src/i.test(message.text())) cspErrors.push(message.text());
  });
  await target.goto(`${appUrl}/chat`);
  const tabId = await worker.evaluate(async appUrl => (await chrome.tabs.query({ url: `${appUrl}/chat` }))[0].id, appUrl);
  await target.locator('#idea-capture-panel').waitFor();
  assert.equal(await target.locator('.idea-capture-section-header').count(), 3, 'manifest content script adds controls before an explicit capture request');
  const headers = target.locator('.idea-capture-section-header');
  const panel = target.locator('#idea-capture-panel');
  const rail = target.locator('#idea-capture-margin-controls');
  const panelToggle = panel.locator('[data-action="toggle-panel"]');
  assert.equal(await panelToggle.getAttribute('aria-expanded'), 'false', 'the section widget starts closed');
  assert.equal(await panel.locator('.panel-body').isHidden(), true);
  const ui = await context.newPage(); await ui.goto(`chrome-extension://${id}/options.html`, { waitUntil: 'commit' }); console.log('Options committed.');
  await ui.evaluate(async ({ appUrl, queueUrl, token }) => {
    await chrome.storage.local.set({ settings: { appUrl, source: 0, directory: '', queueUrl, queueToken: token, remoteEnabled: true, allowedOrigins: ['https://chatgpt.com', appUrl] } });
    await chrome.runtime.sendMessage({ type: 'settings' });
  }, { appUrl, queueUrl, token });
  const send = message => ui.evaluate(message => chrome.runtime.sendMessage(message), message);
  const captured = await send({ type: 'capture', tabId });
  console.log('Capture response:', captured.ok, captured.error || '');
  assert.equal(captured.ok, true, captured.error); assert.equal(captured.conversation.messages.length, 7);
  assert.equal(captured.conversation.sections.length, 3);
  assert.equal(captured.conversation.messages[1].sectionId, captured.conversation.messages[2].sectionId, 'consecutive assistant replies belong to the preceding user turn');
  assert.match(captured.conversation.messages[0].markdown, /first research approaches/);
  assert.match(captured.conversation.messages[2].markdown, /consent plan/);
  assert.match(captured.conversation.messages[3].markdown, /project timeline/);
  assert.match(captured.conversation.messages[6].markdown, /main risks/);
  assert.equal(await panelToggle.getAttribute('aria-expanded'), 'false', 'capture updates do not open the widget');

  await panelToggle.click();
  assert.equal(await panelToggle.getAttribute('aria-expanded'), 'true');
  assert.equal(await panel.locator('.panel-body').isVisible(), true);
  assert.equal(await headers.count(), 3);
  assert.equal(await panel.locator('input[data-section-id]').count(), 3);
  assert.equal(await headers.evaluateAll(nodes => nodes.every(node => node.nextElementSibling?.matches('[data-message-author-role="user"]'))), true, 'inline controls precede each user-turn group');
  // Re-injecting the content bundle must keep a single panel and one header per section.
  await send({ type: 'capture', tabId });
  await send({ type: 'capture', tabId });
  assert.equal(await target.locator('#idea-capture-controls').count(), 1);
  assert.equal(await headers.count(), 3);

  await mkdir('artifacts', { recursive: true });
  await target.setViewportSize({ width: 1280, height: 900 });
  await target.screenshot({ path: 'artifacts/sections-expanded.png', fullPage: true });
  await panel.locator('[data-action="collapse-all"]').click();
  await target.locator('.idea-capture-section-collapsed').first().waitFor({ state: 'attached' });
  assert.equal(await target.locator('.idea-capture-section-collapsed').count(), 7);
  await target.screenshot({ path: 'artifacts/sections-collapsed.png', fullPage: true });
  await panel.locator('[data-action="expand-all"]').click();
  assert.equal(await target.locator('.idea-capture-section-collapsed').count(), 0);

  // The side rail tracks the turn under the viewport center and collapses the complete group in place.
  await panelToggle.click();
  assert.equal(await panel.locator('.panel-body').isHidden(), true);
  await target.setViewportSize({ width: 1280, height: 900 });
  const firstSectionBounds = await target.evaluate(() => {
    const header = document.querySelector('.idea-capture-section-header');
    const nodes = [];
    for (let node = header?.nextElementSibling; node && !node.matches('.idea-capture-section-header'); node = node.nextElementSibling) nodes.push(node);
    return { top: nodes[0].getBoundingClientRect().top + scrollY, bottom: nodes.at(-1).getBoundingClientRect().bottom + scrollY };
  });
  await target.evaluate(({ top, bottom }) => window.scrollTo(0, Math.max(0, (top + bottom) / 2 - innerHeight / 2)), firstSectionBounds);
  await target.waitForFunction(() => document.querySelector('#idea-capture-controls')?.shadowRoot?.querySelector('.idea-capture-margin-label')?.textContent.includes('first research approaches'));
  await rail.waitFor({ state: 'visible' });
  assert.match(await rail.locator('.idea-capture-margin-label').textContent(), /first research approaches/i);
  const railStyle = await rail.evaluate(node => ({
    display: getComputedStyle(node).display,
    position: getComputedStyle(node).position,
    rail: node.getBoundingClientRect().toJSON(),
    content: document.querySelector('main.chat').getBoundingClientRect().toJSON(),
  }));
  assert.equal(railStyle.display, 'grid', 'rail styles must survive the fixture content security policy');
  assert.equal(railStyle.position, 'fixed');
  assert.ok(railStyle.rail.right <= railStyle.content.left || railStyle.rail.left >= railStyle.content.right, `rail sits in a blank side margin: ${JSON.stringify(railStyle)}`);
  await target.screenshot({ path: 'artifacts/sections-middle-expanded.png' });
  const heightBeforeCollapse = await target.evaluate(() => document.documentElement.scrollHeight);
  const railInput = rail.locator('input[data-idea-section-id]');
  const railButton = rail.locator('button[data-idea-section-id]');
  await railButton.click();
  await target.waitForFunction(() => getComputedStyle(document.querySelector('.idea-capture-section-collapsed')).display === 'none');
  await target.screenshot({ path: 'artifacts/sections-middle-collapsed.png' });
  assert.equal(await railButton.textContent(), 'Expand', 'the rail stays visible with an action to restore the collapsed turn');
  const pinnedSectionId = await railInput.getAttribute('data-idea-section-id');
  await target.setViewportSize({ width: 1160, height: 850 });
  await target.waitForFunction(id => {
    const rail = document.querySelector('#idea-capture-controls')?.shadowRoot?.querySelector('#idea-capture-margin-controls');
    const rect = rail?.getBoundingClientRect();
    return rail && !rail.hidden && rail.querySelector('button[data-idea-section-id]')?.dataset.ideaSectionId === id
      && rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight;
  }, pinnedSectionId);
  await target.setViewportSize({ width: 1280, height: 900 });
  assert.equal(await target.locator('[data-message-author-role]').nth(0).isVisible(), false, 'the prompt hides with its replies');
  assert.equal(await target.locator('[data-message-author-role]').nth(1).isVisible(), false, 'the full nested assistant response hides');
  assert.equal(await target.locator('[data-message-author-role]').nth(3).isVisible(), false, 'the next assistant reply in the same turn hides');
  assert.equal(await target.locator('[data-message-author-role]').nth(4).isVisible(), true, 'the next turn remains visible');
  const heightAfterCollapse = await target.evaluate(() => document.documentElement.scrollHeight);
  assert.ok(heightBeforeCollapse - heightAfterCollapse > 1000, `collapsed content should remove its tall blank area (${heightBeforeCollapse} -> ${heightAfterCollapse})`);
  const collapsedExport = await send({ type: 'capture', tabId, mode: 'export' });
  assert.equal(collapsedExport.ok, true, collapsedExport.error);
  assert.equal(collapsedExport.conversation.messages.length, 7, 'a selected collapsed turn still exports');
  await railInput.uncheck();
  assert.equal(await target.locator('.idea-capture-section-collapsed').count(), 3, 'changing selection leaves collapse state alone');
  const excludedTurn = await send({ type: 'capture', tabId, mode: 'export' });
  assert.equal(excludedTurn.ok, true, excludedTurn.error);
  assert.equal(excludedTurn.conversation.messages.length, 4);
  assert.equal(excludedTurn.conversation.messages.some(message => message.markdown.includes('first research approaches')), false);
  await railInput.check();
  assert.equal(await target.locator('.idea-capture-section-collapsed').count(), 3, 'reselecting a collapsed turn does not expand it');
  await railButton.click();
  await target.waitForFunction(() => !document.querySelector('.idea-capture-section-collapsed'));
  assert.ok(await target.evaluate(() => document.documentElement.scrollHeight) > heightAfterCollapse + 1000, 'the rail restores the hidden turn content');
  await target.evaluate(() => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
  await headers.nth(1).evaluate(node => node.scrollIntoView({ block: 'center' }));
  await target.waitForFunction(() => document.querySelector('#idea-capture-controls')?.shadowRoot?.querySelector('.idea-capture-margin-label')?.textContent.includes('project timeline'));
  await panelToggle.click();
  assert.equal(await panel.locator('.panel-body').isVisible(), true);

  // Unchecking a section filters exports; collapsing selected sections only changes page visibility.
  const sectionChecks = panel.locator('input[data-section-id]');
  await sectionChecks.nth(1).uncheck();
  await panel.locator('[data-action="collapse-all"]').click();
  const selected = await send({ type: 'capture', tabId, mode: 'export' });
  assert.equal(selected.ok, true, selected.error);
  assert.equal(selected.conversation.messages.length, 5);
  assert.equal(selected.conversation.sections.filter(section => section.selected).length, 2);
  assert.equal(selected.conversation.messages.some(message => message.markdown.includes('project timeline') || message.markdown.includes('three weeks')), false);
  assert.equal(selected.conversation.messages.some(message => message.markdown.includes('first research approaches')), true, 'collapsed selected sections remain exportable');
  const selectedMarkdown = await send({ type: 'export', destination: 'kb', format: 'md', conversation: selected.conversation });
  assert.equal(selectedMarkdown.ok, true, selectedMarkdown.error);
  const selectedMarkdownUpload = uploads.at(-1).toString();
  assert.match(selectedMarkdownUpload, /first research approaches/);
  assert.match(selectedMarkdownUpload, /main risks/);
  assert.doesNotMatch(selectedMarkdownUpload, /project timeline|three weeks/);

  // Observe the actual conversation handed to the offscreen PDF renderer without changing production code.
  await ui.evaluate(() => {
    window.__offscreenInputs = [];
    chrome.runtime.onMessage.addListener(message => {
      if (message?.target === 'offscreen') window.__offscreenInputs.push({ format: message.format, conversation: message.conversation });
    });
  });
  const selectedPdf = await send({ type: 'export', destination: 'kb', format: 'pdf', conversation: selected.conversation });
  assert.equal(selectedPdf.ok, true, selectedPdf.error);
  const pdfInput = await ui.evaluate(() => window.__offscreenInputs.at(-1));
  assert.equal(pdfInput?.format, 'pdf');
  assert.equal(pdfInput.conversation.messages.length, 5);
  assert.equal(pdfInput.conversation.messages.some(message => message.markdown.includes('project timeline')), false);
  assert.match(uploads.at(-1).toString(), /%PDF-/);

  await panel.locator('[data-action="select-none"]').click();
  const noneSelected = await send({ type: 'capture', tabId, mode: 'export' });
  assert.equal(noneSelected.ok, false);
  assert.match(noneSelected.error, /select at least one section/i);
  await panel.locator('[data-action="select-all"]').click();

  // Dynamic turns get controls; changing the SPA route clears old selection/collapse state and headers.
  await target.evaluate(() => {
    const user = document.createElement('div'); user.dataset.messageAuthorRole = 'user'; user.textContent = 'Add a final implementation detail.';
    const assistant = document.createElement('div'); assistant.dataset.messageAuthorRole = 'assistant'; assistant.textContent = 'Document the fallback behavior.';
    document.querySelector('main').append(user, assistant);
  });
  await target.locator('.idea-capture-section-header').nth(3).waitFor();
  assert.equal(await target.locator('.idea-capture-section-header').count(), 4);
  await panel.locator('input[data-section-id]').nth(3).waitFor();
  await panel.locator('input[data-section-id]').nth(3).uncheck();
  await target.evaluate(() => {
    history.pushState({}, '', '/chat?thread=next');
    document.querySelector('main').innerHTML = '<div data-message-author-role="user">A fresh conversation begins.</div><div data-message-author-role="assistant">Its sections should reset.</div>';
  });
  await target.getByText('A fresh conversation begins.').waitFor();
  await target.waitForFunction(() => document.querySelectorAll('.idea-capture-section-header').length === 1 && document.querySelector('.idea-capture-section-header input')?.checked === true);
  assert.equal(await target.locator('.idea-capture-section-header').count(), 1);
  await panel.locator('input[data-section-id]').uncheck();
  const spaNone = await send({ type: 'capture', tabId, mode: 'export' });
  assert.equal(spaNone.ok, false);
  assert.match(spaNone.error, /select at least one section/i);
  await target.evaluate(() => document.querySelector('main').replaceChildren());
  await target.waitForTimeout(500);
  const emptyState = await target.evaluate(() => {
    const shadow = document.querySelector('#idea-capture-controls')?.shadowRoot;
    return { hidden: shadow?.querySelector('#idea-capture-panel')?.hidden, headers: document.querySelectorAll('.idea-capture-section-header').length, railHidden: shadow?.querySelector('#idea-capture-margin-controls')?.hidden };
  });
  assert.deepEqual(emptyState, { hidden: true, headers: 0, railHidden: true }, `panel and inline controls hide without sections: ${JSON.stringify(emptyState)}`);
  await target.evaluate(() => {
    document.querySelector('main').innerHTML = '<div data-message-author-role="user">A fresh conversation begins.</div><div data-message-author-role="assistant">Its sections should reset.</div>';
  });
  await target.waitForFunction(() => document.querySelectorAll('.idea-capture-section-header').length === 1 && !document.querySelector('#idea-capture-controls')?.shadowRoot?.querySelector('#idea-capture-panel')?.hidden);

  for (const format of ['md', 'pdf']) {
    const response = await send({ type: 'export', destination: 'kb', format, conversation: captured.conversation });
    console.log(`${format} upload:`, response.ok, response.error || '');
    assert.equal(response.ok, true, response.error);
    assert.match(uploads.at(-1).toString(), format === 'md' ? /## Assistant/ : /%PDF-/);
  }
  locked = true;
  const rejected = await send({ type: 'export', destination: 'kb', format: 'md', conversation: captured.conversation });
  assert.equal(rejected.ok, false); assert.match(rejected.error, /unlock/i); assert.equal(uploads.length, 4);
  locked = false;
  const queueRequest = (path, body) => fetch(queueUrl + path, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const job = await (await queueRequest('/jobs', { url: `${appUrl}/chat?thread=next`, format: 'md' })).json();
  await send({ type: 'poll' });
  let result;
  for (let i = 0; i < 60; i++) {
    result = await (await queueRequest(`/jobs/${job.id}`)).json();
    if (['completed', 'failed'].includes(result.state)) break;
    await new Promise(r => setTimeout(r, 500));
  }
  console.log('Remote queue:', result.state);
  assert.equal(result.state, 'completed', result.error || JSON.stringify(result)); assert.equal(uploads.length, 5);
  const remoteUpload = uploads.at(-1).toString();
  assert.match(remoteUpload, /first research approaches/);
  assert.match(remoteUpload, /consent plan/);
  assert.match(remoteUpload, /project timeline/);
  assert.match(remoteUpload, /three weeks/);
  assert.match(remoteUpload, /main risks/);
  assert.match(remoteUpload, /Recruitment and review time/);
  const blocked = await (await queueRequest('/jobs', { url: 'https://example.com/private', format: 'md' })).json();
  await send({ type: 'poll' });
  for (let i = 0; i < 30; i++) {
    result = await (await queueRequest(`/jobs/${blocked.id}`)).json();
    if (result.state === 'failed') break;
    await new Promise(r => setTimeout(r, 200));
  }
  assert.equal(result.state, 'failed'); assert.match(result.error, /not allowed/); assert.equal(uploads.length, 5);
  // Blob downloads exercise the offscreen renderer directly without a native Save dialog.
  const file = await ui.evaluate(async conversation => chrome.runtime.sendMessage({ target: 'offscreen', conversation, format: 'pdf', download: true }), captured.conversation);
  assert.equal(file.ok, true, file.error);
  const pdf = await ui.evaluate(async url => Array.from(new Uint8Array(await (await fetch(url)).arrayBuffer())), file.url);
  assert.equal(Buffer.from(pdf).subarray(0, 5).toString(), '%PDF-');
  await writeFile('artifacts/conversation.pdf', Buffer.from(pdf));
  // Verify the popup recaptures page selection immediately before export.
  await target.evaluate(() => {
    document.querySelector('main').innerHTML = '<div data-message-author-role="user">Popup should keep this turn.</div><div data-message-author-role="assistant">This selected answer stays.</div><div data-message-author-role="user">Popup preview will later exclude this turn.</div><div data-message-author-role="assistant">This answer should not be uploaded.</div>';
  });
  await target.waitForFunction(() => document.querySelectorAll('.idea-capture-section-header').length === 2 && [...document.querySelectorAll('.idea-capture-section-header input')].every(input => input.checked));
  const popup = await context.newPage(); await popup.goto(`chrome-extension://${id}/popup.html`);
  await worker.evaluate(async tabId => chrome.tabs.update(tabId, { active: true }), tabId);
  await popup.reload();
  await popup.locator('#capture').waitFor({ state: 'visible' });
  assert.match(await popup.locator('#count').textContent(), /2 of 2 sections/);
  assert.match(await popup.locator('#preview').textContent(), /Popup preview will later exclude this turn/);
  await target.locator('.idea-capture-section-header input').nth(1).uncheck();
  await popup.locator('#send').click();
  await popup.getByText(/Saved to KB:/).waitFor();
  const popupUpload = uploads.at(-1).toString();
  assert.match(popupUpload, /Popup should keep this turn/);
  assert.match(popupUpload, /This selected answer stays/);
  assert.doesNotMatch(popupUpload, /Popup preview will later exclude this turn|This answer should not be uploaded/);
  await popup.setViewportSize({ width: 430, height: 700 });
  await popup.screenshot({ path: 'artifacts/popup.png', fullPage: true });
  assert.equal(errors.length, 0, errors.join('\n'));
  assert.equal(cspErrors.length, 0, cspErrors.join('\n'));
  console.log('Browser checks passed: turn sections, inline controls, selected MD/PDF export, dynamic/SPA updates, remote full capture, KB upload, and popup.');
} finally {
  await context?.close();
  await Promise.all([new Promise(r => app.close(r)), new Promise(r => queue.close(r))]);
  await rm(temp, { recursive: true, force: true });
}
