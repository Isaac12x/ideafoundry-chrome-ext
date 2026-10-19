import { chatGptConversationRoot, extractConversation } from './extract.js';
import { collectDiagnostics } from './diagnostics.js';
import { markdown } from './shared.js';

const HOST_ID = 'idea-capture-controls';
const COLLAPSED_CLASS = 'idea-capture-section-collapsed';
const STYLE_ID = 'idea-capture-section-style';
const HEADER_CLASS = 'idea-capture-section-header';
const OWNED = 'data-idea-capture-owned';
const styles = new WeakMap();

function uniqueId(doc, preferred) {
  if (!doc.getElementById(preferred)) return preferred;
  let suffix = 1;
  while (doc.getElementById(`${preferred}-${suffix}`)) suffix++;
  return `${preferred}-${suffix}`;
}

export function createCaptureControls(doc = document, win = window) {
  let route = win.location.href;
  let sections = [];
  const selected = new Map();
  const collapsed = new Map();
  const headers = new Map();
  const nodeIds = new WeakMap();
  const classStates = new Map();
  let nextNodeId = 1;
  let timer;
  let refreshing = false;
  let destroyed = false;
  let activeSectionId = null;
  let geometryRoot = null;
  const sectionMediaNodes = new Map();
  let railFrame = 0;
  let cachedContentBounds = null;
  let preserveActiveSection = false;
  let emptyMessage = 'No conversation messages found yet. Open a conversation, then retry.';
  let host = doc.querySelector(`[${OWNED}="host"]`);
  if (!host) {
    host = doc.createElement('div');
    host.id = uniqueId(doc, HOST_ID);
    host.setAttribute(OWNED, 'host');
    (doc.body || doc.documentElement).append(host);
  }
  const shadow = host.shadowRoot || host.attachShadow({ mode: 'open' });
  if (!shadow.querySelector('[data-idea-panel]')) {
    shadow.innerHTML = `
      <style>
        :host{color-scheme:light;--paper:#fbfaf5;--ink:#24352b;--muted:#65746a;--line:#d9e0d8;--forest:#285b42;--wash:#edf3ed;font-family:"Avenir Next","Trebuchet MS",sans-serif;font-size:13px;line-height:1.45;color:var(--ink)}
        *,*::before,*::after{box-sizing:border-box}
        [hidden]{display:none!important}
        button,input,textarea{font:inherit;color:inherit}
        button{cursor:pointer}
        #idea-capture-panel{position:fixed;right:clamp(12px,2vw,24px);bottom:clamp(12px,2vw,24px);z-index:2147483647;width:min(440px,calc(100vw - 24px));max-height:min(82vh,820px);display:flex;flex-direction:column;overflow:hidden;background:var(--paper);border:1px solid #c8d3ca;border-radius:10px;box-shadow:0 14px 42px #10251c38,0 2px 8px #10251c12;font-size:13px}
        #idea-capture-panel:has(.panel-body[hidden]){width:min(214px,calc(100vw - 24px));max-height:none}
        #idea-capture-panel>header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 18px;border-bottom:1px solid var(--line);font-family:Georgia,"Iowan Old Style",serif;font-size:18px;font-weight:600;letter-spacing:-.015em}
        #idea-capture-panel>header [data-export-status]{min-width:0;overflow-wrap:anywhere;font-size:clamp(12px,3.4vw,18px)}
        #idea-capture-panel>header.is-busy [data-export-status]{font-family:"Avenir Next","Trebuchet MS",sans-serif;font-size:12px;font-weight:600;color:var(--forest)}
        #idea-capture-panel>header.is-error [data-export-status]{color:#8a3b28}
        #idea-capture-panel:has(.panel-body[hidden])>header{padding:8px 10px;font-family:"Avenir Next","Trebuchet MS",sans-serif;font-size:12px;letter-spacing:0}
        button{min-height:30px;padding:5px 9px;border:1px solid #cbd6ce;border-radius:5px;background:#f5f7f2;font-family:"Avenir Next","Trebuchet MS",sans-serif;font-size:11px;font-weight:600;transition:background-color 120ms ease,border-color 120ms ease,transform 120ms ease}
        button:hover{background:#e8efe8;border-color:#aabcae}
        button:active{transform:translateY(1px)}
        button:focus-visible,input:focus-visible,textarea:focus-visible{outline:2px solid #397650;outline-offset:2px}
        .panel-body{display:block;min-height:0;flex:1;overflow-y:auto;overscroll-behavior:contain}
        .tools{display:flex;gap:6px;flex-wrap:wrap;padding:10px 12px 7px}
        .tools button{min-height:28px;padding:4px 7px;font-size:10px}
        .count{padding:2px 14px 9px;color:var(--muted);font-size:11px}
        .capture-meta{padding:13px 18px 5px}.capture-meta h2{margin:0 0 4px;font:500 19px/1.2 Georgia,"Iowan Old Style",serif;overflow-wrap:anywhere}.capture-meta p{margin:0;color:var(--muted);font-size:11px}.capture-tools{padding:12px 18px 14px;border-top:1px solid var(--line)}.capture-tools .format{display:flex;gap:8px;margin:0 0 10px}.capture-tools label{display:flex;align-items:center;gap:6px;padding:7px 10px;border:1px solid var(--line);background:#f7f7f0;cursor:pointer}.capture-tools label:has(:checked){border-color:var(--forest);background:var(--wash)}.capture-tools .actions{display:grid;grid-template-columns:1fr 1fr;gap:8px}.capture-tools .actions button{min-height:38px;font-size:12px}.capture-tools .actions [data-action="send-kb"]{grid-column:1/-1;background:var(--forest);border-color:var(--forest);color:var(--paper)}.capture-tools .actions [data-action="settings"]{background:transparent}.capture-status{min-height:17px;margin:9px 0 0;color:var(--forest);font-size:11px;overflow-wrap:anywhere}.capture-status.is-error{color:#8a3b28}.preview{margin:0 14px 12px}.preview summary{cursor:pointer;color:var(--muted);font-size:11px}.preview pre{max-height:190px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;background:#f0efe8;padding:10px;font:11px/1.5 ui-monospace,monospace}
        .list:not(:empty){min-height:96px;max-height:min(38vh,360px);overflow:auto;overscroll-behavior:contain;padding:0 10px 12px}
        .row{display:grid;grid-template-columns:17px minmax(0,1fr) auto;align-items:start;gap:9px;padding:10px 5px;border-top:1px solid #e6ebe5}
        .row input{width:15px;height:15px;margin:2px 0 0;accent-color:var(--forest)}
        .label{min-width:0;overflow-wrap:anywhere;font-size:12px;font-weight:550;line-height:1.35}
        .label small{display:block;color:var(--muted);margin-top:3px;font-size:10px;font-weight:400}
        .collapse{min-height:25px;padding:3px 7px;white-space:nowrap;font-size:10px}
        .empty{padding:8px 14px 14px;color:#53645a}
        .empty p{margin:0 0 10px}
        .empty textarea,.diagnostics textarea{display:block;width:100%;min-height:132px;margin-top:8px;padding:9px;border:1px solid var(--line);border-radius:5px;background:#f4f3ec;font:11px/1.45 ui-monospace,monospace;resize:vertical}
        .diagnostics{padding:0 14px 12px;color:var(--muted);font-size:11px}
        .diagnostics:has(p:empty):not(:has(textarea:not([hidden]))){display:none}
        .diagnostics p{margin:0}
        #idea-capture-margin-controls{position:fixed;top:50%;z-index:2147483646;display:block;width:40px;height:40px;padding:2px;transform:translateY(-50%);border:0;border-radius:50%;background:transparent;color:var(--ink);font:12px/1.35 "Avenir Next","Trebuchet MS",sans-serif}
        #idea-capture-margin-controls button{position:relative;display:grid;place-items:center;width:36px;height:36px;min-height:36px;padding:0;border:1px solid #c7d3c9;border-radius:50%;background:var(--paper);color:var(--forest);box-shadow:0 3px 12px #10251c2b;transition:background-color 120ms ease,border-color 120ms ease,transform 120ms ease}
        #idea-capture-margin-controls button::after{position:absolute;top:50%;left:50%;width:7px;height:10px;content:"";background:currentColor;clip-path:polygon(0 0,2px 0,7px 5px,2px 10px,0 10px,5px 5px);transform:translate(-50%,-50%)}
        #idea-capture-margin-controls button[data-direction="left"]::after{transform:translate(-50%,-50%) scaleX(-1)}
        #idea-capture-margin-controls button:hover{background:var(--wash);border-color:#9db5a3}
        #idea-capture-margin-controls button:active{transform:scale(.96)}
        @media(max-width:420px){#idea-capture-panel{right:10px;bottom:10px;width:calc(100vw - 20px);max-height:82vh}#idea-capture-panel>header{padding:12px 13px}.tools{padding-inline:10px}.tools button{font-size:9px}.capture-meta{padding-inline:14px}.capture-tools{padding-inline:14px}}
        @media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;transition:none!important}}
      </style>
      <section id="idea-capture-panel" data-idea-panel aria-label="Conversation capture" hidden>
        <header><span data-export-status>IdeaFoundry / Capture</span><button type="button" data-action="toggle-panel" aria-expanded="false">Open</button></header>
        <div class="panel-body" hidden><div class="capture-meta"><h2 data-title>Conversation capture</h2><p data-summary></p><p data-warning></p></div><div class="tools"><button type="button" data-action="select-all">Select all</button><button type="button" data-action="select-none">Select none</button><button type="button" data-action="collapse-all">Collapse all</button><button type="button" data-action="expand-all">Expand all</button><button type="button" data-action="copy-diagnostics">Copy diagnostics</button></div><div class="count" aria-live="polite"></div><div class="empty" hidden><p data-empty-message></p><button type="button" data-action="retry">Retry detection</button><button type="button" data-action="copy-diagnostics">Copy diagnostics</button></div><div class="diagnostics"><p data-diagnostics-status aria-live="polite"></p><textarea data-diagnostics-fallback readonly hidden aria-label="Diagnostics to copy manually"></textarea></div><details class="preview" data-preview><summary>Review captured conversation</summary><pre data-preview-text></pre></details><div class="list"></div><div class="capture-tools"><div class="format" role="group" aria-label="File format"><label><input type="radio" name="format" value="md" checked> Markdown</label><label><input type="radio" name="format" value="pdf"> PDF</label></div><div class="actions"><button type="button" data-action="download">Download file</button><button type="button" data-action="settings">Settings</button><button type="button" data-action="send-kb">Send to knowledge base ↗</button></div><p class="capture-status" data-capture-status role="status" aria-live="polite"></p></div></div>
      </section>
      <aside id="idea-capture-margin-controls" aria-label="Conversation section controls" hidden>
        <button type="button" data-idea-section-id aria-expanded="true" aria-label="Collapse current section"></button>
      </aside>`;
  }
  const panel = shadow.querySelector('[data-idea-panel]');
  const body = shadow.querySelector('.panel-body');
  const toggleButton = shadow.querySelector('[data-action="toggle-panel"]');
  const rail = shadow.querySelector('#idea-capture-margin-controls');
  const railButton = rail.querySelector('button[data-idea-section-id]');
  const tools = shadow.querySelector('.tools');
  const list = shadow.querySelector('.list');
  const count = shadow.querySelector('.count');
  const empty = shadow.querySelector('.empty');
  const emptyText = shadow.querySelector('[data-empty-message]');
  const diagnosticsStatus = shadow.querySelector('[data-diagnostics-status]');
  const diagnosticsFallback = shadow.querySelector('[data-diagnostics-fallback]');
  const title = shadow.querySelector('[data-title]');
  const summary = shadow.querySelector('[data-summary]');
  const warning = shadow.querySelector('[data-warning]');
  const preview = shadow.querySelector('[data-preview]');
  const previewText = shadow.querySelector('[data-preview-text]');
  const captureStatus = shadow.querySelector('[data-capture-status]');
  const exportStatus = shadow.querySelector('[data-export-status]');
  const panelHeader = shadow.querySelector('#idea-capture-panel>header');
  const captureActions = shadow.querySelector('.capture-tools');
  const defaultHeaderLabel = 'IdeaFoundry / Capture';
  let busy = false;
  function setExportFeedback(message, tone = 'idle') {
    exportStatus.textContent = message || defaultHeaderLabel;
    panelHeader.classList.toggle('is-busy', tone === 'busy');
    panelHeader.classList.toggle('is-error', tone === 'error');
    if (tone === 'idle' && !message) exportStatus.textContent = defaultHeaderLabel;
  }
  async function request(message) {
    if (!win.chrome?.runtime?.id) throw new Error('Extension was updated or reloaded. Refresh this page and try again.');
    let result;
    try {
      result = await win.chrome.runtime.sendMessage(message);
    } catch (error) {
      const msg = error?.message || String(error);
      if (/context invalidated|extension context invalidated/i.test(msg)) throw new Error('Extension was updated or reloaded. Refresh this page and try again.');
      throw error;
    }
    if (!result?.ok) throw new Error(result?.error || 'IdeaFoundry did not respond.');
    return result;
  }
  function ensurePanelOpen() {
    if (toggleButton.getAttribute('aria-expanded') === 'true') return;
    toggleButton.setAttribute('aria-expanded', 'true');
    toggleButton.textContent = 'Close';
    body.hidden = false;
  }
  function showCaptureStatus(message, tone = 'idle') {
    captureStatus.textContent = message;
    captureStatus.classList.toggle('is-error', tone === 'error');
    captureStatus.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  function updateMetadata() {
    try {
      const conversation = capture('preview', false);
      title.textContent = conversation.title || 'Conversation capture';
      summary.textContent = `${conversation.provider} · ${conversation.messages.length} messages · ${sections.filter(section => selected.get(section.id) !== false).length} of ${sections.length} sections`;
      warning.textContent = conversation.warning || '';
      preview.hidden = !conversation.messages.length;
      previewText.textContent = markdown(conversation);
    } catch (error) {
      title.textContent = 'Conversation capture';
      summary.textContent = 'The page is ready for another detection attempt.';
      warning.textContent = error?.message || '';
      preview.hidden = true;
      previewText.textContent = '';
    }
  }
  async function exportFromWidget(destination) {
    if (busy) return;
    busy = true;
    ensurePanelOpen();
    panel.hidden = false;
    const sendButton = captureActions.querySelector('[data-action="send-kb"]');
    const downloadButton = captureActions.querySelector('[data-action="download"]');
    const activeButton = destination === 'kb' ? sendButton : downloadButton;
    for (const button of captureActions.querySelectorAll('button')) button.disabled = true;
    try {
      const format = shadow.querySelector('[name="format"]:checked')?.value || 'md';
      const busyMessage = destination === 'kb' ? 'Sending to your knowledge base…' : 'Preparing your file…';
      setExportFeedback(busyMessage, 'busy');
      showCaptureStatus(busyMessage, 'busy');
      if (activeButton) activeButton.textContent = destination === 'kb' ? 'Sending…' : 'Preparing…';
      const conversation = await capture('export');
      if (conversation.media?.length) {
        setExportFeedback('Reading page media…', 'busy');
        showCaptureStatus('Reading page media…', 'busy');
        const resolved = await resolvePageMedia(conversation.media);
        const byId = new Map(resolved.map(item => [item.id, item]));
        conversation.media = conversation.media.map(item => byId.has(item.id) ? { ...item, ...byId.get(item.id) } : item);
      }
      if (destination === 'kb') {
        setExportFeedback('Uploading to your knowledge base…', 'busy');
        showCaptureStatus('Uploading to your knowledge base…', 'busy');
      }
      const result = await request({ type: 'widget-export', destination, format, conversation });
      const successMessage = destination === 'kb'
        ? `Saved to knowledge base: ${result.name}${result.appUrl ? `. Open ${result.appUrl}` : ''}`
        : 'Download started.';
      setExportFeedback(destination === 'kb' ? `Saved: ${result.name}` : 'Download started.', 'idle');
      showCaptureStatus(successMessage, 'idle');
    } catch (error) {
      setExportFeedback(error.message, 'error');
      showCaptureStatus(error.message, 'error');
    }
    finally {
      busy = false;
      if (sendButton) sendButton.textContent = 'Send to knowledge base ↗';
      if (downloadButton) downloadButton.textContent = 'Download file';
      for (const button of captureActions.querySelectorAll('button')) button.disabled = false;
    }
  }
  async function resolvePageMedia(items) {
    const results = [];
    let total = 0;
    for (const item of items) {
      let url;
      try { url = new URL(item.url, win.location.href); } catch { continue; }
      if (url.username || url.password) { results.push({ id: item.id, error: 'Media URL contains embedded credentials and was omitted.' }); continue; }
      if (!(url.protocol === 'blob:' || ((url.protocol === 'http:' || url.protocol === 'https:') && url.origin === win.location.origin))) continue;
      try {
        const response = await win.fetch(url.href, { credentials: 'same-origin', redirect: 'error', signal: AbortSignal.timeout(15_000) });
        if (!response.ok) throw new Error(`Page media read failed (${response.status}).`);
        const reader = response.body.getReader(); const chunks = []; let size = 0;
        while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; total += value.byteLength; if (size > 8 * 1024 * 1024 || total > 8 * 1024 * 1024) { await reader.cancel(); throw new Error('Page-owned media exceeds the 8 MB capture limit.'); } chunks.push(value); }
        const blob = new win.Blob(chunks, { type: response.headers.get('content-type') || item.mime || '' });
        const data = await new Promise((resolve, reject) => { const reader = new win.FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error('Could not read page media.')); reader.readAsDataURL(blob); });
        results.push({ id: item.id, data, mime: blob.type || item.mime || 'application/octet-stream' });
      } catch (error) { results.push({ id: item.id, error: error.message }); }
    }
    return results;
  }
  const onTogglePanel = () => {
    const open = toggleButton.getAttribute('aria-expanded') !== 'true';
    toggleButton.setAttribute('aria-expanded', String(open));
    toggleButton.textContent = open ? 'Close' : 'Open';
    body.hidden = !open;
  };
  const onRailClick = event => {
    if (event.target !== railButton || !railButton.dataset.ideaSectionId) return;
    const id = railButton.dataset.ideaSectionId;
    activeSectionId = id;
    preserveActiveSection = true;
    collapsed.set(id, !collapsed.get(id));
    render();
  };
  const onToolsClick = event => {
    const action = event.target.closest('button')?.dataset.action;
    if (!action) return;
    if (action === 'retry') { refresh(); return; }
    if (action === 'copy-diagnostics') { void copyDiagnostics(); return; }
    if (action === 'select-all' || action === 'select-none') for (const section of sections) selected.set(section.id, action === 'select-all');
    if (action === 'collapse-all' || action === 'expand-all') for (const section of sections) collapsed.set(section.id, action === 'collapse-all');
    render();
  };
  const onEmptyClick = event => {
    const action = event.target.closest('button')?.dataset.action;
    if (action === 'retry') refresh();
    if (action === 'copy-diagnostics') void copyDiagnostics();
  };
  const onCaptureClick = event => {
    const action = event.target.closest('button')?.dataset.action;
    if (action === 'download' || action === 'send-kb') void exportFromWidget(action === 'send-kb' ? 'kb' : 'download');
    if (action === 'settings') void request({ type: 'open-settings' }).catch(error => { showCaptureStatus(error.message, 'error'); setExportFeedback(error.message, 'error'); });
  };
  const onListChange = event => {
    const input = event.target.closest('input[data-section-id]');
    if (!input) return;
    selected.set(input.dataset.sectionId, input.checked);
    render();
  };
  const onListClick = event => {
    const button = event.target.closest('button[data-section-id]');
    if (!button) return;
    const id = button.dataset.sectionId;
    activeSectionId = id;
    preserveActiveSection = true;
    collapsed.set(id, !collapsed.get(id));
    render();
  };
  const onDocChange = event => {
    const input = event.target.closest?.('input[data-idea-section-id]');
    if (!input) return;
    selected.set(input.dataset.ideaSectionId, input.checked);
    render();
  };
  const onDocClick = event => {
    const button = event.target.closest?.('button[data-idea-section-id]');
    if (button) {
      event.stopPropagation();
      const id = button.dataset.ideaSectionId;
      activeSectionId = id;
      preserveActiveSection = true;
      collapsed.set(id, !collapsed.get(id));
      render();
      return;
    }
    const section = sectionAtMarginPoint(event);
    if (!section) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    const id = section.id;
    activeSectionId = id;
    preserveActiveSection = true;
    collapsed.set(id, !collapsed.get(id));
    render();
  };
  toggleButton.addEventListener('click', onTogglePanel);
  rail.addEventListener('click', onRailClick);
  tools.addEventListener('click', onToolsClick);
  empty.addEventListener('click', onEmptyClick);
  captureActions.addEventListener('click', onCaptureClick);
  list.addEventListener('change', onListChange);
  list.addEventListener('click', onListClick);
  doc.addEventListener('change', onDocChange);
  doc.addEventListener('click', onDocClick, true);

  function render() {
    count.textContent = `${sections.filter(section => selected.get(section.id) !== false).length} of ${sections.length} sections selected`;
    panel.hidden = false;
    empty.hidden = sections.length > 0;
    emptyText.textContent = emptyMessage;
    tools.hidden = sections.length === 0;
    count.hidden = sections.length === 0;
    list.hidden = sections.length === 0;
    updateMetadata();
    const active = shadow.activeElement;
    const activeSection = active?.dataset?.sectionId;
    const activeKind = active?.matches?.('input') ? 'input' : active?.matches?.('button[data-section-id]') ? 'button' : null;
    const currentIds = new Set(sections.map(section => section.id));
    for (const row of [...list.children]) if (!currentIds.has(row.dataset.sectionId)) row.remove();
    for (const section of sections) {
      let row = [...list.children].find(child => child.dataset.sectionId === section.id);
      if (!row) {
        row = doc.createElement('div'); row.className = 'row'; row.dataset.sectionId = section.id;
        const input = doc.createElement('input'); input.type = 'checkbox'; input.dataset.sectionId = section.id;
        const label = doc.createElement('span'); label.className = 'label';
        const title = doc.createTextNode(''); const detail = doc.createElement('small'); label.append(title, detail);
        const button = doc.createElement('button'); button.type = 'button'; button.className = 'collapse'; button.dataset.sectionId = section.id;
        row.append(input, label, button);
      }
      const input = row.querySelector('input'); input.checked = selected.get(section.id) !== false;
      input.setAttribute('aria-label', `Include section: ${section.label}`);
      const label = row.querySelector('.label');
      if (label.firstChild?.nodeType !== 3) label.insertBefore(doc.createTextNode(''), label.firstChild);
      if (label.firstChild.textContent !== section.label) label.firstChild.textContent = section.label;
      label.querySelector('small').textContent = `${section.messageCount} ${section.messageCount === 1 ? 'message' : 'messages'}`;
      const button = row.querySelector('button');
      const buttonText = collapsed.get(section.id) ? 'Expand' : 'Collapse';
      if (button.textContent !== buttonText) button.textContent = buttonText;
      button.setAttribute('aria-expanded', String(!collapsed.get(section.id)));
      button.setAttribute('aria-label', `${buttonText} section: ${section.label}`);
      list.append(row);
    }
    syncHeaders();
    applyCollapse();
    syncRail();
    if (activeSection && activeKind) [...list.children].find(row => row.dataset.sectionId === activeSection)?.querySelector(activeKind === 'input' ? 'input' : 'button')?.focus();
  }
  async function copyDiagnostics() {
    const text = JSON.stringify(collectDiagnostics(doc, win.location.href), null, 2);
    diagnosticsFallback.value = '';
    diagnosticsFallback.hidden = true;
    diagnosticsStatus.textContent = '';
    try {
      if (!win.navigator?.clipboard?.writeText) throw new Error('Clipboard API unavailable');
      await win.navigator.clipboard.writeText(text);
      diagnosticsStatus.textContent = 'Diagnostics copied to clipboard.';
    } catch {
      diagnosticsFallback.value = text;
      diagnosticsFallback.hidden = false;
      diagnosticsStatus.textContent = 'Clipboard access failed. Select and copy the diagnostics below.';
      diagnosticsFallback.focus();
      diagnosticsFallback.select();
    }
  }
  function syncHeaders() {
    const currentIds = new Set(sections.map(section => section.id));
    for (const [id, header] of headers) if (!currentIds.has(id)) { header.remove(); headers.delete(id); }
    for (const section of sections) {
      const targets = collapseTargets(section);
      const anchor = targets.reduce((earliest, node) => {
        if (!earliest) return node;
        return earliest.compareDocumentPosition(node) & 4 ? earliest : node;
      }, null) || section.nodes[0];
      if (!anchor?.parentNode) continue;
      const visualOrder = win.getComputedStyle?.(anchor).order;
      let header = headers.get(section.id);
      if (!header) {
        header = doc.createElement('div'); header.className = HEADER_CLASS; header.dataset.ideaCaptureControl = 'true'; header.setAttribute(OWNED, 'header');
        const input = doc.createElement('input'); input.type = 'checkbox'; input.dataset.ideaSectionId = section.id;
        input.setAttribute('aria-label', `Include section: ${section.label}`);
        const label = doc.createElement('span'); label.className = 'idea-capture-section-label';
        const button = doc.createElement('button'); button.type = 'button'; button.dataset.ideaSectionId = section.id;
        header.append(input, label, button); headers.set(section.id, header);
      }
      if (visualOrder) header.style.order = visualOrder;
      if (header.parentNode !== anchor.parentNode || header.nextSibling !== anchor) anchor.parentNode.insertBefore(header, anchor);
      const input = header.querySelector('input'); input.checked = selected.get(section.id) !== false;
      input.setAttribute('aria-label', `Include section: ${section.label}`);
      const label = header.querySelector('.idea-capture-section-label');
      if (label.textContent !== section.label) label.textContent = section.label;
      const button = header.querySelector('button');
      const buttonText = collapsed.get(section.id) ? 'Expand' : 'Collapse';
      if (button.textContent !== buttonText) button.textContent = buttonText;
      button.setAttribute('aria-expanded', String(!collapsed.get(section.id)));
      button.setAttribute('aria-label', `${buttonText} section: ${section.label}`);
    }
  }
  function collapseTargets(section) {
    const foreignNodes = sections.filter(candidate => candidate.id !== section.id)
      .flatMap(candidate => [...candidate.nodes, ...(candidate.collapseNodes || [])]);
    const safeCollapseNode = node => node?.isConnected
      && node !== doc.body && node !== doc.documentElement
      && !node.matches?.('main, [role="main"], footer, [role="contentinfo"], nav, [role="navigation"], aside, [role="complementary"]')
      && !foreignNodes.some(foreign => node.contains(foreign))
      && !node.querySelector?.('textarea, input:not([data-idea-section-id]), [contenteditable="true"], [role="textbox"]');
    if (section.collapseNodes?.length) {
      const targets = section.collapseNodes.filter(safeCollapseNode);
      return targets.filter(target => !targets.some(ancestor => ancestor !== target && ancestor.contains(target)));
    }
    const targets = new Set();
    for (const node of section.nodes) {
      if (node.matches?.('article, [data-testid^="conversation-turn-"], [data-turn-id], [data-message-id], [class~="turn"], [class*="assistant-turn"], [class*="agent-turn"]')
        && safeCollapseNode(node)) {
        targets.add(node);
        continue;
      }
      const candidates = [];
      for (let ancestor = node.parentElement; ancestor && ancestor !== doc.body && ancestor !== doc.documentElement; ancestor = ancestor.parentElement) {
        if (!ancestor.matches('article, [data-testid^="conversation-turn-"], [data-turn-id], [data-message-id], [class~="turn"], [class*="assistant-turn"], [class*="agent-turn"]')) continue;
        if (!safeCollapseNode(ancestor)) continue;
        candidates.push(ancestor);
      }
      targets.add(candidates.at(-1) || node);
    }
    return [...targets].filter(target => ![...targets].some(ancestor => ancestor !== target && ancestor.contains(target)));
  }
  function applyCollapse() {
    for (const section of sections) for (const node of collapseTargets(section)) {
      if (!classStates.has(node)) {
        const hadClass = node.classList.contains(COLLAPSED_CLASS);
        classStates.set(node, hadClass);
        node.setAttribute('data-idea-capture-collapse-state', String(hadClass));
      }
      node.classList.toggle(COLLAPSED_CLASS, collapsed.get(section.id) === true);
    }
  }
  function median(values) {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
  }
  function isChatGptPage() {
    return /(^|\.)(chatgpt\.com|chat\.openai\.com)$/i.test(new URL(win.location.href).hostname);
  }
  function conversationGeometryRoot() {
    if (geometryRoot?.isConnected) return geometryRoot;
    geometryRoot = isChatGptPage()
      ? chatGptConversationRoot(doc)
      : doc.querySelector('[role="main"]') || doc.querySelector('main');
    return geometryRoot;
  }
  function isNestedScrollRoot(node) {
    if (!node) return false;
    if (node.matches?.('#thread')) return true;
    const style = win.getComputedStyle?.(node);
    const overflow = `${style?.overflow || ''} ${style?.overflowX || ''} ${style?.overflowY || ''}`;
    return /(auto|scroll|overlay)/.test(overflow) && node.scrollHeight > node.clientHeight;
  }
  function contentBounds() {
    const viewport = win.innerWidth || doc.documentElement.clientWidth;
    const maxWidth = viewport * 0.92;
    const rects = [];
    const section = sections.find(candidate => candidate.id === activeSectionId) || sectionAtViewportCenter();
    for (const node of section?.nodes.slice(0, 3) || []) {
      if (!node.isConnected) continue;
      const layout = node.closest?.('article, [data-testid^="conversation-turn-"], [data-turn-id], [data-message-id], [class~="turn"], [class*="assistant-turn"], [class*="agent-turn"]');
      if (layout && !layout.querySelector('textarea, input, [contenteditable="true"], [role="textbox"]')) {
        const rect = layout.getBoundingClientRect();
        if (rect.width >= 160 && rect.width <= maxWidth && rect.height > 0) rects.push(rect);
      } else {
        const contentSelector = 'p, h1, h2, h3, h4, h5, h6, pre, code, table, blockquote, li, [class*="markdown"], [class*="prose"]';
        const contentNodes = [...(node.matches?.(contentSelector) ? [node] : []), ...(node.querySelectorAll?.(contentSelector) || [])];
        const contentRects = contentNodes.map(content => content.getBoundingClientRect())
          .filter(rect => rect.width >= 160 && rect.width <= maxWidth && rect.height > 0);
        if (contentRects.length) rects.push(...contentRects);
        else {
          const rect = node.getBoundingClientRect();
          if (rect.width >= 160 && rect.width <= maxWidth && rect.height > 0) rects.push(rect);
        }
      }
    }
    if (rects.length) {
      // A section can contain a right-aligned prompt and a wider assistant
      // reply. Median edges can land inside the reply and place the rail over
      // readable text, so reserve the full horizontal span of the section.
      cachedContentBounds = { left: Math.min(...rects.map(rect => rect.left)), right: Math.max(...rects.map(rect => rect.right)) };
      const mediaRects = (sectionMediaNodes.get(section?.id) || [])
        .filter(node => node.isConnected)
        .map(node => node.getBoundingClientRect())
        .filter(rect => rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < (win.innerHeight || doc.documentElement.clientHeight));
      if (mediaRects.length) {
        cachedContentBounds.left = Math.min(cachedContentBounds.left, ...mediaRects.map(rect => Math.max(0, rect.left)));
        cachedContentBounds.right = Math.max(cachedContentBounds.right, ...mediaRects.map(rect => Math.min(viewport, rect.right)));
      }
      return cachedContentBounds;
    }
    const root = isChatGptPage() ? conversationGeometryRoot() : null;
    const rootRect = isNestedScrollRoot(root) ? root.getBoundingClientRect() : null;
    if (rootRect?.width >= 160 && rootRect.width <= maxWidth && rootRect.height > 0) {
      cachedContentBounds = { left: rootRect.left, right: rootRect.right };
      return cachedContentBounds;
    }
    const headerRect = headers.get(section?.id)?.getBoundingClientRect();
    if (headerRect?.width >= 116 && headerRect.width <= maxWidth && headerRect.height > 0) {
      cachedContentBounds = { left: headerRect.left, right: headerRect.right };
      return cachedContentBounds;
    }
    return cachedContentBounds;
  }
  function sectionAtViewportCenter() {
    const center = (win.innerHeight || doc.documentElement.clientHeight) / 2;
    let current = null;
    for (const section of sections) {
      const top = headers.get(section.id)?.getBoundingClientRect().top;
      if (!Number.isFinite(top)) continue;
      if (top <= center) current = section;
      else if (!current) { current = section; break; }
      else break;
    }
    return current || sections[0] || null;
  }
  function sectionAtMarginPoint(event) {
    if (event.button !== undefined && event.button !== 0) return null;
    const x = event.clientX;
    const y = event.clientY;
    const viewportWidth = win.innerWidth || doc.documentElement.clientWidth;
    const viewportHeight = win.innerHeight || doc.documentElement.clientHeight;
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > viewportWidth || y > viewportHeight) return null;
    const target = event.target?.nodeType === 1 ? event.target : event.target?.parentElement;
    if (!target || target === host || host.contains(target) || target.closest?.(`.${HEADER_CLASS},[${OWNED}],a,button,input,textarea,select,[role="button"],[role="link"],[role="textbox"],[role="banner"],[contenteditable="true"],form,header,nav,aside,[role="navigation"],[role="complementary"],#sidebar,#left-sidebar,#right-sidebar,.sidebar,.app-sidebar,.conversation-sidebar,.sidebar-panel,.sidebar-container,[aria-label*="sidebar" i],[data-testid*="sidebar" i],[class*="toolbar" i],[data-testid*="toolbar" i]`)) return null;

    const root = isChatGptPage() ? conversationGeometryRoot() : null;
    const viewportRect = { left: 0, right: viewportWidth, top: 0, bottom: viewportHeight };
    const clippedRect = node => {
      if (!node?.isConnected) return null;
      const raw = node.getBoundingClientRect();
      let left = Math.max(raw.left, viewportRect.left);
      let right = Math.min(raw.right, viewportRect.right);
      let top = Math.max(raw.top, viewportRect.top);
      let bottom = Math.min(raw.bottom, viewportRect.bottom);
      for (let ancestor = node.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const style = win.getComputedStyle?.(ancestor);
        const overflowX = style?.overflowX || style?.overflow || '';
        const overflowY = style?.overflowY || style?.overflow || '';
        if (/(hidden|clip|auto|scroll|overlay)/.test(overflowX) || /(hidden|clip|auto|scroll|overlay)/.test(overflowY)) {
          const clip = ancestor.getBoundingClientRect();
          if (/(hidden|clip|auto|scroll|overlay)/.test(overflowX)) { left = Math.max(left, clip.left); right = Math.min(right, clip.right); }
          if (/(hidden|clip|auto|scroll|overlay)/.test(overflowY)) { top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom); }
        }
        if (ancestor === doc.documentElement) break;
      }
      return right > left && bottom > top ? { left, right, top, bottom, width: right - left, height: bottom - top } : null;
    };
    const rootRect = isNestedScrollRoot(root) ? clippedRect(root) : null;
    if (rootRect && (x < rootRect.left || x > rootRect.right || y < rootRect.top || y > rootRect.bottom)) return null;

    const turnSelector = 'article, [data-testid^="conversation-turn-"], [data-turn-id], [data-message-id], [class~="turn"], [class*="assistant-turn"], [class*="agent-turn"]';
    const contentSelector = 'p, h1, h2, h3, h4, h5, h6, a, img, video, audio, iframe, object, embed, canvas, svg, pre, code, table, blockquote, li, [class*="markdown"], [class*="prose"], [class*="gallery"]';
    const safeTurn = (node, section) => {
      let candidate = null;
      for (let ancestor = node.parentElement; ancestor && ancestor !== doc.body && ancestor !== doc.documentElement; ancestor = ancestor.parentElement) {
        if (!ancestor.matches(turnSelector)) continue;
        const foreignNodes = sections.filter(other => other.id !== section.id).flatMap(other => other.nodes);
        if (foreignNodes.some(foreign => ancestor.contains(foreign))) continue;
        if (ancestor.querySelector('textarea, input, [contenteditable="true"], [role="textbox"]')) continue;
        candidate = ancestor;
        break;
      }
      return candidate;
    };

    for (const section of sections) {
      const rects = [];
      const contentRects = [];
      for (const node of section.nodes) {
        if (!node.isConnected) continue;
        const wrapper = safeTurn(node, section);
        const rect = clippedRect(wrapper || node);
        if (rect) rects.push(rect);
        const contentRoots = new Set([node, ...(wrapper ? [wrapper] : [])]);
        for (const contentRoot of contentRoots) {
          if (contentRoot.matches?.(contentSelector)) {
            const ownRect = clippedRect(contentRoot);
            if (ownRect?.width >= 16) contentRects.push(ownRect);
          }
          for (const candidate of contentRoot.querySelectorAll?.(contentSelector) || []) {
            const childRect = clippedRect(candidate);
            if (childRect?.width >= 16) contentRects.push(childRect);
          }
        }
      }
      const headerRect = clippedRect(headers.get(section.id));
      if (headerRect) rects.push(headerRect);
      if (!rects.length) continue;
      const top = Math.min(...rects.map(rect => rect.top));
      const bottom = Math.max(...rects.map(rect => rect.bottom));
      if (y < top || y > bottom) continue;
      const horizontalRects = contentRects.length ? contentRects : rects;
      const contentLeft = median(horizontalRects.map(rect => rect.left));
      const contentRight = median(horizontalRects.map(rect => rect.right));
      if (!Number.isFinite(contentLeft) || !Number.isFinite(contentRight)) continue;
      if (contentRects.some(rect => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom)) return null;
      if (x < contentLeft - 8 || x > contentRight + 8) return section;
    }
    return null;
  }
  function syncRail() {
    if (!sections.length) { rail.hidden = true; return; }
    const section = sections.find(candidate => candidate.id === activeSectionId) || sectionAtViewportCenter();
    if (!section || collapsed.get(section.id) === true) { rail.hidden = true; return; }
    activeSectionId = section.id;
    const bounds = contentBounds();
    const viewport = win.innerWidth || doc.documentElement.clientWidth;
    if (!bounds) { rail.hidden = true; return; }
    const root = isChatGptPage() ? conversationGeometryRoot() : null;
    const rootRect = root?.getBoundingClientRect();
    const clampToRoot = isNestedScrollRoot(root) && rootRect?.width > 0;
    const rootLeft = clampToRoot ? Math.max(0, rootRect.left) : 0;
    const rootRight = clampToRoot ? Math.min(viewport, rootRect.right) : viewport;
    const leftSpace = Math.max(0, bounds.left - rootLeft);
    const rightSpace = Math.max(0, rootRight - bounds.right);
    if (Math.max(leftSpace, rightSpace) < 48) { rail.hidden = true; return; }
    const useLeft = leftSpace >= rightSpace;
    const space = useLeft ? leftSpace : rightSpace;
    const railWidth = 38;
    if (space < railWidth + 8) { rail.hidden = true; return; }
    rail.hidden = false;
    rail.style.width = `${railWidth}px`;
    rail.style.left = useLeft ? 'auto' : `${Math.max(6, bounds.right + 4)}px`;
    rail.style.right = useLeft ? `${Math.max(6, viewport - bounds.left + 4)}px` : 'auto';
    railButton.dataset.ideaSectionId = section.id;
    rail.setAttribute('aria-label', `Current section: ${section.label}`);
    railButton.dataset.direction = useLeft ? 'right' : 'left';
    railButton.setAttribute('aria-expanded', 'true');
    railButton.setAttribute('aria-label', `Collapse section: ${section.label}`);
    railButton.title = `Collapse section: ${section.label}`;
  }
  function updateActiveSection() {
    if (destroyed || !sections.length) return;
    const section = sectionAtViewportCenter();
    if (section) activeSectionId = section.id;
    syncRail();
  }
  function scheduleActiveSection() {
    if (preserveActiveSection) return;
    if (railFrame) return;
    railFrame = win.requestAnimationFrame(() => { railFrame = 0; updateActiveSection(); });
  }
  function isOwnControlEvent(event) {
    const target = event?.target;
    return target === host || host.contains(target) || !!target?.closest?.(`.${HEADER_CLASS},[${OWNED}]`);
  }
  function onUserScrollIntent(event) {
    if (isOwnControlEvent(event)) return;
    preserveActiveSection = false;
    scheduleActiveSection();
  }
  function onScrollKeyDown(event) {
    if (['PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', 'Home', 'End', ' '].includes(event.key)) onUserScrollIntent(event);
  }
  function onPointerDown(event) { onUserScrollIntent(event); }
  function onResize() {
    cachedContentBounds = null;
    if (preserveActiveSection) syncRail();
    else scheduleActiveSection();
  }
  function restoreClasses() {
    for (const [node, hadClass] of classStates) {
      node.classList.toggle(COLLAPSED_CLASS, hadClass);
      node.removeAttribute('data-idea-capture-collapse-state');
    }
    classStates.clear();
  }
  function refresh() {
    if (refreshing || destroyed) return;
    refreshing = true;
    try {
      const nextRoute = win.location.href;
      if (route !== nextRoute) {
        restoreClasses();
        for (const header of headers.values()) header.remove(); headers.clear();
        selected.clear(); collapsed.clear(); sections = []; sectionMediaNodes.clear(); activeSectionId = null; preserveActiveSection = false; cachedContentBounds = null; geometryRoot = null; route = nextRoute;
      }
      const previous = sections;
      const discovery = extractConversation(doc, nextRoute, { includeNodes: true, includeMarkdown: false });
      geometryRoot = isChatGptPage() ? chatGptConversationRoot(doc) : doc.querySelector('[role="main"]') || doc.querySelector('main');
      emptyMessage = 'No conversation messages found yet. If the conversation is still loading, retry in a moment.';
      const usedFallback = new Set();
      sections = discovery.sections.map(section => {
        const anchor = section.identityNode || section.nodes[0];
        const stable = nodeIds.get(anchor);
        let id = section.id;
        if (section.id.startsWith('section-') && !section.id.startsWith('section-provider-')) {
          if (stable) id = stable;
          else {
            const overlapping = previous.filter(candidate => !usedFallback.has(candidate.id)
              && candidate.label === section.label
              && candidate.identityNode
              && !candidate.identityNode.isConnected
              && candidate.nodes.some(node => section.nodes.includes(node)));
            const old = overlapping.length === 1
              ? overlapping[0]
              : previous.find(candidate => !usedFallback.has(candidate.id) && candidate.label === section.label && candidate.nodes.every(node => !node.isConnected));
            id = old?.id || `section-node-${nextNodeId++}`;
            nodeIds.set(anchor, id);
            if (old) usedFallback.add(old.id);
          }
        }
        if (!nodeIds.has(anchor)) nodeIds.set(anchor, id);
        return { ...section, id };
      });
      sectionMediaNodes.clear();
      const turnSelector = 'article, [data-testid^="conversation-turn-"], [data-turn-id], [data-message-id], [class~="turn"], [class*="assistant-turn"], [class*="agent-turn"]';
      for (const section of sections) {
        const media = new Set();
        const foreignNodes = sections.filter(candidate => candidate.id !== section.id).flatMap(candidate => candidate.nodes);
        for (const node of section.nodes) {
          const wrapper = node.closest?.(turnSelector);
          const contentRoot = wrapper && foreignNodes.some(foreign => wrapper.contains(foreign)) ? node : wrapper || node;
          if (contentRoot.querySelector('textarea, input, [contenteditable="true"], [role="textbox"]')) continue;
          const mediaSelector = 'img[src], img[srcset], video, audio, iframe, object, embed, canvas, svg[aria-label]';
          if (contentRoot.matches?.(mediaSelector)) media.add(contentRoot);
          for (const candidate of contentRoot.querySelectorAll(mediaSelector)) media.add(candidate);
        }
        if (media.size) sectionMediaNodes.set(section.id, [...media]);
      }
      for (const section of sections) {
        if (!selected.has(section.id)) selected.set(section.id, true);
        if (!collapsed.has(section.id)) collapsed.set(section.id, false);
      }
      const activeNodes = new Set(sections.flatMap(section => collapseTargets(section)));
      for (const [node, hadClass] of classStates) if (!activeNodes.has(node)) { node.classList.toggle(COLLAPSED_CLASS, hadClass); node.removeAttribute('data-idea-capture-collapse-state'); classStates.delete(node); }
      render();
    } catch (error) {
      restoreClasses();
      sections = [];
      activeSectionId = null;
      emptyMessage = error?.message || 'No conversation messages found yet. Retry detection after the page finishes loading.';
      render();
    } finally { refreshing = false; }
  }
  function scheduleRefresh() { clearTimeout(timer); timer = win.setTimeout(refresh, 160); }
  const observer = new win.MutationObserver(records => {
    const relevant = records.some(record => {
      if (host.contains(record.target) || record.target.closest?.(`.${HEADER_CLASS}`)) return false;
      if (record.type === 'childList' && [...record.addedNodes, ...record.removedNodes].every(node => node.nodeType === 1 && node.matches?.(`.${HEADER_CLASS},[${OWNED}]`))) return false;
      return true;
    });
    if (relevant) scheduleRefresh();
  });
  observer.observe(doc.body || doc.documentElement, { subtree: true, childList: true, characterData: true });
  const onRoute = scheduleRefresh;
  doc.addEventListener('scroll', scheduleActiveSection, true);
  doc.addEventListener('wheel', onUserScrollIntent, { capture: true, passive: true });
  doc.addEventListener('touchstart', onUserScrollIntent, { capture: true, passive: true });
  doc.addEventListener('keydown', onScrollKeyDown, true);
  doc.addEventListener('pointerdown', onPointerDown, true);
  win.addEventListener('resize', onResize);
  win.addEventListener('popstate', onRoute);
  win.addEventListener('hashchange', onRoute);
  const routePoll = win.setInterval(() => { if (route !== win.location.href) refresh(); }, 700);
  refresh();

  function capture(mode = 'preview', shouldRefresh = true) {
    if (shouldRefresh) refresh();
    const conversation = extractConversation(doc, win.location.href, { includeNodes: true });
    const idByRaw = new Map();
    conversation.sections.forEach(section => {
      const identity = section.identityNode || section.nodes[0];
      const id = nodeIds.get(identity) || section.id;
      idByRaw.set(section.id, id);
    });
    conversation.messages = conversation.messages.map(message => ({ ...message, sectionId: idByRaw.get(message.sectionId) || message.sectionId }));
    conversation.sections = conversation.sections.map(section => {
      const id = idByRaw.get(section.id) || section.id;
      return { id, label: section.label, messageCount: section.messageCount, selected: mode === 'all' || selected.get(id) !== false, collapsed: collapsed.get(id) === true };
    });
    const all = mode === 'all';
    conversation.messages = conversation.messages.filter(message => all || selected.get(message.sectionId) !== false);
    if (mode === 'export' && conversation.messages.length === 0) throw new Error('Select at least one section before exporting.');
    const includedMessageIndexes = new Set(conversation.messages.map(message => message.messageIndex));
    conversation.media = (conversation.media || []).filter(item => includedMessageIndexes.has(item.messageIndex));
    delete conversation.nodes;
    return conversation;
  }
  function open() { toggleButton.setAttribute('aria-expanded', 'true'); toggleButton.textContent = 'Close'; body.hidden = false; panel.hidden = false; refresh(); }
  return { capture, refresh, open, destroy() {
    if (destroyed) return;
    destroyed = true;
    observer.disconnect(); win.clearTimeout(timer); win.clearInterval(routePoll);
    win.removeEventListener('popstate', onRoute); win.removeEventListener('hashchange', onRoute);
    doc.removeEventListener('change', onDocChange); doc.removeEventListener('click', onDocClick, true);
    doc.removeEventListener('scroll', scheduleActiveSection, true); win.removeEventListener('resize', onResize);
    doc.removeEventListener('wheel', onUserScrollIntent, true); doc.removeEventListener('touchstart', onUserScrollIntent, true);
    doc.removeEventListener('keydown', onScrollKeyDown, true);
    doc.removeEventListener('pointerdown', onPointerDown, true);
    if (railFrame) win.cancelAnimationFrame(railFrame);
    rail.removeEventListener('click', onRailClick);
    toggleButton.removeEventListener('click', onTogglePanel); tools.removeEventListener('click', onToolsClick);
    empty.removeEventListener('click', onEmptyClick);
    captureActions.removeEventListener('click', onCaptureClick);
    list.removeEventListener('change', onListChange); list.removeEventListener('click', onListClick);
    restoreClasses();
    for (const header of headers.values()) header.remove(); headers.clear();
    const style = styles.get(doc); style?.remove(); styles.delete(doc);
    host.remove();
  } };
}

export function installCollapseStyle(doc = document) {
  const existing = styles.get(doc);
  if (existing?.isConnected) return existing;
  let style = doc.querySelector(`style[${OWNED}="style"]`);
  if (!style) {
    style = doc.createElement('style');
    if (!doc.getElementById(STYLE_ID)) style.id = STYLE_ID;
    style.setAttribute(OWNED, 'style');
    style.textContent = `.${COLLAPSED_CLASS}{display:none!important}
      .idea-capture-section-header{box-sizing:border-box;display:flex;align-items:center;gap:9px;width:min(100%,720px);min-height:38px;padding:6px 9px;margin:7px auto;background:#f4f6f0;border:1px solid #d5dfd5;border-radius:5px;color:#293b30;font:12px/1.4 "Avenir Next","Trebuchet MS",sans-serif;position:relative;z-index:10;box-shadow:0 1px 2px #10251c0a}
      .idea-capture-section-header input{appearance:auto!important;-webkit-appearance:checkbox!important;display:inline-block!important;visibility:visible!important;opacity:1!important;width:16px!important;height:16px!important;min-width:16px!important;min-height:16px!important;margin:0!important;accent-color:#285b42;flex:0 0 16px}
      .idea-capture-section-label{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:550}
      .idea-capture-section-header button{min-height:27px;padding:3px 8px;font:600 10px/1.2 "Avenir Next","Trebuchet MS",sans-serif;cursor:pointer;border:1px solid #ccd8ce;border-radius:4px;background:#fbfaf5;color:inherit;white-space:nowrap}
      .idea-capture-section-header button:hover{background:#e8efe8}
      .idea-capture-section-header button:focus-visible,.idea-capture-section-header input:focus-visible{outline:2px solid #397650;outline-offset:2px}
      @media(max-width:520px){.idea-capture-section-header{gap:7px;padding-inline:7px;margin-block:5px}.idea-capture-section-header button{font-size:9px;padding-inline:6px}}`;
    (doc.head || doc.documentElement).append(style);
  }
  styles.set(doc, style);
  return style;
}
