import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtemp, cp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createQueue } from '../server/queue.mjs';
// Defaults to Playwright's bundled Chromium (new headless). Override: IDEA_BROWSER_CHANNEL=chrome|msedge|..., or IDEA_BROWSER_PATH=/path/to/chromium-based-browser.
const browserOptions = process.env.IDEA_BROWSER_PATH ? { executablePath: process.env.IDEA_BROWSER_PATH } : { channel: process.env.IDEA_BROWSER_CHANNEL || 'chromium' };
const temp = await mkdtemp(join(tmpdir(), 'idea-extension-e2e-'));
const token = 'browser-test-token-at-least-32-characters';
const uploads = [];
const longResearch = Array.from({ length: 18 }, (_, i) => `<p>Research note ${i + 1}: interview evidence needs careful coding, participant context, and a clear link to the decision being made.</p>`).join('');
const longConsent = Array.from({ length: 14 }, (_, i) => `<p>Consent detail ${i + 1}: explain the purpose, storage period, access rules, and withdrawal process in plain language.</p>`).join('');
const pdfFixture = Buffer.from('%PDF-1.4\n% browser media fixture\n%%EOF\n', 'latin1');
const fixtureCss = 'body{margin:0;background:#f5f5f2;color:#242824;font:16px/1.6 Georgia,serif}main.chat{max-width:700px;margin:0 auto;padding:32px 24px;min-height:100vh}[data-message-author-role]{display:block;margin:18px 0;padding:16px 20px;border-radius:12px;background:white;box-shadow:0 1px 3px #0001}[data-message-author-role="user"]{margin-left:90px;background:#e9eee9;font-family:system-ui,sans-serif}.long-answer p{margin:0 0 18px}.research-question{color:#203c2d}.answer-card{max-width:660px;margin:18px auto;padding:22px 26px;border:1px solid #d8e0d8;border-radius:14px;background:linear-gradient(135deg,#fff 0%,#eef5ef 100%);color:#24372c;font:16px/1.65 Georgia,serif}.answer-heading{font:600 26px/1.2 Georgia,serif;color:#244f38}.evidence-image{width:480px;height:240px;object-fit:contain}.evidence-chart{display:block;width:480px;height:180px}.evidence-table{width:100%;border-collapse:collapse}.evidence-table th{text-align:left;border-bottom:2px solid #285b42}.answer-card pre{padding:14px;background:#f2f1eb;white-space:pre-wrap}@media(max-width:720px){.answer-card{max-width:calc(100vw - 100px)}.evidence-image,.evidence-chart{width:100%;max-width:100%}}';
let locked = false;
const app = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://fixture').pathname;
  if (path === '/media/evidence.png') {
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': bytes.length }); return res.end(bytes);
  }
  if (path === '/media/brief.pdf') {
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': pdfFixture.length }); return res.end(pdfFixture);
  }
  if (path === '/fixture.css') {
    res.writeHead(200, { 'Content-Type': 'text/css' }); return res.end(fixtureCss);
  }
  if (path === '/ordered-turns') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(`<!doctype html><title>Ordered turns</title><main style="display:flex;flex-direction:column">${[1,2,3].map(i => `<article data-testid="conversation-turn-${i}" style="order:${i}"><div data-message-author-role="user">Prompt ${i}</div><div data-message-author-role="assistant" style="height:180px">Answer ${i}</div></article>`).join('')}</main>`);
  }
  if (path === '/layout-stress') {
    const turns = Array.from({ length: 12 }, (_, i) => `<div data-message-author-role="user"><p>Fieldwork section ${String(i + 1).padStart(2, '0')}: participant recruitment, consent scheduling, and interview follow-up across the regional community research study</p></div><div data-message-author-role="assistant"><p>Response ${i + 1}: preserve the participant context, evidence notes, and decision links for the next review.</p></div>`).join('');
    res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Security-Policy': "default-src 'none'; style-src 'self'" });
    return res.end(`<!doctype html><title>Layout stress fixture</title><link rel="stylesheet" href="/fixture.css"><main class="chat">${turns}</main>`);
  }
  if (new URL(req.url, 'http://fixture').pathname === '/chat') {
    res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Security-Policy': "default-src 'none'; style-src 'self'; img-src data:" });
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
let mounted;
let autoContext;
try {
  await new Promise(r => app.listen(0, '127.0.0.1', r));
  await new Promise(r => queue.listen(0, '127.0.0.1', r));
  const appUrl = `http://127.0.0.1:${app.address().port}`;
  // Mount the queue under a path like idea-app does, to exercise base URLs with a path.
  const mount = '/api/v1/capture';
  mounted = createServer((req, res) => { if (req.url.startsWith(`${mount}/`)) { req.url = req.url.slice(mount.length); queue.emit('request', req, res); } else { res.writeHead(404); res.end(); } });
  await new Promise(r => mounted.listen(0, '127.0.0.1', r));
  const queueUrl = `http://127.0.0.1:${mounted.address().port}${mount}`;
  const extension = join(temp, 'extension'); await cp('dist', extension, { recursive: true });
  const manifest = JSON.parse(await readFile(join(extension, 'manifest.json')));
  assert.equal(manifest.action?.default_popup, undefined, 'the toolbar action no longer opens a popup');
  // Restrict this test profile to its fixture hosts.
  manifest.host_permissions = ['http://127.0.0.1/*', 'https://chatgpt.com/*', 'https://claude.ai/*'];
  manifest.content_scripts[0].matches.push('http://127.0.0.1/*');
  await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(join(temp, 'profile'), { ...browserOptions, headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  let worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  console.log('Extension worker loaded.');
  const errors = [];
  const cspErrors = [];
  context.on('page', p => p.on('pageerror', e => errors.push(e.message)));
  const ui = await context.newPage(); await ui.goto(`chrome-extension://${id}/options.html`, { waitUntil: 'commit' }); console.log('Options committed.');
  await ui.evaluate(async ({ appUrl, queueUrl, token }) => {
    await chrome.storage.local.set({ settings: { appUrl, source: 0, directory: '', queueUrl, queueToken: token, remoteEnabled: true, allowedOrigins: ['https://chatgpt.com', 'https://chatgpt.com/*', `${appUrl}/*`] } });
    await chrome.runtime.sendMessage({ type: 'settings' });
  }, { appUrl, queueUrl, token });
  await ui.reload();
  const target = await context.newPage();
  target.on('console', message => {
    if (message.type() === 'error' && /Content Security Policy|Refused to apply inline style|style-src/i.test(message.text())) cspErrors.push(message.text());
  });
  await target.goto(`${appUrl}/chat`);
  const tabId = await worker.evaluate(async appUrl => (await chrome.tabs.query({ url: `${appUrl}/chat` }))[0].id, appUrl);
  await target.locator('#idea-capture-panel').waitFor();
  assert.equal(await target.locator('.idea-capture-section-header').count(), 3, 'manifest content script adds controls before an explicit capture request');
  const headers = target.locator('.idea-capture-section-header');
  const initialHeaderBounds = await headers.first().evaluate(node => {
    const parent = node.parentElement;
    const parentRect = parent.getBoundingClientRect();
    const style = getComputedStyle(parent);
    const rect = node.getBoundingClientRect();
    const contentLeft = parentRect.left + parseFloat(style.paddingLeft);
    const contentRight = parentRect.right - parseFloat(style.paddingRight);
    return { header: rect.toJSON(), contentLeft, contentRight };
  });
  assert.ok(initialHeaderBounds.header.left >= initialHeaderBounds.contentLeft - 1 && initialHeaderBounds.header.right <= initialHeaderBounds.contentRight + 1, `inline header fits its parent content column: ${JSON.stringify(initialHeaderBounds)}`);
  const panel = target.locator('#idea-capture-panel');
  const rail = target.locator('#idea-capture-margin-controls');
  const panelToggle = panel.locator('[data-action="toggle-panel"]');
  assert.equal(await panelToggle.getAttribute('aria-expanded'), 'false', 'the section widget starts closed');
  assert.equal(await panel.locator('.panel-body').isHidden(), true);
  await mkdir('artifacts', { recursive: true });
  for (const width of [390, 1280]) {
    await ui.setViewportSize({ width, height: 900 });
    await ui.evaluate(async () => {
      await document.fonts.ready;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    const formBounds = await ui.evaluate(() => ({ viewportWidth: innerWidth, documentWidth: document.documentElement.scrollWidth, form: document.querySelector('#form').getBoundingClientRect().toJSON() }));
    assert.ok(formBounds.documentWidth <= width, `settings page has no horizontal overflow at ${width}px: ${JSON.stringify(formBounds)}`);
    assert.ok(formBounds.form.left >= 0 && formBounds.form.right <= width, `settings form fits the ${width}px viewport: ${JSON.stringify(formBounds)}`);
    assert.equal(await ui.locator('main').count(), 1, 'the settings page has one main content column');
    await ui.screenshot({ path: `artifacts/settings-${width === 390 ? 'narrow' : 'desktop'}.png`, fullPage: width === 390 });
  }
  await ui.setViewportSize({ width: 390, height: 900 });
  await ui.keyboard.press('Tab');
  assert.equal(await ui.evaluate(() => document.activeElement.id), 'appUrl', 'keyboard focus reaches the first settings field');
  const settingsFocus = await ui.locator('#appUrl').evaluate(node => getComputedStyle(node).outlineStyle);
  assert.notEqual(settingsFocus, 'none', 'the focused settings field has a visible outline');
  assert.equal(await ui.getByLabel(/Allowed capture URLs/).count(), 1, 'the URL pattern editor has an accessible label');
  assert.equal(await ui.getByRole('button', { name: 'Save connections' }).count(), 1, 'settings can be saved through a named form action');
  const send = async message => {
    if (message.type === 'capture') {
      return worker.evaluate(async ({ tabId, mode }) => {
        try {
          await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
          const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func: captureMode => {
            try { return { ok: true, conversation: globalThis.__ideaCaptureController.capture(captureMode || 'preview') }; }
            catch (error) { return { ok: false, error: error.message }; }
          }, args: [mode || 'preview'] });
          return result;
        } catch (error) { return { ok: false, error: error.message }; }
      }, { tabId: message.tabId, mode: message.mode });
    }
    return ui.evaluate(message => chrome.runtime.sendMessage(message), message);
  };

  // Exercise ChatGPT's real origin and project routes with the current role-free
  // turn-article structure. The empty project page must still expose the closed
  // launcher so a user can get to retry/help before messages have loaded.
  await context.route('https://chatgpt.com/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/project')) return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Empty project · ChatGPT</title><main><p>Project conversations will appear here.</p></main>' });
    if (path.endsWith('/c/sticky-composer-wheel')) return route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><title>Sticky composer wheel repro · ChatGPT</title><style>
      *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;font:15px/1.6 system-ui,sans-serif;color:#202522;background:#f6f7f6}
      #thread{height:100vh;width:100vw;overflow:auto;overscroll-behavior:contain;display:flex;flex-direction:column;padding:20px 24px 0}
      .messages{width:min(680px,100%);margin:0 auto;flex:none}.turn{margin:0 0 18px}.user-message-bubble,.markdown{margin:0 0 12px;padding:14px 18px;border-radius:12px;background:#fff}.user-message-bubble{width:max-content;margin-left:auto;background:#e7eee9}.markdown p{margin:0 0 18px}.markdown p:last-child{margin-bottom:0}
      .composer{position:sticky;bottom:0;z-index:2;flex:none;width:min(680px,100%);height:88px;margin:0 auto;padding:14px 20px 18px;background:#fff;border:1px solid #dfe4e0;border-bottom:0;border-radius:14px 14px 0 0}
      .composer [contenteditable=true]{width:100%;height:52px;padding:12px 16px;border:1px solid #ccd4ce;border-radius:16px;background:#fff}
      </style><main id="thread"><div class="messages"><div class="turn"><div class="user-message-bubble"><p>Summarize the research discussion.</p></div><div class="markdown">${Array.from({ length: 24 }, (_, i) => `<p>Conversation answer ${i + 1}: preserve the research context, evidence, and decision links as the discussion continues.</p>`).join('')}<p id="sticky-bottom-marker">End of the final answer.</p></div></div></div><form class="composer"><div contenteditable="true" aria-label="Message composer">Ask anything</div></form></main>
      <script>addEventListener('DOMContentLoaded',()=>{const c=document.querySelector('.composer'),t=document.querySelector('#thread'),m=document.querySelector('#sticky-bottom-marker'),r=c.getBoundingClientRect();window.__nativeComposerGeometry={x:r.x,y:r.y,width:r.width,height:r.height,top:r.top,bottom:r.bottom,paddingBottom:getComputedStyle(t).paddingBottom};t.scrollTop=t.scrollHeight;const cr=c.getBoundingClientRect(),mr=m.getBoundingClientRect(),tr=t.getBoundingClientRect();window.__nativeComposerGeometry.nativeBottom={scrollTop:t.scrollTop,maxScroll:t.scrollHeight-t.clientHeight,composerTop:cr.top,composerBottom:cr.bottom,threadBottom:tr.bottom,markerBottom:mr.bottom,markerVisibleAboveComposer:mr.bottom<=cr.top};t.scrollTop=0;},{once:true});</script>` });
    if (path.endsWith('/c/input-border-anchor')) return route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><title>Composer border anchor repro · ChatGPT</title><style>
      *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;font:15px/1.5 system-ui,sans-serif;color:#202522;background:#f6f7f6}
      #thread{height:100vh;overflow:auto;overscroll-behavior:contain;padding:24px 20px 0}.messages{width:min(760px,100%);margin:0 auto}.turn{padding:12px 18px;margin:0 0 18px;background:#fff;border-radius:12px}.turn h2{font-size:11px;color:#707a72}.turn p{margin:0 0 18px}
      .composer{position:fixed;z-index:2;left:50%;transform:translateX(-50%);width:min(760px,100%);bottom:0;padding:14px 22px 12px;background:#fff;border-radius:24px 24px 0 0}
      .input-surface{width:min(700px,100%);margin:0 auto;padding:14px 18px 10px;border:1px solid #aeb8b0;border-radius:22px;background:#fff;box-shadow:0 1px 3px #0001}
      [contenteditable=true]{min-height:38px;max-height:120px;overflow:auto;outline:0;padding:6px 4px}.disabled-prompt{width:100%;height:38px;resize:none;padding:6px 4px;border:0;background:transparent;font:inherit}.composer-footer{display:flex;justify-content:space-between;align-items:center;gap:12px;padding-top:8px;border-top:1px solid #edf0ed;color:#707a72;font-size:12px}.disclaimer{max-width:700px;margin:6px auto 0;text-align:center;color:#707a72;font-size:11px}
      .code-demo{width:min(700px,100%);margin:12px auto 0;padding:10px 14px;border:1px solid #ddd;border-radius:10px;background:#f0f1ef}.code-demo pre{margin:0;white-space:pre-wrap}
      @media(max-width:600px){.composer{padding:10px 12px 8px}.input-surface{padding:10px 14px 8px;border-radius:18px}.disclaimer{padding:0 12px}}
      </style><main id="thread"><div class="messages">${Array.from({ length: 10 }, (_, i) => `<article class="turn" data-testid="conversation-turn-${i + 1}"><h2>${i % 2 ? 'ChatGPT said:' : 'You said:'}</h2><p>Conversation detail ${i + 1}: maintain normal scrolling while the input grows and the capture tab follows the visible input surface.</p>${i === 1 ? '<div contenteditable="true" style="width:480px;min-height:42px">unlabeled message editor decoy</div>' : ''}</article>`).join('')}<p id="bottom-marker">End of the conversation.</p></div></main>
      <form class="composer"><div class="input-surface" data-visible-input-border><div contenteditable="true">Ask anything</div><textarea class="disabled-prompt" aria-label="Temporary prompt" disabled hidden></textarea><div class="composer-footer"><span>Use a clear prompt</span><button type="button">Send</button></div></div><div class="disclaimer">AI responses may be inaccurate. Verify important information.</div><div class="code-demo"><pre role="textbox" aria-readonly="true">readonly code textbox decoy</pre></div></form>
      <script>addEventListener('DOMContentLoaded',()=>{const t=document.querySelector('#thread'),f=document.querySelector('.composer'),r=f.getBoundingClientRect();t.scrollTop=0;window.__nativeComposerRect={x:r.x,y:r.y,width:r.width,height:r.height,top:r.top,bottom:r.bottom};window.__nativeScrollStyle={overflow:getComputedStyle(t).overflowY,paddingBottom:getComputedStyle(t).paddingBottom};},{once:true});</script>` });
    if (path.endsWith('/c/role-wrapper-layout')) return route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><title>Gallery planning · ChatGPT</title><style>
      *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;font:15px/1.6 system-ui,sans-serif;color:#202522;background:#f6f7f6}
      main#thread{height:100vh;width:100vw;overflow:auto;overscroll-behavior:contain;padding:22px 0}
      [data-message-author-role]{width:100%;padding:12px 20px}.prose-column{width:min(620px,calc(100% - 24px));margin:0 auto}
      .prose{padding:14px 18px;border-radius:12px;background:white}.prompt{width:max-content;max-width:100%;margin-left:auto;padding:10px 14px;border-radius:14px;background:#e7eee9}
      .image-gallery{position:relative;left:50%;transform:translateX(-50%);display:flex;gap:10px;justify-content:flex-end;margin:18px auto;padding:10px 40px;width:100vw;border-radius:12px;background:#e9ece9}
      .gallery-card{width:150px;height:92px;padding:12px;border-radius:8px;background:linear-gradient(135deg,#e5eee8,#f4e6d4);font-size:12px}
      .composer{height:100px;padding:16px;background:#fff}.composer [contenteditable=true]{width:min(620px,100%);height:54px;margin:auto;padding:12px;border:1px solid #ccd4ce;border-radius:16px}
      </style><main id="thread">
        <div data-message-author-role="user"><div class="prose-column"><div class="prompt"><p>Choose a visual direction for the pilot.</p></div></div></div>
        <div data-message-author-role="assistant"><div class="prose-column"><div class="prose"><p>Compare the field notes, survey summary, and location map in the gallery.</p></div><div class="image-gallery" id="gallery"><figure class="gallery-card">Field notes</figure><figure class="gallery-card">Survey summary</figure><figure class="gallery-card">Location map</figure></div></div></div>
        <div data-message-author-role="user"><div class="prose-column"><div class="prompt"><p>Which concept should we test first?</p></div></div></div>
        <div data-message-author-role="assistant"><div class="prose-column"><div class="prose"><p>Test the map with interview participants.</p></div></div></div>
        <div class="composer"><div contenteditable="true" aria-label="Message composer">Ask anything</div></div>
      </main>` });
    if (path.endsWith('/c/actual-layout')) return route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><title>Planning · ChatGPT</title><style>
      *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;font:15px/1.6 system-ui,sans-serif;color:#202522;background:#f6f7f6}
      main.sidebar{position:fixed;inset:0 auto 0 0;width:220px;padding:22px;background:#ecefeb;border-right:1px solid #d7ddd8;z-index:2}
      main.sidebar a{display:block;padding:10px;color:#24543b}.fullwidth-wrapper{position:fixed;inset:0 0 0 220px;width:calc(100% - 220px);display:flex;flex-direction:column;align-items:stretch}
      .toolbar{height:54px;flex:none;padding:14px 24px;border-bottom:1px solid #e1e5e2;background:white}.conversation-frame{flex:1;min-height:0;display:flex;flex-direction:column}
      #thread{height:100%;overflow:auto;overscroll-behavior:contain;padding:18px 24px 24px;scrollbar-gutter:stable}
      .thread-inner{width:min(620px,100%);margin:0 auto}.turn{margin:0 0 28px}.user-message-bubble{width:max-content;max-width:88%;margin-left:auto;padding:12px 16px;border-radius:16px;background:#e7eee9}
      .markdown{max-width:100%;padding:12px 16px;background:white;border-radius:12px}.markdown p{margin:0 0 12px}.markdown p:last-child{margin-bottom:0}.composer{height:88px;flex:none;padding:14px 20px 18px;background:#fff;border-top:1px solid #dfe4e0}
      .image-gallery{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:14px 0}.gallery-card{min-height:78px;padding:10px;border-radius:8px;background:linear-gradient(135deg,#e5eee8,#f4e6d4);font-size:12px}
      .composer [contenteditable=true]{width:min(620px,100%);height:52px;margin:auto;padding:12px 16px;border:1px solid #ccd4ce;border-radius:16px;background:#fff}
      </style><main class="sidebar"><strong>Workspace</strong><a href="#project-link" id="project-link">Project home</a><a href="#help-link" id="help-link">Help</a></main>
      <div class="fullwidth-wrapper"><div class="toolbar">Planning conversation</div><section class="conversation-frame"><div id="thread"><div class="thread-inner">
        <div class="turn"><div class="user-message-bubble"><p>Compare the community interview and survey plans.</p></div><div class="markdown"><p>Interviews explain local context and motivations.</p><div class="image-gallery"><figure class="gallery-card">Interview notes</figure><figure class="gallery-card">Survey chart</figure><figure class="gallery-card">Field map</figure></div>${longResearch}<p><a href="${appUrl}/media/brief.pdf">Open the research brief</a></p></div></div>
        <div class="turn"><div class="user-message-bubble"><p>How should we scope the pilot?</p></div><div class="markdown"><p>Start with three interviews and a short survey.</p>${longConsent}</div></div>
        <div class="turn"><div class="user-message-bubble"><p>What will the team learn?</p></div><div class="markdown"><p>Compare how each method changes the next decision.</p>${Array.from({ length: 12 }, (_, i) => `<p>Final response detail ${i + 1}: record what participants learned, which evidence changed the team's decision, and what should happen next.</p>`).join('')}<p id="bottom-content-marker">End of the final answer.</p></div></div>
      </div></div><form class="composer"><div contenteditable="true" aria-label="Message composer">Ask anything</div></form></section></div>
      <script>addEventListener('DOMContentLoaded',()=>{const r=document.querySelector('.composer').getBoundingClientRect();window.__nativeComposerGeometry={x:r.x,y:r.y,width:r.width,height:r.height,top:r.top,bottom:r.bottom};},{once:true});</script>` });
    if (path.endsWith('/c/reported-layout')) return route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><title>Conversation · ChatGPT</title><style>
      *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;font:15px/1.6 system-ui,sans-serif;color:#202522;background:#f6f7f6}
      nav{position:fixed;inset:0 auto 0 0;width:210px;padding:24px;background:#ecefeb;border-right:1px solid #d7ddd8}nav a{display:block;padding:10px;color:#24543b}
      .frame{position:fixed;inset:0 0 0 210px;display:flex;flex-direction:column}.toolbar{height:54px;padding:14px 24px;background:white;border-bottom:1px solid #e1e5e2}
      #thread{flex:1;min-height:0;overflow:auto;padding:18px 24px 30px}#thread>div{width:min(700px,100%);margin:0 auto 8px}#thread>div:has(.reply-shell){margin-bottom:28px;padding:14px 18px;background:white;border-radius:12px}
      .relative{position:relative;width:100%;min-width:0}.flex{display:flex}.flex-col{flex-direction:column}.items-end{align-items:flex-end}.gap-1{gap:4px}
      .bg-user-message{width:max-content;max-width:min(580px,100%);padding:12px 16px;border-radius:16px;background:#e7eee9}.whitespace-pre-wrap{white-space:pre-wrap}
      #thread p{margin:0 0 12px}#thread table{border-collapse:collapse;margin:10px 0}#thread td{padding:7px 10px;border:1px solid #d9dfda}
      .reply-shell{margin:18px 0 24px;padding:16px 18px 20px;border:1px solid #e1e6e2;border-radius:14px;background:#fff;box-shadow:0 3px 12px #17271d12}
      .gallery-shell{margin:18px 0 12px;padding:14px;border:1px solid #dce3de;border-radius:12px;background:#f3f6f3}.gallery{display:flex;gap:10px;margin:0}.gallery figure{flex:none;width:150px;height:96px;margin:0;padding:8px;border-radius:8px;background:#e9eee9;box-shadow:0 2px 8px #18251b20}.gallery img{width:100%;height:100%;object-fit:cover}
      .reference-row,.action-row{display:flex;align-items:center;gap:8px;margin-top:12px}.reference-chip{display:inline-flex;padding:4px 9px;border:1px solid #d9e1dc;border-radius:999px;background:#fff;color:#51645a;font-size:12px}.action-row{justify-content:flex-end;margin-top:18px;padding-top:12px;border-top:1px solid #e8ece9}.action-row button{border:0;border-radius:8px;background:#f2f4f2;padding:7px 10px;color:#526057;font:12px system-ui,sans-serif}
      .composer{height:88px;flex:none;padding:14px 20px 18px;background:#fff;border-top:1px solid #dfe4e0}.composer [contenteditable=true]{width:min(700px,100%);height:52px;margin:auto;padding:12px 16px;border:1px solid #ccd4ce;border-radius:16px;background:white}
      </style><nav><a href="#workspace">Workspace</a><a href="#help">Help</a></nav><div class="frame"><div class="toolbar">Research planning</div><main id="thread">
        <div><div class="relative w-full min-w-0 text-size-chat leading-relaxed"><div class="flex flex-col items-end gap-1"><div class="bg-user-message text-user-message min-w-0 max-w-(--user-chat-width) overflow-hidden break-words"><div><div class="whitespace-pre-wrap">Compare the community interview and survey findings.</div></div></div></div></div></div>
        <div><div class="relative w-full min-w-0"><div class="reply-shell"><p>Interviews explain local context; surveys show how common each pattern is.</p><table><tbody><tr><td>Interviews</td><td>Context and motivations</td></tr><tr><td>Survey</td><td>Pattern frequency</td></tr></tbody></table><div class="gallery-shell"><div class="gallery" id="reported-gallery"><figure class="gallery-card"><img id="reported-evidence" alt="Study evidence"></figure><figure class="gallery-card" aria-hidden="true">Field notes</figure><figure class="gallery-card" aria-hidden="true">Survey map</figure></div></div><div class="reference-row"><span class="reference-chip" aria-hidden="true">Sources</span><span class="reference-chip" aria-hidden="true">+1</span></div><div class="action-row"><button type="button" aria-label="Copy response">Copy</button><button type="button" aria-label="More response actions">•••</button></div></div></div></div>
        <div id="reported-orphan-gallery" class="gallery-shell" aria-hidden="true"><div class="gallery"><figure class="gallery-card">Empty image card</figure><figure class="gallery-card">Empty image card</figure></div></div>
        <section id="reported-sibling-code" aria-label="Example code" style="margin:12px 0;padding:12px;border:1px solid #d9dfda;border-radius:10px;background:#f7f8f6"><div style="display:flex;align-items:center;gap:8px;padding-bottom:8px"><span>JavaScript</span><button type="button" aria-label="Copy code">Copy code</button><button type="button" aria-label="Open editor">Open editor</button></div><pre role="textbox" aria-readonly="true"><code>const externalPanelCode = "preserve this standalone code panel";</code></pre><textarea readonly aria-label="Code editor">const editorNote = "preserve the original code";</textarea></section>
        <div id="reported-orphan-references" class="reference-row" aria-hidden="true"><span class="reference-chip">Sources</span><span class="reference-chip">+1</span></div>
        <div id="reported-orphan-actions" class="action-row" aria-hidden="true"><button type="button">Copy</button><button type="button">•••</button></div>
        <div><div class="relative w-full min-w-0 text-size-chat leading-relaxed"><div class="flex flex-col items-end gap-1"><div class="bg-user-message text-user-message min-w-0 max-w-(--user-chat-width) overflow-hidden break-words"><div><div class="whitespace-pre-wrap">What should the pilot test first?</div></div></div></div></div></div>
        <div><div class="relative w-full min-w-0"><div class="reply-shell"><p>Test the interview guide with three participants, then revise the survey.</p><div class="gallery-shell"><div class="gallery"><figure class="gallery-card">Interview guide</figure><figure class="gallery-card">Survey draft</figure></div></div><div class="reference-row"><span class="reference-chip" aria-hidden="true">Method notes</span></div><div class="action-row"><button type="button" aria-label="Copy response">Copy</button><button type="button" aria-label="More response actions">•••</button></div></div></div></div>
      </main><form class="composer"><div contenteditable="true" aria-label="Message composer">Ask anything</div></form></div>` });
    if (path.endsWith('/c/reported-single-layout')) return route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><title>Conversation · ChatGPT</title><main id="thread">
      <div><div class="relative w-full min-w-0 text-size-chat leading-relaxed"><div class="flex flex-col items-end gap-1"><div class="bg-user-message text-user-message min-w-0 max-w-(--user-chat-width) overflow-hidden break-words"><div><div class="whitespace-pre-wrap">What did the participants say?</div></div></div></div></div></div>
      <div><div class="relative w-full min-w-0"><p>Participants valued a shorter onboarding flow.</p><table><tbody><tr><td>Clarity</td><td>Time saved</td></tr></tbody></table></div></div>
    </main>` });
    return route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><title>Planning · ChatGPT</title><style>body{margin:0;font:16px/1.6 system-ui,sans-serif}main.chat{max-width:700px;margin:0 auto;padding:32px 24px;min-height:100vh}article{display:block;margin:18px 0;padding:16px 20px;background:white}</style><main class="chat">
      <article data-testid="conversation-turn-1"><h2 class="sr-only">You said:</h2><div class="markdown"><p>Compare two research approaches.</p></div></article>
      <article data-testid="conversation-turn-2"><h2 class="sr-only">ChatGPT said:</h2><div class="markdown"><p>Interviews give context; surveys give breadth.</p><p>Before the images.</p><img id="inline-png" alt="PNG evidence"><img id="inline-webp" alt="WebP evidence"><p>After the images.</p><p><a href="${appUrl}/media/brief.pdf" download="brief.pdf">Read the linked PDF brief</a></p></div></article>
      <article data-testid="conversation-turn-3"><h2 class="sr-only">You said:</h2><div class="markdown"><p>What should the pilot include?</p></div></article>
      <article data-testid="conversation-turn-4"><h2 class="sr-only">ChatGPT said:</h2><div class="markdown"><p>Test the interview guide with three participants.</p></div></article>
    </main>` });
  });
  await context.route('https://claude.ai/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><title>Composer anchor check · Claude</title><style>
    *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;font:15px/1.5 system-ui,sans-serif;color:#202522;background:#f6f7f6}
    #thread{height:100vh;overflow:auto;padding:24px}.turn{width:min(700px,100%);margin:0 auto 20px;padding:16px;background:#fff;border-radius:12px}
    .composer{position:fixed;left:0;right:0;bottom:0;height:112px;padding:14px 20px;border:1px solid #d6ddd7;border-bottom:0;border-radius:18px 18px 0 0;background:#fff}
    .composer [contenteditable=true]{width:min(680px,100%);height:54px;margin:auto;padding:12px;border:1px solid #c8d0ca;border-radius:14px;background:#fff}
    </style><main id="thread"><article class="turn" data-testid="user-message"><p>Compare these project notes.</p></article><article class="turn font-claude-response"><p>The notes describe a short research pilot.</p></article></main><form class="composer"><div contenteditable="true" aria-label="Message composer">Reply to Claude</div></form>` }));

  // Drive URL scope changes through the real options form. Keep both tabs open
  // so settings changes and SPA route transitions must update already loaded pages.
  const rootScopePage = await context.newPage();
  const pathScopePage = await context.newPage();
  await Promise.all([
    rootScopePage.goto('https://chatgpt.com/'),
    pathScopePage.goto('https://chatgpt.com/c/settings-regression'),
  ]);
  const waitForCaptureHost = async (page, present) => page.waitForFunction(expected =>
    Boolean(document.querySelector('[data-idea-capture-owned="host"]')) === expected, present, { timeout: 5000 });
  await waitForCaptureHost(rootScopePage, true);
  await waitForCaptureHost(pathScopePage, true);
  const saveAllowedUrls = async value => {
    await ui.locator('#allowedOrigins').fill(value);
    await ui.locator('#form button[type="submit"]').click();
    await ui.waitForFunction(() => document.querySelector('#status')?.textContent === 'Connections saved.');
    const saved = await ui.evaluate(async () => (await chrome.storage.local.get('settings')).settings);
    assert.equal(saved.allowedOrigins.join('\n'), value, `settings UI persists the selected capture URL pattern: ${value}`);
    await ui.reload();
    assert.equal(await ui.getByLabel(/Allowed capture URLs/).inputValue(), value, `settings UI loads the saved URL pattern: ${value}`);
    return saved;
  };
  const changeRouteWithoutReload = async (page, path) => {
    const before = await page.evaluate(() => performance.getEntriesByType('navigation').length);
    await page.evaluate(path => history.pushState({}, '', path), path);
    assert.equal(await page.evaluate(() => performance.getEntriesByType('navigation').length), before, 'SPA route change does not reload the tab');
  };

  await saveAllowedUrls(`https://chatgpt.com\n${appUrl}/*`);
  await waitForCaptureHost(rootScopePage, true);
  await waitForCaptureHost(pathScopePage, false);
  await changeRouteWithoutReload(rootScopePage, '/c/root-only');
  await waitForCaptureHost(rootScopePage, false);
  await changeRouteWithoutReload(pathScopePage, '/');
  await waitForCaptureHost(pathScopePage, true);

  // Put the open tabs back on root/path so the next save verifies that the
  // wildcard setting flips their eligibility in the opposite direction.
  await changeRouteWithoutReload(rootScopePage, '/');
  await waitForCaptureHost(rootScopePage, true);
  await changeRouteWithoutReload(pathScopePage, '/c/settings-regression');
  await waitForCaptureHost(pathScopePage, false);

  await saveAllowedUrls(`https://chatgpt.com/*\n${appUrl}/*`);
  await waitForCaptureHost(rootScopePage, false);
  await waitForCaptureHost(pathScopePage, true);
  await changeRouteWithoutReload(rootScopePage, '/c/subpaths-only');
  await waitForCaptureHost(rootScopePage, true);
  await changeRouteWithoutReload(pathScopePage, '/');
  await waitForCaptureHost(pathScopePage, false);

  const project = await context.newPage();
  await project.goto('https://chatgpt.com/g/g-p-demo/project');
  const projectHost = project.locator('[data-idea-capture-owned="host"]');
  await projectHost.waitFor({ state: 'attached' });
  await project.waitForFunction(() => {
    const shadow = document.querySelector('[data-idea-capture-owned="host"]')?.shadowRoot;
    return shadow?.querySelector('[data-action="toggle-panel"]');
  });
  const emptyLauncher = await project.evaluate(() => {
    const shadow = document.querySelector('[data-idea-capture-owned="host"]')?.shadowRoot;
    const button = shadow?.querySelector('[data-action="toggle-panel"]');
    return { visible: !!button && button.getBoundingClientRect().width > 0, expanded: button?.getAttribute('aria-expanded'), panelHidden: shadow?.querySelector('#idea-capture-panel')?.hidden };
  });
  assert.deepEqual(emptyLauncher, { visible: false, expanded: 'false', panelHidden: true }, `ChatGPT hides the closed tab when there is no visible input edge to anchor to: ${JSON.stringify(emptyLauncher)}`);
  await project.evaluate(() => document.querySelector('[data-idea-capture-owned="host"]')?.shadowRoot?.querySelector('[data-action="toggle-panel"]')?.click());
  assert.equal(await project.evaluate(() => {
    const shadow = document.querySelector('[data-idea-capture-owned="host"]')?.shadowRoot;
    return shadow?.querySelector('.panel-body [data-action="retry"]')?.textContent;
  }), 'Retry detection', 'the expanded empty state offers a retry action');
  await project.evaluate(() => document.querySelector('[data-idea-capture-owned="host"]')?.shadowRoot?.querySelector('.empty [data-action="copy-diagnostics"]')?.click());
  await project.waitForFunction(() => {
    const status = document.querySelector('[data-idea-capture-owned="host"]')?.shadowRoot?.querySelector('[data-diagnostics-status]')?.textContent;
    return status === 'Diagnostics copied to clipboard.' || status === 'Clipboard access failed. Select and copy the diagnostics below.';
  });
  const diagnosticFallback = await project.evaluate(() => {
    const shadow = document.querySelector('[data-idea-capture-owned="host"]')?.shadowRoot;
    const textarea = shadow?.querySelector('[data-diagnostics-fallback]');
    return { visible: !!textarea && !textarea.hidden, label: textarea?.getAttribute('aria-label'), focused: shadow?.activeElement === textarea, status: shadow?.querySelector('[data-diagnostics-status]')?.textContent };
  });
  assert.ok(diagnosticFallback.label, 'the manual diagnostics fallback has an accessible name');
  if (diagnosticFallback.status.startsWith('Clipboard access failed')) {
    assert.equal(diagnosticFallback.visible, true, 'the manual diagnostics fallback appears when clipboard access fails');
    assert.equal(diagnosticFallback.focused, true, 'keyboard focus moves to the manual diagnostics fallback');
  }
  await project.evaluate(() => document.querySelector('[data-idea-capture-owned="host"]')?.shadowRoot?.querySelector('[data-action="toggle-panel"]')?.click());
  assert.equal(await project.evaluate(() => document.querySelector('[data-idea-capture-owned="host"]')?.shadowRoot?.querySelector('[data-action="toggle-panel"]')?.getAttribute('aria-expanded')), 'false');
  await project.goto('https://chatgpt.com/g/g-p-demo/c/123');
  const projectTabId = await worker.evaluate(async () => (await chrome.tabs.query({ url: 'https://chatgpt.com/g/g-p-demo/c/123' }))[0].id);
  await project.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 64;
    const context = canvas.getContext('2d'); context.fillStyle = '#e8f0eb'; context.fillRect(0, 0, 96, 64); context.fillStyle = '#247a52'; context.fillRect(8, 8, 80, 48);
    document.querySelector('#inline-png').src = canvas.toDataURL('image/png');
    document.querySelector('#inline-webp').src = canvas.toDataURL('image/webp');
  });
  await project.locator('.idea-capture-section-header').first().waitFor();
  const projectCapture = await send({ type: 'capture', tabId: projectTabId });
  assert.equal(projectCapture.ok, true, projectCapture.error);
  assert.equal(projectCapture.conversation.provider, 'ChatGPT');
  assert.equal(projectCapture.conversation.messages.length, 4);
  assert.equal(projectCapture.conversation.sections.length, 2);
  assert.match(projectCapture.conversation.messages[0].markdown, /two research approaches/);
  assert.match(projectCapture.conversation.messages[1].markdown, /surveys give breadth/);
  assert.equal(projectCapture.conversation.media.length, 3, 'inline PNG, WebP, and linked PDF are captured as media companions');
  const mediaMessage = projectCapture.conversation.messages[1].markdown;
  const mediaMarkers = [...mediaMessage.matchAll(/\{\{idea-media:/g)].map(match => match.index);
  assert.equal(mediaMarkers.length, 3);
  assert.ok(mediaMessage.indexOf('Before the images.') < mediaMarkers[0], 'text before inline media stays before its placeholder');
  assert.ok(mediaMarkers[1] < mediaMessage.indexOf('After the images.') && mediaMessage.indexOf('After the images.') < mediaMarkers[2], 'text after inline images stays before the linked PDF placeholder');
  const mediaById = new Map(projectCapture.conversation.media.map(item => [item.id, item]));
  const referencedKinds = [...mediaMessage.matchAll(/\{\{idea-media:([^}]+)\}\}/g)].map(match => mediaById.get(match[1])?.kind);
  assert.deepEqual(referencedKinds, ['image', 'image', 'file'], 'placeholders keep the images between surrounding text and the PDF after them');
  assert.equal(projectCapture.conversation.media.find(item => item.filename === 'brief.pdf')?.kind, 'file');

  // Exercise the screenshot's provider structure: no role, test ID, or article
  // labels; a nested scrolling #thread; a narrow first <main>; and centered
  // message content inside a full-width layout with sidebar and composer.
  const actualLayout = await context.newPage();
  await actualLayout.setViewportSize({ width: 1440, height: 900 });
  await actualLayout.goto('https://chatgpt.com/g/g-p-demo/c/actual-layout');
  await actualLayout.locator('.idea-capture-section-header').first().waitFor();
  const nativeComposerGeometry = await actualLayout.evaluate(() => {
    const native = window.__nativeComposerGeometry;
    const rect = document.querySelector('.composer').getBoundingClientRect();
    return { native, injected: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, top: rect.top, bottom: rect.bottom } };
  });
  assert.deepEqual(nativeComposerGeometry.injected, nativeComposerGeometry.native, `extension injection preserves the page's composer geometry: ${JSON.stringify(nativeComposerGeometry)}`);
  assert.equal(await actualLayout.locator('.idea-capture-section-header').count(), 3, 'class-based provider markup creates one section for each prompt');
  assert.equal(await actualLayout.locator('#thread [data-message-author-role], #thread [data-role], #thread [data-turn-role], #thread [data-testid], #thread [role], #thread article').count(), 0, 'the provider fixture contains no role, test ID, or article hints');
  const actualTabId = await worker.evaluate(async () => (await chrome.tabs.query({ url: 'https://chatgpt.com/g/g-p-demo/c/actual-layout' }))[0].id);
  const actualCapture = await send({ type: 'capture', tabId: actualTabId });
  assert.equal(actualCapture.ok, true, actualCapture.error);
  assert.equal(actualCapture.conversation.messages.length, 6, 'all class-detected prompts and replies are captured');
  assert.equal(actualCapture.conversation.sections.length, 3);
  assert.match(actualCapture.conversation.messages[0].markdown, /community interview and survey plans/);
  assert.match(actualCapture.conversation.messages[1].markdown, /local context and motivations/);
  assert.ok(actualCapture.conversation.media.some(item => item.filename === 'brief.pdf'), 'the linked research brief remains attached to its response');
  const actualThread = actualLayout.locator('#thread');
  const actualHeader = actualLayout.locator('.idea-capture-section-header');
  const actualThreadBefore = await actualThread.evaluate(node => ({ scrollTop: node.scrollTop, windowScrollY: window.scrollY }));
  await actualHeader.nth(0).locator('button[data-idea-section-id]').click();
  await actualLayout.waitForFunction(() => getComputedStyle(document.querySelector('.idea-capture-section-collapsed')).display === 'none');
  assert.equal(await actualLayout.locator('.user-message-bubble').nth(0).isVisible(), false, 'the prompt-side header toggle collapses its whole prompt and response group');
  assert.equal(await actualLayout.locator('.user-message-bubble').nth(1).isVisible(), true, 'the next prompt stays visible');
  await actualHeader.nth(0).locator('button[data-idea-section-id]').click();
  await actualLayout.waitForFunction(() => !document.querySelector('.idea-capture-section-collapsed'));
  const actualGutters = await actualLayout.evaluate(() => {
    const thread = document.querySelector('#thread');
    const message = thread.querySelector('.turn');
    const content = message.querySelector('.user-message-bubble');
    const rect = content.getBoundingClientRect();
    const scrollRect = thread.getBoundingClientRect();
    const random = () => 0.2 + Math.random() * 0.6;
    return { leftX: 235 + Math.round(random() * 65), rightX: 1170 + Math.round(random() * Math.max(1, innerWidth - 1200)), y: Math.max(scrollRect.top + 24, Math.min(rect.top + rect.height * random(), scrollRect.bottom - 24)) };
  });
  assert.ok(actualGutters.leftX < await actualLayout.locator('.user-message-bubble').first().evaluate(node => node.getBoundingClientRect().left), 'the left click coordinate sits in the blank gutter');
  await actualLayout.mouse.click(actualGutters.leftX, actualGutters.y);
  await actualLayout.waitForFunction(() => document.querySelector('.idea-capture-section-header')?.nextElementSibling?.classList.contains('idea-capture-section-collapsed'), null, { timeout: 2000 }).catch(() => {});
  assert.ok(await actualHeader.nth(0).evaluate(node => node.nextElementSibling?.classList.contains('idea-capture-section-collapsed')), 'a left gutter click collapses the section beside that prompt');
  assert.equal(await actualLayout.locator('.user-message-bubble').nth(1).isVisible(), true, 'a left gutter click leaves the neighboring section visible');
  const firstRestoreY = await actualHeader.nth(0).evaluate(node => { const rect = node.getBoundingClientRect(); return rect.top + rect.height / 2; });
  await actualLayout.mouse.click(actualGutters.rightX, firstRestoreY);
  assert.equal(await actualLayout.locator('.idea-capture-section-collapsed').count(), 0, 'a right gutter click restores the same section');
  const threadMetrics = await actualThread.evaluate(node => ({ scrollTop: node.scrollTop, windowScrollY: window.scrollY, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight }));
  assert.equal(threadMetrics.scrollTop, actualThreadBefore.scrollTop, 'gutter and prompt toggles preserve the nested thread scroll position');
  assert.equal(threadMetrics.windowScrollY, actualThreadBefore.windowScrollY, 'nested scrolling does not move the outer page');
  assert.ok(threadMetrics.scrollHeight > threadMetrics.clientHeight, 'the conversation uses a genuinely scrollable nested thread');
  await actualThread.evaluate(node => {
    const bubble = node.querySelectorAll('.user-message-bubble')[1];
    node.scrollTop = Math.max(0, node.scrollTop + bubble.getBoundingClientRect().top - node.getBoundingClientRect().top - 120);
  });
  await actualLayout.waitForFunction(() => document.querySelector('#thread').scrollTop > 0);
  const secondGutter = await actualLayout.evaluate(() => {
    const thread = document.querySelector('#thread');
    const response = thread.querySelectorAll('.markdown')[1];
    const rect = response.getBoundingClientRect();
    const scrollRect = thread.getBoundingClientRect();
    const random = () => 0.2 + Math.random() * 0.6;
    return { leftX: 235 + Math.round(random() * 65), rightX: 1170 + Math.round(random() * Math.max(1, innerWidth - 1200)), y: Math.max(scrollRect.top + 24, Math.min(rect.top + rect.height * random(), scrollRect.bottom - 24)) };
  });
  await actualLayout.mouse.click(secondGutter.rightX, secondGutter.y);
  assert.ok(await actualHeader.nth(1).evaluate(node => node.nextElementSibling?.classList.contains('idea-capture-section-collapsed')), 'a right gutter click at a scrolled position collapses the correct second section');
  assert.equal(await actualLayout.locator('.user-message-bubble').nth(0).isVisible(), true, 'the scrolled right gutter click leaves the first section visible');
  const secondRestoreY = await actualHeader.nth(1).evaluate(node => { const rect = node.getBoundingClientRect(); return rect.top + rect.height / 2; });
  await actualLayout.mouse.click(secondGutter.leftX, secondRestoreY);
  assert.equal(await actualLayout.locator('.idea-capture-section-collapsed').count(), 0, 'a left gutter click restores the scrolled section');
  assert.equal(await actualLayout.locator('#project-link').getAttribute('href'), '#project-link', 'sidebar navigation remains intact');
  assert.equal(await actualLayout.locator('.composer [contenteditable="true"]').textContent(), 'Ask anything', 'the composer remains intact');
  assert.equal(await actualLayout.locator('.markdown a').count(), 1, 'links in provider message content remain intact');
  const dock = await actualLayout.evaluate(() => new Promise(resolve => requestAnimationFrame(() => {
    const panel = document.querySelector('[data-idea-capture-owned="host"]').shadowRoot.querySelector('#idea-capture-panel');
    const panelRect = panel.getBoundingClientRect();
    const inputRect = document.querySelector('.composer [contenteditable="true"]').getBoundingClientRect();
    resolve({ docked: panel.classList.contains('is-docked'), gap: inputRect.top - panelRect.bottom, inside: panelRect.left > inputRect.left + inputRect.width / 2 && panelRect.right < inputRect.right });
  })));
  assert.deepEqual(dock, { docked: true, gap: -1, inside: true }, 'the closed widget sits on the right of the chat input as a tab');
  const grownGap = await actualLayout.evaluate(() => new Promise(resolve => {
    const input = document.querySelector('.composer [contenteditable="true"]');
    const before = input.getBoundingClientRect().top;
    input.style.minHeight = `${input.getBoundingClientRect().height + 48}px`;
    input.parentElement.style.height = `${input.parentElement.getBoundingClientRect().height + 48}px`;
    setTimeout(() => requestAnimationFrame(() => {
      const panelRect = document.querySelector('[data-idea-capture-owned="host"]').shadowRoot.querySelector('#idea-capture-panel').getBoundingClientRect();
      const top = input.getBoundingClientRect().top;
      input.style.minHeight = input.parentElement.style.height = '';
      resolve({ moved: top < before, gap: top - panelRect.bottom });
    }), 50);
  }));
  assert.deepEqual(grownGap, { moved: true, gap: -1 }, 'the tab follows the composer when it grows without DOM insertions');
  await actualLayout.evaluate(() => document.querySelector('[data-idea-capture-owned="host"]').shadowRoot.querySelector('[data-action="toggle-panel"]').click());
  const openDock = await actualLayout.evaluate(() => {
    const panelRect = document.querySelector('[data-idea-capture-owned="host"]').shadowRoot.querySelector('#idea-capture-panel').getBoundingClientRect();
    const inputRect = document.querySelector('.composer [contenteditable="true"]').getBoundingClientRect();
    return { rightAligned: Math.abs(inputRect.right - 16 - panelRect.right) < 1, above: panelRect.bottom <= inputRect.top };
  });
  assert.deepEqual(openDock, { rightAligned: true, above: true }, 'the opened widget stays on the right, above the chat input');
  await actualLayout.evaluate(() => document.querySelector('[data-idea-capture-owned="host"]').shadowRoot.querySelector('[data-action="toggle-panel"]').click());
  // ChatGPT: unstyled textarea → display:contents wrappers → the bordered form is the visible box.
  const contentsDock = await actualLayout.evaluate(() => new Promise(resolve => {
    const form = document.querySelector('form.composer');
    const original = form.outerHTML;
    form.outerHTML = '<form class="composer" style="width:640px;height:auto;margin:0 auto 18px;padding:10px;border:1px solid #ccd4ce;border-radius:28px"><div style="display:contents"><div style="display:contents"><textarea style="display:block;width:100%;height:56px;border:0;background:transparent">Ask anything</textarea></div></div></form>';
    setTimeout(() => requestAnimationFrame(() => {
      const panel = document.querySelector('[data-idea-capture-owned="host"]').shadowRoot.querySelector('#idea-capture-panel');
      const surface = document.querySelector('form.composer').getBoundingClientRect();
      const gap = surface.top - panel.getBoundingClientRect().bottom;
      const passThrough = getComputedStyle(panel).pointerEvents;
      document.querySelector('form.composer').outerHTML = original;
      resolve({ gap, passThrough });
    }), 300);
  }));
  assert.deepEqual(contentsDock, { gap: -1, passThrough: 'none' }, 'the tab docks on the styled surface past display:contents wrappers and lets wheel/clicks reach the page');
  await actualLayout.screenshot({ path: 'artifacts/provider-layout-sections.png', fullPage: true });
  const reportedLayout = await context.newPage();
  await reportedLayout.setViewportSize({ width: 1440, height: 900 });
  await reportedLayout.goto('https://chatgpt.com/g/g-p-demo/c/reported-layout');
  await reportedLayout.locator('.idea-capture-section-header').first().waitFor();
  assert.equal(await reportedLayout.locator('.idea-capture-section-header').count(), 2, 'the reported user bubble layout creates two prompt sections');
  assert.equal(await reportedLayout.locator('.bg-user-message').count(), 2);
  assert.equal(await reportedLayout.locator('#thread [data-message-author-role], #thread [data-role], #thread [data-turn-role], #thread [data-testid], #thread [role]:not([role="textbox"]), #thread article, #thread .markdown, #thread .prose, #thread .assistant-turn').count(), 0, 'the reported fixture uses no role, test ID, article, or fabricated assistant markers beyond the native editor surface');
  assert.equal(await reportedLayout.locator('#reported-sibling-code pre[role="textbox"][aria-readonly="true"]').count(), 1, 'the code panel exposes a read-only code editor surface');
  assert.equal(await reportedLayout.locator('#reported-sibling-code button').count(), 2, 'the code panel includes its copy and editor actions');
  await reportedLayout.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 64;
    const context = canvas.getContext('2d'); context.fillStyle = '#e8f0eb'; context.fillRect(0, 0, 96, 64); context.fillStyle = '#247a52'; context.fillRect(8, 8, 80, 48);
    document.querySelector('#reported-evidence').src = canvas.toDataURL('image/png');
  });
  const reportedTabId = await worker.evaluate(async () => (await chrome.tabs.query({ url: 'https://chatgpt.com/g/g-p-demo/c/reported-layout' }))[0].id);
  const reportedCapture = await send({ type: 'capture', tabId: reportedTabId });
  assert.equal(reportedCapture.ok, true, reportedCapture.error);
  assert.equal(reportedCapture.conversation.messages.length, 4, 'both prompts and their inferred replies are captured');
  assert.deepEqual(reportedCapture.conversation.messages.map(message => message.role), ['User', 'Message', 'User', 'Message']);
  assert.equal(reportedCapture.conversation.messages[0].sectionId, reportedCapture.conversation.messages[1].sectionId, 'the first reply stays with its prompt');
  assert.equal(reportedCapture.conversation.messages[2].sectionId, reportedCapture.conversation.messages[3].sectionId, 'the second reply stays with its prompt');
  assert.match(reportedCapture.conversation.messages[1].markdown, /local context/);
  assert.match(reportedCapture.conversation.messages[1].markdown, /Pattern frequency/);
  assert.doesNotMatch(reportedCapture.conversation.messages[1].markdown, /Compare the community interview|What should the pilot test first/);
  assert.match(reportedCapture.conversation.messages[3].markdown, /three participants/);
  assert.doesNotMatch(reportedCapture.conversation.messages[3].markdown, /Compare the community interview|What should the pilot test first/);
  assert.equal(reportedCapture.conversation.media.length, 1, 'the image in the inferred reply is captured');
  assert.equal(reportedCapture.conversation.media[0].messageRole, 'Message');
  assert.doesNotMatch(reportedCapture.conversation.messages[1].markdown, /Sources|\+1|Copy|More response actions|•••/, 'reference and action controls stay out of captured reply content');
  const refreshedReportedCapture = await send({ type: 'capture', tabId: reportedTabId });
  assert.equal(refreshedReportedCapture.ok, true, refreshedReportedCapture.error);
  assert.equal(refreshedReportedCapture.conversation.messages.length, 4, 'refreshing capture does not duplicate inferred prompts');
  assert.equal(refreshedReportedCapture.conversation.messages.filter(message => message.role === 'Message').some(message => /Compare the community interview|What should the pilot test first/.test(message.markdown)), false);
  const reportedFirstReply = reportedLayout.locator('#thread p').first();
  const reportedSecondReply = reportedLayout.locator('#thread p').nth(1);
  const reportedCodePanelHandle = await reportedLayout.locator('#reported-sibling-code').elementHandle();
  assert.ok(reportedCodePanelHandle);
  const composerTextBeforeReportedCollapse = await reportedLayout.locator('.composer [contenteditable="true"]').textContent();
  await mkdir('artifacts', { recursive: true });
  await reportedLayout.screenshot({ path: 'artifacts/reported-layout-before-collapse.png', fullPage: true });
  const firstReplyBounds = await reportedFirstReply.boundingBox();
  assert.ok(firstReplyBounds);
  const reportedHeightBeforeCollapse = await reportedLayout.locator('#thread').evaluate(node => node.scrollHeight);
  await reportedLayout.mouse.click(250, firstReplyBounds.y + firstReplyBounds.height / 2);
  await reportedLayout.waitForFunction(() => document.querySelectorAll('.idea-capture-section-collapsed').length >= 2);
  await reportedLayout.screenshot({ path: 'artifacts/reported-layout-code-panel-after-collapse.png', fullPage: true });
  const reportedHeightAfterFirstCollapse = await reportedLayout.locator('#thread').evaluate(node => node.scrollHeight);
  assert.equal(await reportedLayout.locator('.bg-user-message').first().isVisible(), false, 'a left margin collapse hides the prompt');
  assert.equal(await reportedLayout.locator('#reported-gallery img').isVisible(), false, 'the same left margin collapse hides reply media');
  assert.equal(await reportedLayout.locator('.reply-shell').first().isVisible(), false, 'collapse removes the complete nested response shell');
  assert.equal(await reportedLayout.locator('.gallery-shell').first().isVisible(), false, 'collapse removes the padded gallery shell');
  assert.equal(await reportedLayout.locator('.gallery-card').first().isVisible(), false, 'collapse removes the otherwise empty image card shells');
  assert.equal(await reportedLayout.locator('.reference-chip').first().isVisible(), false, 'collapse removes citation chips with the reply');
  assert.equal(await reportedLayout.locator('.action-row').first().isVisible(), false, 'collapse removes the reply action row');
  assert.equal(await reportedLayout.locator('#reported-orphan-gallery').isVisible(), false, 'collapse removes an empty gallery shell beside the reply node');
  assert.equal(await reportedLayout.locator('#reported-sibling-code').isVisible(), false, 'collapse hides a code block in a sibling wrapper beside the reply node');
  assert.equal(await reportedLayout.locator('#reported-sibling-code textarea').isVisible(), false, 'collapse hides the editor surface inside the code panel');
  assert.deepEqual(await reportedLayout.locator('#reported-sibling-code button').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).display !== 'none' && node.getBoundingClientRect().height > 0)), [false, false], 'collapse hides both code panel header actions with its shell');
  assert.equal(await reportedLayout.locator('#reported-orphan-references').isVisible(), false, 'collapse removes reference chips beside the reply node');
  assert.equal(await reportedLayout.locator('#reported-orphan-actions').isVisible(), false, 'collapse removes action controls beside the reply node');
  assert.equal(await reportedLayout.locator('.bg-user-message').nth(1).isVisible(), true, 'the adjacent prompt remains visible');
  assert.equal(await reportedSecondReply.isVisible(), true, 'the adjacent reply remains visible');
  assert.equal(await reportedLayout.locator('#reported-sibling-code').isVisible(), false, 'the sibling code block stays hidden while its section is collapsed');
  const codePanelGeometryWhileCollapsed = await reportedLayout.locator('#reported-sibling-code').evaluate(node => ({ display: getComputedStyle(node).display, height: node.getBoundingClientRect().height }));
  assert.equal(codePanelGeometryWhileCollapsed.display, 'none', `the complete code panel is removed from layout: ${JSON.stringify(codePanelGeometryWhileCollapsed)}`);
  assert.ok(reportedHeightBeforeCollapse - reportedHeightAfterFirstCollapse > 180, `collapse removes reply spacing and gallery height (${reportedHeightBeforeCollapse} -> ${reportedHeightAfterFirstCollapse})`);
  const secondReplyBounds = await reportedSecondReply.boundingBox();
  assert.ok(secondReplyBounds);
  await reportedLayout.mouse.click(1380, secondReplyBounds.y + secondReplyBounds.height / 2);
  await reportedLayout.waitForFunction(() => document.querySelectorAll('.idea-capture-section-collapsed').length >= 4);
  assert.equal(await reportedLayout.locator('.bg-user-message').nth(1).isVisible(), false, 'a right margin collapse hides the second prompt');
  assert.equal(await reportedLayout.locator('#thread p').nth(1).isVisible(), false, 'the second reply collapses with its prompt');
  const collapsedReportedExport = await send({ type: 'capture', tabId: reportedTabId, mode: 'export' });
  assert.equal(collapsedReportedExport.ok, true, collapsedReportedExport.error);
  assert.equal(collapsedReportedExport.conversation.messages.length, 4, 'collapsed prompts and replies remain exportable');
  assert.match(collapsedReportedExport.conversation.messages[1].markdown, /local context/);
  assert.match(collapsedReportedExport.conversation.messages[1].markdown, /preserve this standalone code panel/, 'collapsing the page does not remove adjacent panel code from exported conversation text');
  assert.match(collapsedReportedExport.conversation.messages[3].markdown, /three participants/);
  assert.equal(collapsedReportedExport.conversation.media.length, 1, 'collapsed reply media remains exportable');
  const reportedHeaders = reportedLayout.locator('.idea-capture-section-header');
  await reportedHeaders.nth(0).locator('button[data-idea-section-id]').click();
  assert.equal(await reportedLayout.locator('.reply-shell').first().isVisible(), true, 'expanding restores the complete nested reply shell');
  assert.equal(await reportedLayout.locator('.gallery-shell').first().isVisible(), true, 'expanding restores gallery padding and card spacing');
  assert.equal(await reportedLayout.locator('.gallery-card').first().isVisible(), true, 'expanding restores image cards');
  assert.equal(await reportedLayout.locator('.reference-chip').first().isVisible(), true, 'expanding restores reference chips');
  assert.equal(await reportedLayout.locator('.action-row').first().isVisible(), true, 'expanding restores the action row');
  assert.equal(await reportedLayout.locator('#reported-orphan-gallery').isVisible(), true, 'expanding restores the sibling empty gallery shell');
  assert.equal(await reportedLayout.locator('#reported-sibling-code').isVisible(), true, 'expanding restores the sibling code block');
  const expandedCodePanelGeometry = await reportedLayout.locator('#reported-sibling-code').evaluate(node => ({ height: node.getBoundingClientRect().height, parent: node.parentElement?.id, next: node.nextElementSibling?.id }));
  assert.ok(expandedCodePanelGeometry.height > 0, `expanding restores the code panel geometry: ${JSON.stringify(expandedCodePanelGeometry)}`);
  assert.equal(expandedCodePanelGeometry.parent, 'thread');
  assert.equal(expandedCodePanelGeometry.next, 'reported-orphan-references', 'the code panel keeps its DOM order beside the neighboring controls');
  assert.equal(await reportedLayout.locator('#reported-sibling-code').evaluate((node, original) => node === original, reportedCodePanelHandle), true, 'expanding restores the same code panel node');
  assert.equal(await reportedLayout.locator('#reported-orphan-references').isVisible(), true, 'expanding restores sibling reference chips');
  assert.equal(await reportedLayout.locator('#reported-orphan-actions').isVisible(), true, 'expanding restores sibling action controls');
  await reportedHeaders.nth(1).locator('button[data-idea-section-id]').click();
  assert.equal(await reportedLayout.locator('.idea-capture-section-collapsed').count(), 0, 'the second section can also be restored after export');
  // Simulate a delayed code renderer inserting a panel after the section is
  // collapsed. It should inherit the section's hidden state without shifting
  // the following prompt or response.
  await reportedHeaders.nth(0).locator('button[data-idea-section-id]').click();
  await reportedLayout.waitForFunction(() => document.querySelector('#reported-sibling-code')?.getBoundingClientRect().height === 0);
  await reportedLayout.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const latePrompt = reportedLayout.locator('.bg-user-message').nth(1);
  const latePromptHandle = await latePrompt.elementHandle();
  const latePromptText = await latePrompt.textContent();
  const latePromptBefore = await latePrompt.boundingBox();
  await reportedLayout.locator('#reported-sibling-code').evaluate(node => {
    const late = document.createElement('section'); late.id = 'reported-late-code';
    late.innerHTML = '<div class="code-panel-toolbar"><span>Python</span><button type="button">Copy</button></div><pre role="textbox" aria-readonly="true"><code>late_value = "rendered after collapse"</code></pre><textarea readonly aria-label="Late code editor">late editor value</textarea>';
    node.after(late);
  });
  await reportedLayout.waitForFunction(() => document.querySelector('#reported-late-code')?.getBoundingClientRect().height === 0);
  await reportedLayout.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await reportedLayout.locator('#reported-late-code').isVisible(), false, 'a late-added code panel stays hidden while its section is collapsed');
  assert.equal(await latePrompt.isVisible(), true, 'late code insertion does not hide the adjacent prompt');
  assert.equal(await latePrompt.textContent(), latePromptText, 'late code insertion preserves adjacent prompt content');
  assert.equal(await latePrompt.evaluate((node, original) => node === original, latePromptHandle), true, 'late code insertion preserves the adjacent prompt node');
  const latePromptAfter = await latePrompt.boundingBox();
  assert.ok(latePromptBefore && latePromptAfter && Math.abs(latePromptBefore.x - latePromptAfter.x) < 1 && Math.abs(latePromptBefore.y - latePromptAfter.y) < 1, `late code added while collapsed does not shift its neighboring prompt: ${JSON.stringify({ before: latePromptBefore, after: latePromptAfter })}`);
  await reportedHeaders.nth(0).locator('button[data-idea-section-id]').click();
  assert.equal(await reportedLayout.locator('#reported-late-code').isVisible(), true, 'expanding restores code added after collapse');
  assert.equal(await reportedLayout.locator('.composer [contenteditable="true"]').textContent(), composerTextBeforeReportedCollapse, 'neighboring composer content remains intact throughout code-panel collapse');
  assert.ok(await reportedLayout.locator('#thread').evaluate(node => node.scrollHeight) > reportedHeightAfterFirstCollapse + 180, 'expanding restores the removed vertical space');
  await reportedLayout.locator('#idea-capture-panel [data-action="toggle-panel"]').click();
  const reportedChecks = reportedLayout.locator('#idea-capture-panel input[data-section-id]');
  assert.equal(await reportedChecks.count(), 2);
  await reportedChecks.first().uncheck();
  const selectedReportedExport = await send({ type: 'capture', tabId: reportedTabId, mode: 'export' });
  assert.equal(selectedReportedExport.ok, true, selectedReportedExport.error);
  assert.equal(selectedReportedExport.conversation.messages.length, 2);
  assert.equal(selectedReportedExport.conversation.messages.some(message => message.markdown.includes('community interview')), false);
  assert.equal(selectedReportedExport.conversation.media.length, 0, 'excluding the section also excludes its reply image');
  assert.equal(await reportedLayout.locator('nav a').count(), 2, 'navigation remains outside captured messages');
  assert.equal(await reportedLayout.locator('.composer [contenteditable="true"]').textContent(), 'Ask anything', 'the composer remains outside captured messages');
  await reportedLayout.screenshot({ path: 'artifacts/reported-layout-sections.png', fullPage: true });
  const borderAnchor = await context.newPage();
  await borderAnchor.setViewportSize({ width: 1440, height: 900 });
  await borderAnchor.goto('https://chatgpt.com/g/p-demo/c/input-border-anchor');
  await borderAnchor.locator('.idea-capture-section-header').first().waitFor();
  await borderAnchor.waitForFunction(() => document.querySelector('[data-idea-capture-owned="host"]')?.shadowRoot?.querySelector('#idea-capture-panel'));
  await borderAnchor.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const borderAnchorSample = () => borderAnchor.evaluate(() => {
    const surface = document.querySelector('[data-visible-input-border]');
    const panel = document.querySelector('[data-idea-capture-owned="host"]').shadowRoot.querySelector('#idea-capture-panel');
    const sr = surface.getBoundingClientRect(), pr = panel.getBoundingClientRect();
    return { surface: { left: sr.left, right: sr.right, top: sr.top, bottom: sr.bottom, width: sr.width, height: sr.height }, panel: { left: pr.left, right: pr.right, top: pr.top, bottom: pr.bottom }, gap: sr.top - pr.bottom, scroll: { overflow: getComputedStyle(document.querySelector('#thread')).overflowY, top: document.querySelector('#thread').scrollTop } };
  });
  const borderAnchorEvidence = await borderAnchorSample();
  await borderAnchor.screenshot({ path: 'artifacts/input-border-anchor.png' });
  console.log(`Visible input border anchor repro: ${JSON.stringify(borderAnchorEvidence)}`);
  await writeFile('artifacts/input-border-anchor.json', JSON.stringify(borderAnchorEvidence, null, 2));
  assert.ok(Math.abs(borderAnchorEvidence.gap + 1) <= 1, `closed widget tab overlaps the visible rounded input surface top border by 1px: ${JSON.stringify(borderAnchorEvidence)}`);
  const headerHitTest = await borderAnchor.evaluate(() => {
    const editor = document.querySelector('.composer [contenteditable="true"]');
    const header = document.querySelector('.idea-capture-section-header');
    const r = editor.getBoundingClientRect();
    Object.assign(header.style, { position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const hit = () => document.elementFromPoint(x, y);
    header.style.setProperty('z-index', '10', 'important');
    const oldHeaderWouldWin = !!hit()?.closest('.idea-capture-section-header');
    header.style.removeProperty('z-index');
    return { oldHeaderWouldWin, target: hit()?.getAttribute('contenteditable'), headerZ: getComputedStyle(header).zIndex, composerZ: getComputedStyle(document.querySelector('.composer')).zIndex };
  });
  assert.equal(headerHitTest.oldHeaderWouldWin, true, `the former section-header stacking level takes native composer hit targets: ${JSON.stringify(headerHitTest)}`);
  assert.equal(headerHitTest.headerZ, 'auto', `section headers use normal page stacking after removal of their explicit level: ${JSON.stringify(headerHitTest)}`);
  assert.equal(headerHitTest.target, 'true', `the composer wins hit testing once the section header sits below its z-index: ${JSON.stringify(headerHitTest)}`);
  await borderAnchor.evaluate(() => document.querySelector('.idea-capture-section-header').removeAttribute('style'));
  const borderNative = await borderAnchor.evaluate(() => ({ rect: window.__nativeComposerRect, scroll: window.__nativeScrollStyle, current: (() => { const r = document.querySelector('.composer').getBoundingClientRect(); return { x:r.x,y:r.y,width:r.width,height:r.height,top:r.top,bottom:r.bottom }; })() }));
  assert.deepEqual(borderNative.current, borderNative.rect, `injection preserves the native composer form geometry: ${JSON.stringify(borderNative)}`);
  const borderToggle = borderAnchor.locator('[data-idea-capture-owned="host"]').evaluateHandle(host => host.shadowRoot.querySelector('[data-action="toggle-panel"]'));
  const waitBorderFrame = () => borderAnchor.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await borderToggle.then(handle => handle.asElement().click());
  await waitBorderFrame();
  const openBorderPanel = await borderAnchorSample();
  await borderAnchor.setViewportSize({ width: 800, height: 360 });
  await borderAnchor.locator('.composer').evaluate(node => { node.style.height = '230px'; });
  await waitBorderFrame();
  const shortViewportOpenPanel = await borderAnchor.evaluate(() => {
    const panel = document.querySelector('[data-idea-capture-owned="host"]').shadowRoot.querySelector('#idea-capture-panel');
    const rect = panel.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, viewportHeight: innerHeight, maxHeight: getComputedStyle(panel).maxHeight, hidden: panel.hidden };
  });
  assert.equal(shortViewportOpenPanel.hidden, false, 'the capture panel stays open for a tall composer on a short viewport');
  assert.ok(shortViewportOpenPanel.top >= 0 && shortViewportOpenPanel.bottom <= shortViewportOpenPanel.viewportHeight, `the open dock remains entirely visible above a tall composer: ${JSON.stringify(shortViewportOpenPanel)}`);
  await borderAnchor.setViewportSize({ width: 1440, height: 900 });
  await borderAnchor.locator('.composer').evaluate(node => { node.style.removeProperty('height'); });
  await waitBorderFrame();
  await borderAnchor.locator('[data-idea-capture-owned="host"]').evaluate(host => host.shadowRoot.querySelector('[data-action="toggle-panel"]').click());
  await waitBorderFrame();
  const closedAgainBorder = await borderAnchorSample();
  assert.equal(closedAgainBorder.gap, borderAnchorEvidence.gap, `closing the panel restores the same input-border dock: ${JSON.stringify({ initial: borderAnchorEvidence, open: openBorderPanel, closed: closedAgainBorder })}`);
  const borderThread = borderAnchor.locator('#thread');
  const borderThreadBox = await borderThread.boundingBox();
  await borderAnchor.mouse.move(borderThreadBox.x + borderThreadBox.width / 2, borderThreadBox.y + borderThreadBox.height / 2);
  await borderAnchor.mouse.wheel(0, 680);
  await waitBorderFrame();
  const afterBorderWheel = await borderAnchor.evaluate(() => ({ top: document.querySelector('#thread').scrollTop, overflow: getComputedStyle(document.querySelector('#thread')).overflowY }));
  const afterWheelBorder = await borderAnchorSample();
  assert.ok(afterBorderWheel.top > 0 && afterBorderWheel.overflow === borderNative.scroll.overflow, `conversation keeps native wheel scrolling: ${JSON.stringify({ afterBorderWheel, native: borderNative.scroll })}`);
  assert.ok(Math.abs(afterWheelBorder.gap + 1) <= 1, `the tab follows the visible border through native scrolling: ${JSON.stringify(afterWheelBorder)}`);
  await borderAnchor.locator('.composer [contenteditable="true"]').evaluate(node => { node.style.height = '100px'; });
  await waitBorderFrame();
  const grownBorder = await borderAnchorSample();
  assert.ok(Math.abs(grownBorder.gap + 1) <= 1, `the tab follows input growth: ${JSON.stringify(grownBorder)}`);
  await borderAnchor.setViewportSize({ width: 390, height: 780 });
  await waitBorderFrame();
  const narrowBorder = await borderAnchorSample();
  assert.ok(Math.abs(narrowBorder.gap + 1) <= 1, `the tab follows the visible border at narrow width: ${JSON.stringify(narrowBorder)}`);
  await borderAnchor.evaluate(() => { const old = document.querySelector('.composer'); const replacement = old.cloneNode(true); old.replaceWith(replacement); });
  await waitBorderFrame();
  const replacedBorder = await borderAnchorSample();
  assert.ok(Math.abs(replacedBorder.gap + 1) <= 1, `SPA composer replacement keeps the tab on the visible border: ${JSON.stringify(replacedBorder)}`);
  await borderAnchor.locator('.composer').evaluate(node => { node.style.transform = 'translate(-50%,-18px)'; });
  await waitBorderFrame();
  const translatedBorder = await borderAnchorSample();
  assert.ok(Math.abs(translatedBorder.gap + 1) <= 1 && translatedBorder.surface.top < replacedBorder.surface.top - 10, `same-size ancestor transform moves the dock with the visible border: ${JSON.stringify({ before: replacedBorder, after: translatedBorder })}`);
  await borderAnchor.locator('.composer').evaluate(node => { node.style.transform = ''; });
  await borderAnchor.locator('.composer [contenteditable="true"]').evaluate(node => { node.setAttribute('contenteditable', 'false'); });
  await waitBorderFrame();
  const nonEditablePromptState = await borderAnchor.evaluate(() => {
    const surface = document.querySelector('[data-visible-input-border]').getBoundingClientRect();
    const panel = document.querySelector('[data-idea-capture-owned="host"]').shadowRoot.querySelector('#idea-capture-panel');
    return { hidden: panel.hidden, gap: surface.top - panel.getBoundingClientRect().bottom };
  });
  assert.equal(nonEditablePromptState.hidden, false, 'a temporarily non-editable but visible prompt keeps its dock tab');
  assert.ok(Math.abs(nonEditablePromptState.gap + 1) <= 1, `the visible non-editable prompt retains the border anchor: ${JSON.stringify(nonEditablePromptState)}`);
  await borderAnchor.locator('.composer [contenteditable="false"]').evaluate(node => { node.setAttribute('contenteditable', 'true'); });
  await borderAnchor.locator('.composer [contenteditable="true"]').evaluate(node => { node.hidden = true; });
  await borderAnchor.locator('.composer .disabled-prompt').evaluate(node => { node.hidden = false; });
  await waitBorderFrame();
  const disabledPromptState = await borderAnchor.evaluate(() => {
    const surface = document.querySelector('[data-visible-input-border]').getBoundingClientRect();
    const panel = document.querySelector('[data-idea-capture-owned="host"]').shadowRoot.querySelector('#idea-capture-panel');
    return { hidden: panel.hidden, gap: surface.top - panel.getBoundingClientRect().bottom };
  });
  assert.equal(disabledPromptState.hidden, false, 'a temporarily disabled but visible prompt keeps the dock available');
  assert.ok(Math.abs(disabledPromptState.gap + 1) <= 1, `the visible disabled prompt retains the border anchor: ${JSON.stringify(disabledPromptState)}`);
  await borderAnchor.locator('.composer .disabled-prompt').evaluate(node => { node.hidden = true; });
  await borderAnchor.locator('.composer [contenteditable="true"]').evaluate(node => { node.hidden = false; });
  await waitBorderFrame();
  await borderAnchor.locator('.composer').evaluate(node => { node.style.visibility = 'hidden'; });
  await waitBorderFrame();
  const hiddenComposerPanel = await borderAnchor.locator('[data-idea-capture-owned="host"]').evaluate(host => host.shadowRoot.querySelector('#idea-capture-panel').hidden);
  assert.equal(hiddenComposerPanel, true, 'an invisible composer ancestor hides the closed tab');
  await borderAnchor.locator('.composer').evaluate(node => { node.style.visibility = ''; });
  await waitBorderFrame();
  const restoredBorder = await borderAnchorSample();
  assert.ok(Math.abs(restoredBorder.gap + 1) <= 1, `restoring the visible composer restores the border anchor: ${JSON.stringify(restoredBorder)}`);
  await borderAnchor.locator('.composer').evaluate(node => { node.style.height = '0px'; node.style.overflow = 'hidden'; });
  await waitBorderFrame();
  const clippedSurfacePanel = await borderAnchor.locator('[data-idea-capture-owned="host"]').evaluate(host => host.shadowRoot.querySelector('#idea-capture-panel').hidden);
  assert.equal(clippedSurfacePanel, true, 'a composer border clipped by its overflow ancestor does not leave a false tab');
  await borderAnchor.locator('.composer').evaluate(node => { node.style.removeProperty('height'); node.style.removeProperty('overflow'); });
  await waitBorderFrame();
  const unclippedBorder = await borderAnchorSample();
  assert.ok(Math.abs(unclippedBorder.gap + 1) <= 1, `removing the overflow clip restores the border anchor: ${JSON.stringify(unclippedBorder)}`);
  const idleMutationCount = await borderAnchor.evaluate(() => new Promise(resolve => {
    let count = 0;
    const observer = new MutationObserver(records => { count += records.length; });
    observer.observe(document.querySelector('.composer'), { attributes: true, childList: true, subtree: true });
    setTimeout(() => { observer.disconnect(); resolve(count); }, 300);
  }));
  assert.equal(idleMutationCount, 0, 'the composer stays mutation-free after dock geometry settles');
  await borderAnchor.screenshot({ path: 'artifacts/input-border-anchor-fixed.png' });
  await writeFile('artifacts/input-border-anchor-fixed.json', JSON.stringify({ initial: borderAnchorEvidence, open: openBorderPanel, closed: closedAgainBorder, afterWheel: afterWheelBorder, grown: grownBorder, narrow: narrowBorder, replaced: replacedBorder, translated: translatedBorder, restored: restoredBorder, nonEditablePrompt: nonEditablePromptState, disabledPrompt: disabledPromptState, hiddenComposerPanel, clippedSurfacePanel, idleMutationCount, unclipped: unclippedBorder }, null, 2));
  await saveAllowedUrls(`https://chatgpt.com/*\nhttps://claude.ai/*\n${appUrl}/*`);
  const claudeComposer = await context.newPage();
  await claudeComposer.setViewportSize({ width: 1440, height: 900 });
  await claudeComposer.goto('https://claude.ai/chat/composer-anchor');
  await claudeComposer.locator('.idea-capture-section-header').first().waitFor();
  const claudeDock = await claudeComposer.evaluate(() => {
    const outer = document.querySelector('.composer'), input = outer.querySelector('[contenteditable="true"]');
    const panel = document.querySelector('[data-idea-capture-owned="host"]').shadowRoot.querySelector('#idea-capture-panel');
    const or = outer.getBoundingClientRect(), ir = input.getBoundingClientRect(), pr = panel.getBoundingClientRect();
    return { outerTop: or.top, inputTop: ir.top, panelBottom: pr.bottom, legacyInputGap: ir.top - pr.bottom };
  });
  assert.ok(Math.abs(claudeDock.legacyInputGap + 1) <= 1, `Claude keeps its existing editor-border dock position: ${JSON.stringify(claudeDock)}`);
  await claudeComposer.screenshot({ path: 'artifacts/claude-composer-anchor.png' });
  await saveAllowedUrls(`https://chatgpt.com/*\n${appUrl}/*`);
  await actualLayout.locator('.composer').evaluate(node => {
    node.style.position = 'fixed'; node.style.left = '220px'; node.style.right = '0'; node.style.bottom = '0'; node.style.zIndex = '1';
  });
  await actualLayout.evaluate(() => window.dispatchEvent(new Event('resize')));
  await actualLayout.waitForTimeout(150);
  const baselineBottomBounds = await actualLayout.evaluate(() => {
    const thread = document.querySelector('#thread');
    const marker = document.querySelector('#bottom-content-marker');
    const originalStyle = thread.getAttribute('style');
    const hadClearance = thread.hasAttribute('data-idea-capture-scroll-clearance');
    thread.removeAttribute('data-idea-capture-scroll-clearance');
    thread.style.removeProperty('--idea-capture-original-padding-bottom');
    thread.style.removeProperty('--idea-capture-composer-clearance');
    thread.scrollTop = thread.scrollHeight;
    const baseline = { markerBottom: marker.getBoundingClientRect().bottom, composerTop: document.querySelector('.composer').getBoundingClientRect().top };
    if (originalStyle === null) thread.removeAttribute('style'); else thread.setAttribute('style', originalStyle);
    if (hadClearance) thread.setAttribute('data-idea-capture-scroll-clearance', '');
    return baseline;
  });
  assert.ok(baselineBottomBounds.markerBottom > baselineBottomBounds.composerTop + 20, `without composer clearance, the final answer is hidden under the overlay: ${JSON.stringify(baselineBottomBounds)}`);
  await actualThread.evaluate(node => { node.scrollTop = node.scrollHeight; });
  const bottomContentBounds = await actualLayout.evaluate(() => {
    const thread = document.querySelector('#thread');
    const marker = document.querySelector('#bottom-content-marker').getBoundingClientRect();
    const composer = document.querySelector('.composer').getBoundingClientRect();
    const threadRect = thread.getBoundingClientRect();
    return { markerTop: marker.top, markerBottom: marker.bottom, threadBottom: threadRect.bottom, composerTop: composer.top, scrollTop: thread.scrollTop, maxScroll: thread.scrollHeight - thread.clientHeight };
  });
  assert.ok(bottomContentBounds.scrollTop >= bottomContentBounds.maxScroll - 1, `the conversation reaches its true bottom: ${JSON.stringify(bottomContentBounds)}`);
  assert.ok(bottomContentBounds.threadBottom > bottomContentBounds.composerTop + 40, `the composer overlays the scroll root in this fixture: ${JSON.stringify(bottomContentBounds)}`);
  assert.ok(bottomContentBounds.markerBottom <= bottomContentBounds.composerTop + 1, `the final answer stays visible above the overlapping composer: ${JSON.stringify(bottomContentBounds)}`);
  const dockAfterWheel = async () => actualLayout.evaluate(() => {
    const thread = document.querySelector('#thread');
    const composer = document.querySelector('.composer');
    const input = composer.querySelector('[contenteditable="true"]');
    const panel = document.querySelector('[data-idea-capture-owned="host"]').shadowRoot.querySelector('#idea-capture-panel');
    const cr = composer.getBoundingClientRect(), ir = input.getBoundingClientRect(), pr = panel.getBoundingClientRect();
    return { composer: { top: cr.top, bottom: cr.bottom, height: cr.height }, input: { top: ir.top, bottom: ir.bottom }, panel: { top: pr.top, bottom: pr.bottom }, inputPanelOffset: ir.top - pr.bottom, thread: { scrollTop: thread.scrollTop, maxScroll: thread.scrollHeight - thread.clientHeight }, pageScrollY: window.scrollY, clearance: getComputedStyle(thread).getPropertyValue('--idea-capture-composer-clearance'), markerBottom: document.querySelector('#bottom-content-marker').getBoundingClientRect().bottom };
  });
  const wheelBaseline = await dockAfterWheel();
  const threadBox = await actualThread.boundingBox();
  await actualLayout.mouse.move(threadBox.x + threadBox.width * 0.7, threadBox.y + threadBox.height - 120);
  const wheelSamples = [];
  for (let i = 0; i < 6; i++) {
    await actualLayout.mouse.wheel(0, 720);
    await actualLayout.waitForTimeout(40);
    wheelSamples.push(await dockAfterWheel());
  }
  const wheelAfter = await dockAfterWheel();
  const wheelEvidence = { nativeComposerGeometry, before: wheelBaseline, samples: wheelSamples, after: wheelAfter };
  console.log('Fixed-composer wheel fixture passed (six real bottom-wheel samples).');
  await writeFile('artifacts/dock-wheel-repro.json', JSON.stringify(wheelEvidence, null, 2));
  assert.ok(wheelAfter.thread.scrollTop >= wheelAfter.thread.maxScroll - 1, `real wheel input keeps #thread at its true bottom: ${JSON.stringify(wheelAfter)}`);
  assert.ok(Math.abs(wheelAfter.inputPanelOffset - wheelBaseline.inputPanelOffset) <= 1, `the capture widget stays at a stable offset from the composer input after bottom wheel events: ${JSON.stringify({ before: wheelBaseline, after: wheelAfter })}`);
  assert.deepEqual(wheelAfter.composer, wheelBaseline.composer, `wheel events do not move the fixed composer: ${JSON.stringify({ before: wheelBaseline, after: wheelAfter })}`);
  assert.ok(wheelAfter.markerBottom <= wheelAfter.composer.top + 1, `the final answer remains visible after repeated wheel events at the bottom: ${JSON.stringify(wheelAfter)}`);
  await actualLayout.locator('.composer').evaluate(node => { node.style.height = '136px'; });
  await actualLayout.waitForTimeout(150);
  await actualThread.evaluate(node => { node.scrollTop = node.scrollHeight; });
  const grownComposerBounds = await actualLayout.evaluate(() => ({ markerBottom: document.querySelector('#bottom-content-marker').getBoundingClientRect().bottom, composerTop: document.querySelector('.composer').getBoundingClientRect().top, scrollTop: document.querySelector('#thread').scrollTop, maxScroll: document.querySelector('#thread').scrollHeight - document.querySelector('#thread').clientHeight }));
  assert.ok(grownComposerBounds.scrollTop >= grownComposerBounds.maxScroll - 1, `the scroll root reaches its bottom after composer growth: ${JSON.stringify(grownComposerBounds)}`);
  assert.ok(grownComposerBounds.markerBottom <= grownComposerBounds.composerTop + 1, `the final answer remains visible when the composer grows: ${JSON.stringify(grownComposerBounds)}`);
  await actualLayout.screenshot({ path: 'artifacts/provider-layout-composer-bottom.png', fullPage: false });
  const stickyRepro = await context.newPage();
  await stickyRepro.setViewportSize({ width: 1440, height: 900 });
  await stickyRepro.goto('https://chatgpt.com/g/p-demo/c/sticky-composer-wheel');
  await stickyRepro.locator('.idea-capture-section-header').first().waitFor();
  await stickyRepro.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const stickyNativeGeometry = await stickyRepro.evaluate(() => {
    const before = window.__nativeComposerGeometry;
    const r = document.querySelector('.composer').getBoundingClientRect();
    return { before, afterInjection: { x: r.x, y: r.y, width: r.width, height: r.height, top: r.top, bottom: r.bottom, paddingBottom: getComputedStyle(document.querySelector('#thread')).paddingBottom } };
  });
  const nativeComposerRect = ({ x, y, width, height, top, bottom }) => ({ x, y, width, height, top, bottom });
  assert.deepEqual(nativeComposerRect(stickyNativeGeometry.afterInjection), nativeComposerRect(stickyNativeGeometry.before), `injection preserves native sticky composer geometry: ${JSON.stringify(stickyNativeGeometry)}`);
  const stickyThread = stickyRepro.locator('#thread');
  const stickyBox = await stickyThread.boundingBox();
  const stickySample = () => stickyRepro.evaluate(() => {
    const thread = document.querySelector('#thread'), composer = document.querySelector('.composer');
    const input = composer.querySelector('[contenteditable="true"]');
    const panel = document.querySelector('[data-idea-capture-owned="host"]').shadowRoot.querySelector('#idea-capture-panel');
    const cr = composer.getBoundingClientRect(), ir = input.getBoundingClientRect(), pr = panel.getBoundingClientRect();
    const threadRect = thread.getBoundingClientRect();
    return { composerTop: cr.top, composerBottom: cr.bottom, composerHeight: cr.height, expectedStickyBottom: threadRect.bottom, inputTop: ir.top, panelTop: pr.top, panelBottom: pr.bottom, dockGap: cr.top - pr.bottom, inputPanelOffset: ir.top - pr.bottom, scrollTop: thread.scrollTop, maxScroll: thread.scrollHeight - thread.clientHeight, pageScrollY: window.scrollY, clearance: getComputedStyle(thread).getPropertyValue('--idea-capture-composer-clearance'), paddingBottom: getComputedStyle(thread).paddingBottom, markerBottom: document.querySelector('#sticky-bottom-marker').getBoundingClientRect().bottom };
  });
  const messageWheelY = stickyBox.y + stickyBox.height * 0.58;
  await stickyRepro.mouse.move(stickyBox.x + stickyBox.width * 0.7, messageWheelY);
  for (let i = 0; i < 40; i++) {
    const current = await stickySample();
    if (current.scrollTop >= current.maxScroll - 1) break;
    await stickyRepro.mouse.wheel(0, 720);
    await stickyRepro.waitForTimeout(40);
  }
  const stickyBeforeWheels = await stickySample();
  await stickyRepro.screenshot({ path: 'artifacts/sticky-composer-wheel-at-bottom-before.png' });
  const wheelAt = async y => {
    await stickyRepro.mouse.move(stickyBox.x + stickyBox.width * 0.7, y);
    const samples = [];
    for (let i = 0; i < 6; i++) {
      await stickyRepro.mouse.wheel(0, 720);
      await stickyRepro.waitForTimeout(40);
      samples.push(await stickySample());
    }
    return samples;
  };
  const messageAreaSamples = await wheelAt(messageWheelY);
  const nearComposerSamples = await wheelAt(stickyBeforeWheels.composerTop - 20);
  await stickyRepro.screenshot({ path: 'artifacts/sticky-composer-wheel-at-bottom-after.png' });
  const allStickyWheelSamples = [...messageAreaSamples, ...nearComposerSamples];
  const stickyWheelEvidence = { nativeComposerGeometry: stickyNativeGeometry, beforeRepeatedWheels: stickyBeforeWheels, messageAreaSamples, nearComposerSamples };
  console.log(`Sticky-composer wheel fixture: ${JSON.stringify({ nativeBottom: stickyNativeGeometry.before.nativeBottom, atBottom: stickyBeforeWheels, messageAreaSamples: messageAreaSamples.length, nearComposerSamples: nearComposerSamples.length })}`);
  await writeFile('artifacts/sticky-composer-wheel-repro.json', JSON.stringify(stickyWheelEvidence, null, 2));
  assert.equal(stickyNativeGeometry.afterInjection.paddingBottom, stickyNativeGeometry.before.paddingBottom, `injection leaves sticky scroller padding unchanged: ${JSON.stringify(stickyNativeGeometry)}`);
  assert.ok(stickyBeforeWheels.scrollTop >= stickyBeforeWheels.maxScroll - 1, `wheel input reaches the true bottom of the sticky-composer scroller: ${JSON.stringify(stickyBeforeWheels)}`);
  for (const sample of allStickyWheelSamples) {
    assert.ok(Math.abs(sample.inputPanelOffset + 1) <= 1, `the widget tab stays fused to the visible sticky composer input border through bottom wheel events: ${JSON.stringify({ before: stickyBeforeWheels, sample })}`);
    assert.ok(Math.abs(sample.composerBottom - sample.expectedStickyBottom) <= 1, `the sticky composer stays at the scrollport bottom: ${JSON.stringify({ before: stickyBeforeWheels, sample })}`);
    assert.equal(sample.paddingBottom, stickyNativeGeometry.before.paddingBottom, `the extension preserves sticky scroller padding: ${JSON.stringify({ native: stickyNativeGeometry, sample })}`);
    assert.ok(sample.markerBottom <= sample.composerTop + 1, `the final answer remains visible above the sticky composer: ${JSON.stringify(sample)}`);
  }
  const reportedSingleLayout = await context.newPage();
  await reportedSingleLayout.goto('https://chatgpt.com/g/g-p-demo/c/reported-single-layout');
  await reportedSingleLayout.locator('.idea-capture-section-header').first().waitFor();
  const reportedSingleTabId = await worker.evaluate(async () => (await chrome.tabs.query({ url: 'https://chatgpt.com/g/g-p-demo/c/reported-single-layout' }))[0].id);
  const reportedSingleCapture = await send({ type: 'capture', tabId: reportedSingleTabId });
  assert.equal(reportedSingleCapture.ok, true, reportedSingleCapture.error);
  assert.deepEqual(reportedSingleCapture.conversation.messages.map(message => message.role), ['User', 'Message'], 'a lone reported bubble still infers its adjacent reply');
  assert.match(reportedSingleCapture.conversation.messages[1].markdown, /shorter onboarding flow/);
  const roleWrapperPage = await context.newPage();
  await roleWrapperPage.setViewportSize({ width: 1440, height: 900 });
  await roleWrapperPage.goto('https://chatgpt.com/g/g-p-demo/c/role-wrapper-layout');
  const roleHeaders = roleWrapperPage.locator('.idea-capture-section-header');
  await roleHeaders.first().waitFor();
  assert.equal(await roleHeaders.count(), 2, 'full-width role wrappers create two prompt sections');
  const galleryCardBounds = await roleWrapperPage.locator('#gallery .gallery-card').last().boundingBox();
  assert.ok(galleryCardBounds && galleryCardBounds.x > 1100, 'the assistant gallery extends into the right blank gutter');
  await roleWrapperPage.mouse.click(galleryCardBounds.x + galleryCardBounds.width / 2, galleryCardBounds.y + galleryCardBounds.height / 2);
  assert.equal(await roleWrapperPage.locator('.idea-capture-section-collapsed').count(), 0, 'clicking a gallery sibling does not trigger gutter collapse');
  const promptBounds = await roleWrapperPage.locator('.prompt').first().boundingBox();
  assert.ok(promptBounds && promptBounds.x > 300, 'the role wrapper spans the page while its prompt prose stays centered');
  const roleLeftX = 54;
  const rolePromptY = promptBounds.y + promptBounds.height / 2;
  assert.ok(roleLeftX < promptBounds.x, 'the click target is the blank gutter inside the full-width role wrapper');
  await roleWrapperPage.mouse.click(roleLeftX, rolePromptY);
  assert.ok(await roleHeaders.nth(0).evaluate(node => node.nextElementSibling?.classList.contains('idea-capture-section-collapsed')), 'a gutter click on a full-width role wrapper collapses its matching section');
  assert.equal(await roleWrapperPage.locator('.prompt').nth(1).isVisible(), true, 'the adjacent role-wrapper section remains visible');
  const roleRestoreY = await roleHeaders.nth(0).evaluate(node => { const rect = node.getBoundingClientRect(); return rect.top + rect.height / 2; });
  await roleWrapperPage.mouse.click(1380, roleRestoreY);
  assert.equal(await roleWrapperPage.locator('.idea-capture-section-collapsed').count(), 0, 'the opposite gutter restores the collapsed role-wrapper section');
  await roleWrapperPage.screenshot({ path: 'artifacts/fullwidth-role-wrapper.png', fullPage: true });
  await project.waitForFunction(() => {
    const shadow = document.querySelector('[data-idea-capture-owned="host"]')?.shadowRoot;
    const button = shadow?.querySelector('[data-action="toggle-panel"]');
    return button?.getAttribute('aria-expanded') === 'false' && shadow?.querySelector('#idea-capture-margin-controls:not([hidden])');
  }, null, { timeout: 5000 }).catch(async error => {
    const state = await project.evaluate(() => {
      const shadow = document.querySelector('[data-idea-capture-owned="host"]')?.shadowRoot;
      const rail = shadow?.querySelector('#idea-capture-margin-controls');
      const root = document.querySelector('main');
      return { expanded: shadow?.querySelector('[data-action="toggle-panel"]')?.getAttribute('aria-expanded'), railHidden: rail?.hidden, railRect: rail?.getBoundingClientRect().toJSON(), mainRect: root?.getBoundingClientRect().toJSON(), headers: document.querySelectorAll('.idea-capture-section-header').length };
    });
    throw new Error(`Project rail did not appear: ${JSON.stringify(state)} (${error.message})`);
  });
  await mkdir('artifacts', { recursive: true });
  await project.setViewportSize({ width: 1280, height: 900 });
  await project.screenshot({ path: 'artifacts/chatgpt-project-collapsed-launcher.png' });
  const projectRailAction = await project.evaluate(() => document.querySelector('[data-idea-capture-owned="host"]')?.shadowRoot?.querySelector('#idea-capture-margin-controls button[data-idea-section-id]'));
  assert.ok(projectRailAction, 'side rail remains available while the section launcher is closed');
  await project.evaluate(() => document.querySelector('[data-idea-capture-owned="host"]')?.shadowRoot?.querySelector('#idea-capture-margin-controls button[data-idea-section-id]')?.click());
  const collapsedProjectCapture = await send({ type: 'capture', tabId: projectTabId, mode: 'export' });
  assert.equal(collapsedProjectCapture.ok, true, collapsedProjectCapture.error);
  assert.equal(collapsedProjectCapture.conversation.messages.length, 4, 'collapsed role-free article content remains exportable');
  assert.match(collapsedProjectCapture.conversation.messages[1].markdown, /surveys give breadth/);
  assert.equal(await project.evaluate(() => document.querySelector('[data-idea-capture-owned="host"]')?.shadowRoot?.querySelector('#idea-capture-margin-controls')?.hidden), true, 'the compact side action hides while its active section is collapsed');
  assert.match(await project.locator('.idea-capture-section-header').first().locator('button[data-idea-section-id]').getAttribute('aria-label'), /Expand section:/, 'the inline header provides the restore action');

  const mediaMarkdown = await send({ type: 'export', destination: 'kb', format: 'md', conversation: projectCapture.conversation });
  assert.equal(mediaMarkdown.ok, true, mediaMarkdown.error);
  const mediaUpload = uploads.at(-1).toString('latin1');
  const uploadedNames = [...mediaUpload.matchAll(/name="files\[\]"; filename="([^\"]+)"/g)].map(match => match[1]);
  assert.equal(uploadedNames.length, 4, 'KB receives the Markdown file plus three media companions');
  const markdownName = uploadedNames.find(name => name.endsWith('.md'));
  const pngName = uploadedNames.find(name => name.endsWith('.png'));
  const webpName = uploadedNames.find(name => name.endsWith('.webp'));
  const linkedPdfName = uploadedNames.find(name => name.endsWith('brief.pdf'));
  assert.ok(markdownName && pngName && webpName && linkedPdfName, `KB files[] include Markdown, PNG, WebP, and the linked PDF: ${uploadedNames.join(', ')}`);
  const markdownPart = mediaUpload.indexOf(`filename="${markdownName}"`);
  const markdownStart = mediaUpload.indexOf('\r\n\r\n', markdownPart) + 4;
  const markdownEnd = mediaUpload.indexOf('\r\n--', markdownStart);
  const uploadedMarkdown = mediaUpload.slice(markdownStart, markdownEnd);
  const servedFiles = [...uploadedMarkdown.matchAll(/https?:\/\/[^\s)]+\/knowledge-base\/serve\?[^\s)]+/g)]
    .map(match => new URL(match[0]).searchParams.get('file'));
  assert.deepEqual(new Set(servedFiles), new Set([pngName, webpName, linkedPdfName]), 'KB Markdown links each companion through the app file-serving route');

  const mediaPdf = await ui.evaluate(async conversation => chrome.runtime.sendMessage({ target: 'offscreen', conversation, format: 'pdf', download: false }), projectCapture.conversation);
  assert.equal(mediaPdf.ok, true, mediaPdf.error);
  const htmlBytes = Buffer.from(mediaPdf.files[0].base64, 'base64');
  assert.match(htmlBytes.toString('utf8'), /^<!doctype html>/i, 'PDF preparation returns a browser-renderable HTML document');
  assert.equal(mediaPdf.mime, 'text/html;charset=utf-8');
  assert.match(htmlBytes.toString('utf8'), /Source:/, 'the print document retains provenance');

  const localMarkdown = await ui.evaluate(async conversation => chrome.runtime.sendMessage({ target: 'offscreen', conversation, format: 'md', download: true }), projectCapture.conversation);
  assert.equal(localMarkdown.ok, true, localMarkdown.error);
  assert.equal(localMarkdown.mime, 'application/zip', 'local Markdown with media downloads as a ZIP');
  const zipBytes = Buffer.from(await ui.evaluate(async url => Array.from(new Uint8Array(await (await fetch(url)).arrayBuffer())), localMarkdown.url));
  const zipListing = zipBytes.toString('latin1');
  assert.match(zipListing, /media\/[^\x00]+\.png/);
  assert.match(zipListing, /media\/[^\x00]+\.webp/);
  assert.match(zipListing, /media\/[^/\x00]+brief\.pdf/);
  await ui.evaluate(url => chrome.runtime.sendMessage({ target: 'offscreen', type: 'release', url }), localMarkdown.url);
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
  for (const width of [360, 390]) {
    await target.setViewportSize({ width, height: 780 });
    const widgetBounds = await panel.evaluate(node => {
      const rect = node.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, viewportWidth: innerWidth, viewportHeight: innerHeight, documentWidth: document.documentElement.scrollWidth };
    });
    assert.ok(widgetBounds.left >= 0 && widgetBounds.right <= width, `widget fits the ${width}px viewport: ${JSON.stringify(widgetBounds)}`);
    assert.ok(widgetBounds.bottom <= 780 && widgetBounds.top >= 0, `widget fits the ${width}x780 viewport: ${JSON.stringify(widgetBounds)}`);
    assert.ok(widgetBounds.documentWidth <= width, `conversation has no horizontal overflow at ${width}px: ${JSON.stringify(widgetBounds)}`);
    await target.screenshot({ path: `artifacts/widget-open-${width}.png` });
  }
  await target.setViewportSize({ width: 1280, height: 900 });
  await target.waitForFunction(() => {
    const rail = document.querySelector('#idea-capture-controls')?.shadowRoot?.querySelector('#idea-capture-margin-controls');
    const button = rail?.querySelector('button');
    const reply = document.querySelector('.long-answer p');
    if (!button || !reply || rail.hidden) return false;
    const railRect = button.getBoundingClientRect();
    const replyRect = reply.getBoundingClientRect();
    return railRect.right <= replyRect.left || railRect.left >= replyRect.right;
  }, null, { timeout: 2000 });
  const initialRailAgainstReply = await target.evaluate(() => {
    const button = document.querySelector('#idea-capture-controls')?.shadowRoot?.querySelector('#idea-capture-margin-controls button');
    const reply = document.querySelector('.long-answer p');
    return { rail: button?.getBoundingClientRect().toJSON(), reply: reply?.getBoundingClientRect().toJSON() };
  });
  assert.ok(initialRailAgainstReply.rail.right <= initialRailAgainstReply.reply.left || initialRailAgainstReply.rail.left >= initialRailAgainstReply.reply.right, `rail stays outside readable reply text after resizing to desktop: ${JSON.stringify(initialRailAgainstReply)}`);
  await panel.locator('[data-action="collapse-all"]').click();
  await target.locator('.idea-capture-section-collapsed').first().waitFor({ state: 'attached' });
  assert.equal(await target.locator('.idea-capture-section-collapsed').count(), 7);
  await target.screenshot({ path: 'artifacts/sections-collapsed.png', fullPage: true });
  await panel.locator('[data-action="expand-all"]').click();
  assert.equal(await target.locator('.idea-capture-section-collapsed').count(), 0);
  await panelToggle.click();
  assert.equal(await panel.locator('.panel-body').isHidden(), true);
  await target.screenshot({ path: 'artifacts/widget-closed-desktop.png' });
  await panelToggle.click();
  const orderedPage = await context.newPage();
  await orderedPage.goto(`${appUrl}/ordered-turns`);
  await orderedPage.locator('.idea-capture-section-header').nth(2).waitFor();
  const orderedWidget = orderedPage.locator('#idea-capture-panel');
  await orderedWidget.locator('[data-action="toggle-panel"]').click();
  await orderedWidget.locator('[data-action="collapse-all"]').click();
  await orderedPage.locator('.idea-capture-section-header button').nth(0).click();
  const orderedGeometry = await orderedPage.evaluate(() => ({
    replyBottom: document.querySelector('[data-testid="conversation-turn-1"]').getBoundingClientRect().bottom,
    nextHeaderTop: document.querySelectorAll('.idea-capture-section-header')[1].getBoundingClientRect().top,
  }));
  assert.ok(orderedGeometry.nextHeaderTop >= orderedGeometry.replyBottom, `later collapsed section remains below the expanded previous reply: ${JSON.stringify(orderedGeometry)}`);
  await orderedPage.screenshot({ path: 'artifacts/ordered-collapse.png' });
  await orderedPage.close();
  // Long prompts and many rows exercise wrapping and the panel's internal scrolling.
  const stress = await context.newPage();
  await stress.setViewportSize({ width: 360, height: 780 });
  await stress.goto(`${appUrl}/layout-stress`);
  await stress.locator('.idea-capture-section-header').nth(11).waitFor();
  const stressPanel = stress.locator('#idea-capture-panel');
  const stressToggle = stressPanel.locator('[data-action="toggle-panel"]');
  await stressToggle.click();
  assert.equal(await stress.locator('.idea-capture-section-header').count(), 12, 'long conversation fixture exposes all 12 section controls');
  assert.equal(await stressPanel.locator('.row').count(), 12, 'the widget lists all 12 sections');
  const stressMetrics = await stressPanel.evaluate(node => {
    const rect = node.getBoundingClientRect();
    const list = node.querySelector('.list');
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, panelHeight: rect.height, listHeight: list.clientHeight, listScrollHeight: list.scrollHeight, documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth };
  });
  assert.ok(stressMetrics.left >= 0 && stressMetrics.right <= 360, `long-label panel stays within the narrow viewport: ${JSON.stringify(stressMetrics)}`);
  assert.ok(stressMetrics.bottom <= 780, `long-label panel stays within the viewport height: ${JSON.stringify(stressMetrics)}`);
  assert.ok(stressMetrics.documentWidth <= 360, `long labels create no horizontal page overflow: ${JSON.stringify(stressMetrics)}`);
  assert.ok(stressMetrics.listScrollHeight > stressMetrics.listHeight, `many section rows scroll inside the panel: ${JSON.stringify(stressMetrics)}`);
  await stress.screenshot({ path: 'artifacts/widget-long-labels-many-rows.png' });
  await stress.setViewportSize({ width: 390, height: 780 });
  const stress390 = await stressPanel.boundingBox();
  assert.ok(stress390 && stress390.x >= 0 && stress390.x + stress390.width <= 390, `long-label panel fits at 390px: ${JSON.stringify(stress390)}`);
  await stress.screenshot({ path: 'artifacts/widget-long-labels-390.png' });
  await stress.setViewportSize({ width: 360, height: 480 });
  const stressShort = await stressPanel.evaluate(node => {
    const rect = node.getBoundingClientRect();
    const body = node.querySelector('.panel-body');
    const list = node.querySelector('.list');
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, panelHeight: rect.height, bodyHeight: body.clientHeight, bodyScrollHeight: body.scrollHeight, listHeight: list.clientHeight, listScrollHeight: list.scrollHeight, documentWidth: document.documentElement.scrollWidth };
  });
  assert.ok(stressShort.left >= 0 && stressShort.right <= 360, `long-label panel fits the 360px short viewport: ${JSON.stringify(stressShort)}`);
  assert.ok(stressShort.top >= 0 && stressShort.bottom <= 480, `long-label panel fits the 360x480 viewport: ${JSON.stringify(stressShort)}`);
  assert.ok(stressShort.documentWidth <= 360, `short viewport has no horizontal overflow: ${JSON.stringify(stressShort)}`);
  assert.ok(stressShort.listScrollHeight > stressShort.listHeight, `section rows remain internally scrollable in the short viewport: ${JSON.stringify(stressShort)}`);
  assert.ok(stressShort.listHeight >= 80, `the short-viewport list keeps enough height to expose multiple rows: ${JSON.stringify(stressShort)}`);
  const shortList = stressPanel.locator('.list');
  const shortFirstCheckbox = shortList.locator('input[data-section-id]').first();
  await shortFirstCheckbox.uncheck();
  assert.equal(await shortFirstCheckbox.isChecked(), false, 'a section checkbox remains clickable at 360x480');
  await shortFirstCheckbox.check();
  const lastShortRow = shortList.locator('.row').last();
  await lastShortRow.scrollIntoViewIfNeeded();
  assert.ok(await lastShortRow.isVisible(), 'the last section row can scroll into view in the constrained list');
  const shortSend = stressPanel.locator('[data-action="send-kb"]');
  await shortSend.scrollIntoViewIfNeeded();
  assert.ok(await shortSend.isVisible(), 'the send action can scroll into view below the constrained section list');
  await stress.screenshot({ path: 'artifacts/widget-long-labels-360x480.png' });

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
  await target.waitForFunction(() => document.querySelector('#idea-capture-controls')?.shadowRoot?.querySelector('#idea-capture-margin-controls button[aria-label]')?.getAttribute('aria-label').includes('first research approaches'));
  await rail.waitFor({ state: 'visible' });
  const railButton = rail.locator('button[data-idea-section-id]');
  assert.equal(await railButton.count(), 1, 'the side rail contains one compact section action');
  assert.match(await railButton.getAttribute('aria-label'), /Collapse section: .*first research approaches/i);
  assert.equal(await railButton.getAttribute('aria-expanded'), 'true');
  const railButtonBounds = await railButton.boundingBox();
  assert.ok(railButtonBounds && railButtonBounds.width <= 40 && railButtonBounds.height <= 40, `the side action stays compact: ${JSON.stringify(railButtonBounds)}`);
  const railStyle = await rail.evaluate(node => ({
    display: getComputedStyle(node).display,
    buttonDisplay: getComputedStyle(node.querySelector('button')).display,
    buttonDirection: node.querySelector('button').dataset.direction,
    chevron: (() => { const style = getComputedStyle(node.querySelector('button'), '::after'); return { content: style.content, position: style.position, left: style.left, top: style.top, width: style.width, height: style.height, clipPath: style.clipPath }; })(),
    position: getComputedStyle(node).position,
    rail: node.getBoundingClientRect().toJSON(),
    content: document.querySelector('main.chat [data-message-author-role]').getBoundingClientRect().toJSON(),
  }));
  assert.equal(railStyle.display, 'block', 'the compact control container styles must survive the fixture content security policy');
  assert.equal(railStyle.buttonDisplay, 'grid', 'the compact button remains centered inside its fixed hit area');
  assert.equal(railStyle.buttonDirection, 'right', 'the left-side rail points inward toward the conversation');
  assert.equal(railStyle.chevron.content, '""', 'the chevron is drawn by CSS rather than text');
  assert.equal(railStyle.chevron.position, 'absolute');
  assert.equal(railStyle.chevron.left, '17px', 'the pseudo-element anchor sits at the button center');
  assert.equal(railStyle.chevron.top, '17px', 'the pseudo-element anchor sits at the button center');
  assert.equal(railStyle.chevron.width, '7px');
  assert.equal(railStyle.chevron.height, '10px');
  assert.match(railStyle.chevron.clipPath, /polygon\(/, 'the chevron has a symmetric CSS shape');
  assert.equal(railStyle.position, 'fixed');
  assert.ok(railStyle.rail.right <= railStyle.content.left || railStyle.rail.left >= railStyle.content.right, `rail sits in a blank side margin: ${JSON.stringify(railStyle)}`);
  await target.screenshot({ path: 'artifacts/sections-middle-expanded.png' });
  const heightBeforeCollapse = await target.evaluate(() => document.documentElement.scrollHeight);
  await railButton.click();
  await target.waitForFunction(() => getComputedStyle(document.querySelector('.idea-capture-section-collapsed')).display === 'none');
  await target.screenshot({ path: 'artifacts/sections-middle-collapsed.png' });
  assert.equal(await rail.isHidden(), true, 'the compact side action hides while its section is collapsed');
  const inlineExpand = headers.first().locator('button[data-idea-section-id]');
  assert.equal(await inlineExpand.getAttribute('aria-expanded'), 'false');
  assert.match(await inlineExpand.getAttribute('aria-label'), /Expand section: .*first research approaches/i, 'the inline header offers the restore action');
  await target.setViewportSize({ width: 1160, height: 850 });
  await target.waitForFunction(() => {
    const button = document.querySelector('#idea-capture-controls')?.shadowRoot?.querySelector('#idea-capture-margin-controls button');
    const rect = button?.getBoundingClientRect();
    return button && rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight;
  });
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
  const inlineSectionCheck = headers.first().locator('input[data-idea-section-id]');
  await inlineSectionCheck.uncheck();
  assert.equal(await target.locator('.idea-capture-section-collapsed').count(), 3, 'changing selection leaves collapse state alone');
  const excludedTurn = await send({ type: 'capture', tabId, mode: 'export' });
  assert.equal(excludedTurn.ok, true, excludedTurn.error);
  assert.equal(excludedTurn.conversation.messages.length, 4);
  assert.equal(excludedTurn.conversation.messages.some(message => message.markdown.includes('first research approaches')), false);
  await inlineSectionCheck.check();
  assert.equal(await target.locator('.idea-capture-section-collapsed').count(), 3, 'reselecting a collapsed turn does not expand it');
  await inlineExpand.click();
  await target.waitForFunction(() => !document.querySelector('.idea-capture-section-collapsed'));
  assert.ok(await target.evaluate(() => document.documentElement.scrollHeight) > heightAfterCollapse + 1000, 'the rail restores the hidden turn content');
  await target.evaluate(() => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
  await headers.nth(1).evaluate(node => node.scrollIntoView({ block: 'center' }));
  await target.waitForFunction(() => document.querySelector('#idea-capture-controls')?.shadowRoot?.querySelector('#idea-capture-margin-controls button[aria-label]')?.getAttribute('aria-label').includes('project timeline'));
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

  const selectedPdf = await send({ type: 'export', destination: 'kb', format: 'pdf', conversation: selected.conversation });
  assert.equal(selectedPdf.ok, false, 'PDF cannot be sent to KB before the user saves it through the print dialog');
  assert.match(selectedPdf.error, /print dialog/i);

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
    return { hidden: shadow?.querySelector('#idea-capture-panel')?.hidden, bodyHidden: shadow?.querySelector('.panel-body')?.hidden, expanded: shadow?.querySelector('[data-action="toggle-panel"]')?.getAttribute('aria-expanded'), headers: document.querySelectorAll('.idea-capture-section-header').length, railHidden: shadow?.querySelector('#idea-capture-margin-controls')?.hidden };
  });
  assert.deepEqual(emptyState, { hidden: false, bodyHidden: false, expanded: 'true', headers: 0, railHidden: true }, `an already-open launcher remains available while its empty state clears inline controls and the side rail: ${JSON.stringify(emptyState)}`);
  await target.evaluate(() => {
    document.querySelector('main').innerHTML = '<div data-message-author-role="user">A fresh conversation begins.</div><div data-message-author-role="assistant">Its sections should reset.</div>';
  });
  await target.waitForFunction(() => document.querySelectorAll('.idea-capture-section-header').length === 1 && !document.querySelector('#idea-capture-controls')?.shadowRoot?.querySelector('#idea-capture-panel')?.hidden);

  for (const format of ['md', 'html']) {
    const response = await send({ type: 'export', destination: 'kb', format, conversation: captured.conversation });
    console.log(`${format} upload:`, response.ok, response.error || '');
    assert.equal(response.ok, true, response.error);
    assert.match(uploads.at(-1).toString(), format === 'md' ? /## Assistant/ : /text\/html/);
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
  // Standalone HTML downloads exercise the offscreen renderer without a native Save dialog.
  const file = await ui.evaluate(async conversation => chrome.runtime.sendMessage({ target: 'offscreen', conversation, format: 'html', download: true }), captured.conversation);
  assert.equal(file.ok, true, file.error);
  const html = await ui.evaluate(async url => Array.from(new Uint8Array(await (await fetch(url)).arrayBuffer())), file.url);
  assert.match(Buffer.from(html).toString('utf8'), /^<!doctype html>/i);
  await writeFile('artifacts/conversation.html', Buffer.from(html));
  // Exercise export from the on-page widget. The latest page selection must be
  // read when the user exports, so changing it after opening the widget filters
  // the upload without a separate popup preview.
  await target.evaluate(() => {
    const paragraphs = Array.from({ length: 72 }, (_, i) => `<p>Research evidence ${i + 1}: compare interview records with observation notes, preserve participant context, and record how the evidence changes the pilot decision. Keep the reasoning visible so reviewers can follow the source through analysis and implementation.</p>`).join('');
    document.querySelector('main').innerHTML = `<div data-message-author-role="user" class="research-question">Widget should keep this long research turn.</div><div data-message-author-role="assistant"><section class="answer-card"><h2 class="answer-heading">Research synthesis</h2><p>Compare the field notes, survey summary, and location map before choosing a pilot.</p><img class="evidence-image" alt="Evidence chart" width="480" height="240" src=""><svg class="evidence-chart" viewBox="0 0 480 180" role="img" aria-label="Fieldwork chart"><defs><linearGradient id="chartGradient"><stop offset="0" stop-color="#285b42"/><stop offset="1" stop-color="#98bca1"/></linearGradient></defs><path d="M10 160 L130 120 L250 90 L370 45 L470 15" fill="none" stroke="url(#chartGradient)" stroke-width="8"/></svg><table class="evidence-table"><thead><tr><th>Evidence</th><th>Decision</th></tr></thead><tbody><tr><td>Interview notes</td><td>Test recruitment first</td></tr><tr><td>Survey summary</td><td>Validate interest</td></tr></tbody></table><pre><code>function choosePilot(evidence) { return evidence.interviews > 0 ? "field test" : "recruit"; }</code></pre>${paragraphs}<p id="final-layout-sentinel">Final page sentinel: preserve this last paragraph after print pagination.</p></section></div><div data-message-author-role="user">Widget should exclude this turn.</div><div data-message-author-role="assistant">This answer should not be uploaded.</div>`;
    const canvas = document.createElement('canvas');
    canvas.width = 480; canvas.height = 240;
    const context = canvas.getContext('2d');
    const gradient = context.createLinearGradient(0, 0, 480, 240);
    gradient.addColorStop(0, '#dbe9dd'); gradient.addColorStop(1, '#a6c3ac');
    context.fillStyle = gradient; context.fillRect(0, 0, 480, 240);
    context.strokeStyle = '#285b42'; context.lineWidth = 9; context.beginPath();
    context.moveTo(30, 190); context.lineTo(130, 145); context.lineTo(230, 160); context.lineTo(330, 80); context.lineTo(450, 55); context.stroke();
    context.fillStyle = '#285b42'; context.beginPath(); context.arc(330, 80, 11, 0, Math.PI * 2); context.fill();
    document.querySelector('.evidence-image').src = canvas.toDataURL('image/png');
  });
  await target.waitForFunction(() => document.querySelectorAll('.idea-capture-section-header').length === 2 && [...document.querySelectorAll('.idea-capture-section-header input')].every(input => input.checked));
  await target.waitForFunction(() => { const image = document.querySelector('.evidence-image'); return image?.complete && image.naturalWidth === 480; });
  await target.setViewportSize({ width: 1280, height: 900 });
  await target.locator('#idea-capture-controls').evaluate(node => { node.dataset.screenshotHidden = 'true'; node.style.display = 'none'; });
  await target.locator('.idea-capture-section-header').evaluateAll(nodes => nodes.forEach(node => { node.dataset.screenshotHidden = 'true'; node.style.visibility = 'hidden'; }));
  await target.screenshot({ path: 'artifacts/layout-source-viewport.png' });
  await target.screenshot({ path: 'artifacts/layout-source.png', fullPage: true });
  await target.locator('#idea-capture-controls').evaluate(node => { node.style.display = ''; delete node.dataset.screenshotHidden; });
  await target.locator('.idea-capture-section-header').evaluateAll(nodes => nodes.forEach(node => { node.style.visibility = ''; delete node.dataset.screenshotHidden; }));
  const sourceLayoutMetrics = await target.evaluate(() => {
    const card = document.querySelector('.answer-card');
    const image = card.querySelector('img');
    const path = card.querySelector('svg path');
    return {
      card: { ...card.getBoundingClientRect().toJSON(), background: getComputedStyle(card).backgroundImage, color: getComputedStyle(card).color },
      image: { ...image.getBoundingClientRect().toJSON(), naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight },
      svg: { ...card.querySelector('svg').getBoundingClientRect().toJSON() },
      tableBorder: { width: getComputedStyle(card.querySelector('th')).borderBottomWidth, style: getComputedStyle(card.querySelector('th')).borderBottomStyle, color: getComputedStyle(card.querySelector('th')).borderBottomColor },
      chart: { ...path.getBoundingClientRect().toJSON(), stroke: getComputedStyle(path).stroke, strokeWidth: getComputedStyle(path).strokeWidth },
    };
  });
  const widget = target.locator('#idea-capture-panel');
  const widgetToggle = widget.locator('[data-action="toggle-panel"]');
  if (await widgetToggle.getAttribute('aria-expanded') !== 'true') await widgetToggle.click();
  await widget.locator('.panel-body').waitFor({ state: 'visible' });
  assert.equal(await widget.locator('[name="format"]:checked').inputValue(), 'md', 'the widget defaults to Markdown');
  assert.match(await widget.locator('[data-summary]').textContent(), /2 of 2 sections/, 'widget metadata reports both detected sections');
  assert.equal(await widget.locator('input[data-section-id]').count(), 2, 'the widget exposes a selection control for each detected turn');
  await target.locator('.idea-capture-section-header input').nth(1).uncheck();
  await widget.locator('input[data-section-id]').nth(1).waitFor();
  await widget.locator('input[data-section-id]').nth(1).uncheck();
  await widget.locator('[name="format"][value="md"]').check();
  const uploadCountBeforeWidgetSend = uploads.length;
  await widget.locator('[data-action="send-kb"]').click();
  await target.waitForFunction(() => /Saved to knowledge base:/i.test(document.querySelector('#idea-capture-controls')?.shadowRoot?.querySelector('[data-capture-status]')?.textContent || ''), null, { timeout: 10000 });
  assert.equal(uploads.length, uploadCountBeforeWidgetSend + 1, 'the widget sends one fresh capture to the KB');
  const widgetUpload = uploads.at(-1).toString();
  assert.match(widgetUpload, /Widget should keep this long research turn/);
  assert.match(widgetUpload, /Research evidence 72/);
  assert.doesNotMatch(widgetUpload, /Widget should exclude this turn|This answer should not be uploaded/);

  await widget.locator('[name="format"][value="html"]').check();
  const htmlUploadCount = uploads.length;
  await widget.locator('[data-action="send-kb"]').click();
  await target.waitForFunction(() => /Saved to knowledge base:/i.test(document.querySelector('#idea-capture-controls')?.shadowRoot?.querySelector('[data-capture-status]')?.textContent || ''), null, { timeout: 10000 });
  assert.equal(uploads.length, htmlUploadCount + 1, 'the widget sends the styled standalone HTML snapshot to KB');
  const capturedHtmlPart = uploads.at(-1).toString().match(/Content-Type: text\/html[^\r]*\r\n\r\n([\s\S]*?)\r\n--/i)?.[1];
  assert.ok(capturedHtmlPart, 'multipart KB upload contains standalone HTML');
  assert.match(capturedHtmlPart, /data-idea-export-section=/);
  assert.match(capturedHtmlPart, /linear-gradient/, 'the source gradient remains in standalone HTML');
  assert.match(capturedHtmlPart, /<svg[\s\S]*?<path/, 'inline SVG charts survive in standalone HTML');
  assert.doesNotMatch(capturedHtmlPart, /Widget should exclude this turn|This answer should not be uploaded/);
  await writeFile('artifacts/captured-layout.html', capturedHtmlPart);

  await widget.locator('[name="format"][value="pdf"]').check();
  assert.equal(await widget.locator('[data-action="send-kb"]').isDisabled(), true, 'PDF-to-KB is visibly disabled');
  const printTabPromise = context.waitForEvent('page');
  await widget.locator('[data-action="download"]').click();
  await target.waitForFunction(() => /Choose “Save as PDF”/i.test(document.querySelector('#idea-capture-controls')?.shadowRoot?.querySelector('[data-capture-status]')?.textContent || ''), null, { timeout: 10000 });
  const printTab = await printTabPromise;
  await printTab.waitForLoadState('domcontentloaded');
  await printTab.waitForFunction(() => document.querySelector('[data-idea-export-section]') && !document.querySelector('script:not([src])'));
  await printTab.setViewportSize({ width: 1280, height: 900 });
  const exportLayoutMetrics = await printTab.evaluate(() => {
    const card = document.querySelector('.answer-card');
    const image = card.querySelector('img');
    const path = card.querySelector('svg path');
    return {
      card: { ...card.getBoundingClientRect().toJSON(), background: getComputedStyle(card).backgroundImage, color: getComputedStyle(card).color },
      image: { ...image.getBoundingClientRect().toJSON(), naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight },
      svg: { ...card.querySelector('svg').getBoundingClientRect().toJSON() },
      tableBorder: { width: getComputedStyle(card.querySelector('th')).borderBottomWidth, style: getComputedStyle(card.querySelector('th')).borderBottomStyle, color: getComputedStyle(card.querySelector('th')).borderBottomColor },
      chart: { ...path.getBoundingClientRect().toJSON(), stroke: getComputedStyle(path).stroke, strokeWidth: getComputedStyle(path).strokeWidth },
    };
  });
  for (const property of ['width', 'height']) {
    assert.ok(Math.abs(sourceLayoutMetrics.card[property] - exportLayoutMetrics.card[property]) <= 1, `source/export card ${property} matches: ${JSON.stringify({ source: sourceLayoutMetrics.card, exported: exportLayoutMetrics.card })}`);
    assert.ok(Math.abs(sourceLayoutMetrics.image[property] - exportLayoutMetrics.image[property]) <= 1, `source/export image ${property} matches: ${JSON.stringify({ source: sourceLayoutMetrics.image, exported: exportLayoutMetrics.image })}`);
    assert.ok(Math.abs(sourceLayoutMetrics.svg[property] - exportLayoutMetrics.svg[property]) <= 1, `source/export SVG ${property} matches: ${JSON.stringify({ source: sourceLayoutMetrics.svg, exported: exportLayoutMetrics.svg })}`);
  }
  assert.equal(exportLayoutMetrics.image.naturalWidth, sourceLayoutMetrics.image.naturalWidth);
  assert.ok(sourceLayoutMetrics.image.naturalWidth > 0, 'the source fixture image loaded before comparison');
  assert.ok(exportLayoutMetrics.image.naturalWidth > 0, 'the exported image loaded before comparison');
  assert.equal(exportLayoutMetrics.chart.strokeWidth, sourceLayoutMetrics.chart.strokeWidth);
  assert.equal(exportLayoutMetrics.chart.stroke, sourceLayoutMetrics.chart.stroke, 'the SVG chart retains its computed gradient stroke');
  assert.deepEqual(exportLayoutMetrics.tableBorder, sourceLayoutMetrics.tableBorder, 'the table keeps its individual header border style');
  const standalonePreview = await context.newPage();
  await standalonePreview.setViewportSize({ width: 1280, height: 900 });
  await standalonePreview.setContent(capturedHtmlPart, { waitUntil: 'load' });
  await standalonePreview.waitForFunction(() => [...document.images].every(image => image.complete));
  const standaloneHeader = await standalonePreview.locator('.provenance').evaluateAll(nodes => ({ count: nodes.length, position: nodes[0] ? getComputedStyle(nodes[0]).position : '' }));
  assert.deepEqual(standaloneHeader, { count: 1, position: 'static' }, 'standalone HTML has one static provenance header');
  const standaloneBounds = await standalonePreview.locator('.answer-card').evaluate(node => node.getBoundingClientRect().toJSON());
  assert.ok(Math.abs(sourceLayoutMetrics.card.width - standaloneBounds.width) <= 1, 'standalone HTML screenshot retains source card width');
  await standalonePreview.screenshot({ path: 'artifacts/layout-export-viewport.png' });
  await standalonePreview.close();
  const printHtml = await printTab.locator('html').evaluate(node => node.outerHTML);
  assert.match(printHtml, /Widget should keep this long research turn/);
  assert.match(printHtml, /Final page sentinel/);
  assert.match(printHtml, /Evidence chart/);
  assert.match(printHtml, /linear-gradient/);
  assert.match(printHtml, /<svg[\s\S]*?<path/);
  assert.doesNotMatch(printHtml, /Widget should exclude this turn|This answer should not be uploaded/);
  const cdp = await context.newCDPSession(printTab);
  const printed = await cdp.send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true });
  const printedPdf = Buffer.from(printed.data, 'base64');
  assert.equal(printedPdf.subarray(0, 5).toString(), '%PDF-', 'Chromium prints the styled snapshot as a real PDF');
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/captured-layout.pdf', printedPdf);
  const printableText = execFileSync('pdftotext', ['-layout', '-', '-'], { input: printedPdf, encoding: 'utf8' });
  assert.match(printableText, /Final page sentinel/, 'the final long-answer text is present in the generated PDF');
  assert.match(printableText, /Research evidence 72/, 'Chromium prints the final paragraph after multiple pages');
  assert.match(printableText, /Test recruitment first/, 'table cell text is present in the PDF');
  assert.match(printableText, /choosePilot/, 'code remains searchable in the PDF');

  await widget.locator('[data-action="copy-diagnostics"]').first().click();
  await target.waitForFunction(() => {
    const shadow = document.querySelector('#idea-capture-controls')?.shadowRoot;
    return !!shadow?.querySelector('[data-diagnostics-status]')?.textContent;
  });
  const diagnosticsStatus = await widget.locator('[data-diagnostics-status]').textContent();
  assert.match(diagnosticsStatus, /copied|Clipboard access failed/i, 'diagnostics provide copy feedback or an accessible manual fallback');
  const fallback = widget.locator('[data-diagnostics-fallback]');
  if (await fallback.count()) assert.ok(await fallback.getAttribute('aria-label'), 'manual diagnostics copy has an accessible label');

  await target.setViewportSize({ width: 1280, height: 900 });
  const widgetDesktop = await widget.evaluate(node => ({ viewportWidth: innerWidth, documentWidth: document.documentElement.scrollWidth, rect: node.getBoundingClientRect().toJSON() }));
  assert.ok(widgetDesktop.documentWidth <= 1280, `on-page widget has no horizontal overflow at desktop width: ${JSON.stringify(widgetDesktop)}`);
  await target.screenshot({ path: 'artifacts/widget-export-desktop.png' });
  for (const width of [360, 390]) {
    await target.setViewportSize({ width, height: 700 });
    const widgetBounds = await widget.evaluate(node => ({ viewportWidth: innerWidth, documentWidth: document.documentElement.scrollWidth, rect: node.getBoundingClientRect().toJSON() }));
    assert.ok(widgetBounds.documentWidth <= width, `on-page widget has no horizontal overflow at ${width}px: ${JSON.stringify(widgetBounds)}`);
    assert.ok(widgetBounds.rect.left >= 0 && widgetBounds.rect.right <= width, `on-page widget fits ${width}px: ${JSON.stringify(widgetBounds)}`);
    await target.screenshot({ path: `artifacts/widget-export-${width}.png` });
  }
  await target.setViewportSize({ width: 1280, height: 900 });
  const settingsPageEvent = context.waitForEvent('page', { timeout: 5000 }).catch(() => null);
  await widget.locator('[data-action="settings"]').click();
  await settingsPageEvent;
  const settingsPage = context.pages().find(page => page.url().endsWith('/options.html'));
  assert.ok(settingsPage, 'the widget settings action opens the existing settings page');

  // Exercise the production manifest: media access is available on installation.
  const autoExtension = join(temp, 'auto-extension'); await cp('dist', autoExtension, { recursive: true });
  const autoManifest = JSON.parse(await readFile(join(autoExtension, 'manifest.json')));
  assert.deepEqual(autoManifest.host_permissions, ['http://*/*', 'https://*/*']);
  autoContext = await chromium.launchPersistentContext(join(temp, 'auto-profile'), { ...browserOptions, headless: true, args: ['--deny-permission-prompts', `--disable-extensions-except=${autoExtension}`, `--load-extension=${autoExtension}`] });
  const autoWorker = autoContext.serviceWorkers()[0] || await autoContext.waitForEvent('serviceworker');
  await autoWorker.evaluate(() => {
    self.__browserPermissionRequests = 0;
    chrome.permissions.request = async () => { self.__browserPermissionRequests++; throw new Error('Unexpected permission prompt'); };
  });
  await autoContext.route('https://chatgpt.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><title>Automatic capture</title><main><div data-message-author-role="user">A question with automatic injection.</div><div data-message-author-role="assistant">An answer captured by the page widget.<img alt="Remote evidence" src="${appUrl}/media/evidence.png"></div></main><form style="position:fixed;left:20%;right:20%;bottom:0;height:76px;padding:10px;border:1px solid #ccd4ce;border-radius:16px;background:white"><div contenteditable="true" aria-label="Message composer" style="height:48px;padding:8px">Ask anything</div></form>` }));
  const autoPage = await autoContext.newPage();
  await autoPage.goto('https://chatgpt.com/c/auto-injected');
  await autoPage.locator('[data-idea-capture-owned="host"]').waitFor({ state: 'attached' });
  const autoWidget = autoPage.locator('#idea-capture-panel');
  await autoWidget.locator('[data-action="toggle-panel"]').click();
  await autoWidget.locator('[data-summary]').waitFor();
  assert.match(await autoWidget.locator('[data-summary]').textContent(), /2 messages/);
  assert.equal(await autoWidget.locator('[data-action="allow-media"]').count(), 0, 'media authorization is no longer a widget action');
  assert.equal(await autoWorker.evaluate(() => chrome.permissions.contains({ origins: ['https://media.example/*'] })), true, 'cross-site media access is granted by the production manifest');
  await autoWidget.locator('[name="format"][value="md"]').check();
  await autoWidget.locator('[data-action="download"]').click();
  await autoPage.waitForFunction(() => /Download started\./i.test(document.querySelector('#idea-capture-controls')?.shadowRoot?.querySelector('[data-capture-status]')?.textContent || ''), null, { timeout: 10000 });
  const [autoDownload] = await autoWorker.evaluate(() => chrome.downloads.search({ limit: 1, orderBy: ['-startTime'] }));
  assert.equal(autoDownload.mime, 'application/zip', 'automatically authorized cross-site image is bundled with the Markdown');
  assert.equal(await autoWorker.evaluate(() => self.__browserPermissionRequests), 0, 'download requires no per-page permission prompt');
  assert.equal(errors.length, 0, errors.join('\n'));
  assert.equal(cspErrors.length, 0, cspErrors.join('\n'));
  console.log('Browser checks passed: turn sections, inline controls, selected MD/PDF export and download, dynamic/SPA updates, remote full capture, KB upload, diagnostics, settings, and responsive on-page widget.');
} finally {
  await context?.close();
  await autoContext?.close();
  await Promise.all([new Promise(r => app.close(r)), new Promise(r => queue.close(r)), new Promise(r => mounted ? mounted.close(r) : r())]);
  await rm(temp, { recursive: true, force: true });
}
