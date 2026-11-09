import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

// Browser regression for the actual capture/export modules. The source fixture
// intentionally includes stateful native controls, native disclosures, a local
// ARIA disclosure, and a CodeMirror-shaped code block used by current ChatGPT.
const bundle = await build({
  stdin: {
    contents: `import { extractConversation } from './src/extract.js';\nimport { conversationHtml } from './src/html-export.js';\nglobalThis.IdeaHtmlCapture = { extractConversation, conversationHtml };`,
    resolveDir: process.cwd(),
    sourcefile: 'html-interaction-test-entry.js',
  },
  bundle: true,
  format: 'iife',
  platform: 'browser',
  write: false,
});
const entry = bundle.outputFiles[0].text;

const common = `
  <p>Choose the preferred approach.</p>
  <details id="more" style="border:1px solid #bbc; padding:8px"><summary>More evidence</summary><p id="evidence">The field study supports the second approach.</p></details>
  <details id="already-open" open><summary>Visible evidence</summary><p>Already visible.</p></details>
  <label>Include pilot <input id="pilot" type="checkbox" checked></label>
  <label>Priority <select id="priority"><option value="low">Low</option><option value="high" selected>High</option></select></label>
  <label>Working note <input id="working-note" type="text" value="Original value"></label>
  <button id="detail-toggle" type="button" aria-expanded="false" aria-controls="detail-panel">Show detailed evidence</button>
  <section id="detail-panel" hidden><p>Detailed panel content.</p></section>
  <div data-code-block style="margin-top:16px">
    <div class="cm-editor" style="background-color:rgb(25, 28, 35); color:rgb(224, 230, 238); font-family:ui-monospace, monospace; font-size:14px; line-height:20px; padding:12px">
      <div class="cm-content" data-language="javascript" role="textbox" aria-readonly="true">
        <div class="cm-line"><span style="color:rgb(120, 190, 140)">const</span> answer = 42;</div>
        <div class="cm-line">console.log(answer);</div>
      </div>
    </div>
  </div>`;

const fixtures = [
  {
    provider: 'ChatGPT', url: 'https://chatgpt.com/c/html-regression',
    html: `<!doctype html><html><head><title>Research - ChatGPT</title><style>
      body{font:16px/1.5 system-ui;color:#20242a} main{max-width:760px;margin:20px auto;padding:24px}
      [data-message-author-role]{background:#f7f8fa;padding:20px;border-radius:12px}
      #detail-toggle{padding:6px 12px;margin-top:16px} #detail-panel{border-left:3px solid #5477a2;padding:8px 12px}
    </style></head><body><main><article data-message-author-role="assistant">${common}</article></main></body></html>`,
  },
  {
    provider: 'Claude', url: 'https://claude.ai/chat/html-regression',
    html: `<!doctype html><html><head><title>Research - Claude</title><style>
      body{font:16px/1.5 system-ui;color:#20242a} main{max-width:760px;margin:20px auto;padding:24px}
      [data-testid=user-message]{background:#eee;padding:16px;border-radius:12px}
      .font-claude-response{background:#f7f8fa;padding:20px;border-radius:12px}
      #detail-toggle{padding:6px 12px;margin-top:16px} #detail-panel{border-left:3px solid #5477a2;padding:8px 12px}
    </style></head><body><main><div data-testid="user-message">Compare these evidence options.</div><div class="font-claude-response">${common}</div></main></body></html>`,
  },
];

const browser = await chromium.launch(process.env.IDEA_BROWSER_PATH
  ? { executablePath: process.env.IDEA_BROWSER_PATH }
  : { channel: process.env.IDEA_BROWSER_CHANNEL || 'chromium' });

async function capture(page, fixture) {
  await page.setContent(fixture.html, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    document.querySelector('#pilot').checked = false;
    document.querySelector('#priority').value = 'low';
    document.querySelector('#working-note').value = 'Working draft';
  });
  await page.addScriptTag({ content: entry });
  const result = await page.evaluate(({ url }) => window.IdeaHtmlCapture.extractConversation(document, url, { includeLayout: true }), { url: fixture.url });
  assert.ok(result.messages.length, `${fixture.provider}: fixture yields captured messages`);
  assert.ok(result.layoutHtml, `${fixture.provider}: layout snapshot exists`);
  const sourceEditorBounds = await page.locator('.cm-editor').evaluate(node => {
    const rect = node.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  const html = await page.evaluate(({ result, fixture }) => window.IdeaHtmlCapture.conversationHtml({
    title: fixture.provider,
    url: fixture.url,
    provider: fixture.provider,
    capturedAt: '2026-11-09T12:00:00.000Z',
    ...result,
  }), { result, fixture });
  return { html, sourceEditorBounds };
}

async function inspectAndInteract(page, fixture, html, sourceEditorBounds, { appFrame = false } = {}) {

  // Mirror KbController#raw's restrictive response policy and its iframe
  // sandbox. The exported file's own CSP remains in effect for direct opening.
  if (appFrame) {
    html = html.replace('</head>', '<meta http-equiv="Content-Security-Policy" content="default-src &apos;none&apos;; img-src data:; style-src &apos;unsafe-inline&apos;; font-src data:"></head>');
    await page.setContent('<iframe id="viewer" sandbox="allow-same-origin" title="Captured conversation"></iframe>');
    await page.locator('#viewer').evaluate((frame, srcdoc) => { frame.srcdoc = srcdoc; }, html);
    const frame = page.frameLocator('#viewer');
    await frame.locator('body').waitFor();
    return interact(frame, fixture, appFrame);
  }

  await page.setContent(html, { waitUntil: 'domcontentloaded' });
  return interact(page, fixture, appFrame, sourceEditorBounds);
}

async function interact(scope, fixture, appFrame, sourceEditorBounds) {
  const prefix = `${fixture.provider}${appFrame ? ' app viewer' : ' standalone'}`;
  const details = scope.locator('details#more');
  assert.equal(await details.count(), 1, `${prefix}: closed native details survives export`);
  assert.equal(await details.evaluate(node => node.open), false, `${prefix}: closed state survives`);
  await details.locator('summary').click();
  assert.equal(await details.evaluate(node => node.open), true, `${prefix}: native details opens on click`);
  assert.equal(await scope.locator('#evidence').isVisible(), true, `${prefix}: opened detail content becomes visible`);

  const open = scope.locator('details#already-open');
  assert.equal(await open.evaluate(node => node.open), true, `${prefix}: initially open details state survives`);
  await open.locator('summary').click();
  assert.equal(await open.evaluate(node => node.open), false, `${prefix}: initially open details closes on click`);

  const checkbox = scope.locator('#pilot');
  assert.equal(await checkbox.isChecked(), false, `${prefix}: live unchecked state survives`);
  await checkbox.check();
  assert.equal(await checkbox.isChecked(), true, `${prefix}: checkbox remains interactive`);
  const select = scope.locator('#priority');
  assert.equal(await select.inputValue(), 'low', `${prefix}: live selected option survives`);
  await select.selectOption('high');
  assert.equal(await select.inputValue(), 'high', `${prefix}: select remains interactive`);
  const note = scope.locator('#working-note');
  assert.equal(await note.inputValue(), 'Working draft', `${prefix}: live text value survives`);
  await note.fill('Reviewed');
  assert.equal(await note.inputValue(), 'Reviewed', `${prefix}: text field remains interactive`);

  const editor = scope.locator('.cm-editor');
  assert.equal(await editor.count(), 1, `${prefix}: CodeMirror visual surface survives`);
  const style = await editor.evaluate(node => {
    const css = getComputedStyle(node);
    return { background: css.backgroundColor, color: css.color, font: css.fontFamily, fontSize: css.fontSize, padding: css.padding };
  });
  assert.deepEqual(style, {
    background: 'rgb(25, 28, 35)', color: 'rgb(224, 230, 238)', font: 'ui-monospace, monospace', fontSize: '14px', padding: '12px',
  }, `${prefix}: CodeMirror presentation remains intact`);
  if (!appFrame) {
    const exportedBounds = await editor.evaluate(node => {
      const rect = node.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
    assert.ok(Math.abs(exportedBounds.width - sourceEditorBounds.width) <= 1,
      `${prefix}: CodeMirror width matches source (${JSON.stringify({ source: sourceEditorBounds, exported: exportedBounds })})`);
    assert.ok(Math.abs(exportedBounds.height - sourceEditorBounds.height) <= 1,
      `${prefix}: CodeMirror height matches source (${JSON.stringify({ source: sourceEditorBounds, exported: exportedBounds })})`);
  }
  assert.match(await scope.locator('.cm-editor').innerText(), /const answer = 42/);

  const disclosure = scope.locator('details').filter({ has: scope.locator('summary', { hasText: 'Show detailed evidence' }) });
  assert.equal(await disclosure.count(), 1, `${prefix}: local aria disclosure converts to native details`);
  assert.equal(await disclosure.evaluate(node => node.open), false, `${prefix}: hidden local disclosure starts closed`);
  await disclosure.locator('summary').click();
  assert.equal(await scope.locator('#detail-panel').isVisible(), true, `${prefix}: local disclosure reveals its target`);
  assert.equal(await scope.locator('script').count(), 0, `${prefix}: document stays script-free`);
}

try {
  for (const fixture of fixtures) {
    const source = await browser.newPage();
    const { html, sourceEditorBounds } = await capture(source, fixture);
    await source.close();
    for (const appFrame of [false, true]) {
      const page = await browser.newPage();
      try {
        await inspectAndInteract(page, fixture, html, sourceEditorBounds, { appFrame });
      } finally {
        await page.close();
      }
    }
    console.log(`HTML interaction regression passed: ${fixture.provider}`);
  }
} finally {
  await browser.close();
}
