import { extractConversation } from './extract.js';

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
        *{box-sizing:border-box}
        #idea-capture-panel{position:fixed;right:16px;bottom:16px;z-index:2147483647;width:min(340px,calc(100vw - 32px));max-height:min(70vh,620px);display:flex;flex-direction:column;background:#fff;color:#18221d;border:1px solid #b9c6be;border-radius:12px;box-shadow:0 8px 32px #10251c33;font:13px/1.4 system-ui,sans-serif}
        [hidden]{display:none!important}
        #idea-capture-panel>header{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid #e0e8e3;font-weight:700}button{font:inherit;cursor:pointer;border:1px solid #ccd8d0;border-radius:6px;background:#f7faf8;color:inherit;padding:5px 8px}button:focus-visible,input:focus-visible{outline:2px solid #19704c;outline-offset:2px}.tools{display:flex;gap:6px;flex-wrap:wrap;padding:9px 12px 4px}.count{padding:2px 14px 8px;color:#506158}.list{overflow:auto;padding:0 8px 10px}.row{display:grid;grid-template-columns:auto 1fr auto;align-items:start;gap:8px;padding:8px 6px;border-top:1px solid #edf1ee}.row input{margin:2px 0 0}.label{overflow-wrap:anywhere}.label small{display:block;color:#65746b;margin-top:2px}.collapse{white-space:nowrap}.empty{padding:8px 14px;color:#506158}.empty p{margin:0 0 10px}
        #idea-capture-margin-controls{position:fixed;top:50%;z-index:2147483646;transform:translateY(-50%);display:grid;gap:6px;padding:9px;background:#fff;color:#18221d;border:1px solid #b9c6be;border-radius:9px;box-shadow:0 4px 18px #10251c22;font:12px/1.35 system-ui,sans-serif}
        #idea-capture-margin-controls .idea-capture-margin-label{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#506158}
        #idea-capture-margin-controls .idea-capture-margin-select{display:flex;align-items:center;gap:6px;min-width:0}
        #idea-capture-margin-controls input{margin:0;flex:0 0 auto}
        #idea-capture-margin-controls button{width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        #idea-capture-margin-controls[data-compact="true"]{width:44px!important;padding:5px;justify-items:center}
        #idea-capture-margin-controls[data-compact="true"] .idea-capture-margin-label,#idea-capture-margin-controls[data-compact="true"] .idea-capture-margin-select span{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
        #idea-capture-margin-controls[data-compact="true"] .idea-capture-margin-select{height:22px}
        #idea-capture-margin-controls[data-compact="true"] button{width:30px;height:30px;padding:0;font-size:0}
        #idea-capture-margin-controls[data-compact="true"] button::before{font-size:18px;line-height:1;content:"−"}
        #idea-capture-margin-controls[data-compact="true"] button[aria-expanded="false"]::before{content:"+"}
      </style>
      <section id="idea-capture-panel" data-idea-panel aria-label="Conversation sections" hidden>
        <header><span>Choose sections to capture</span><button type="button" data-action="toggle-panel" aria-expanded="false">Open</button></header>
        <div class="panel-body" hidden><div class="tools"><button type="button" data-action="select-all">Select all</button><button type="button" data-action="select-none">Select none</button><button type="button" data-action="collapse-all">Collapse all</button><button type="button" data-action="expand-all">Expand all</button></div><div class="count" aria-live="polite"></div><div class="empty" hidden><p data-empty-message></p><button type="button" data-action="retry">Retry detection</button></div><div class="list"></div></div>
      </section>
      <aside id="idea-capture-margin-controls" aria-label="Current conversation section" hidden>
        <label class="idea-capture-margin-select"><input type="checkbox" data-idea-section-id aria-label="Include current section"><span>Include</span></label>
        <span class="idea-capture-margin-label"></span>
        <button type="button" data-idea-section-id aria-expanded="true">Collapse</button>
      </aside>`;
  }
  const panel = shadow.querySelector('[data-idea-panel]');
  const body = shadow.querySelector('.panel-body');
  const toggleButton = shadow.querySelector('[data-action="toggle-panel"]');
  const rail = shadow.querySelector('#idea-capture-margin-controls');
  const railInput = rail.querySelector('input[data-idea-section-id]');
  const railLabel = rail.querySelector('.idea-capture-margin-label');
  const railButton = rail.querySelector('button[data-idea-section-id]');
  const tools = shadow.querySelector('.tools');
  const list = shadow.querySelector('.list');
  const count = shadow.querySelector('.count');
  const empty = shadow.querySelector('.empty');
  const emptyText = shadow.querySelector('[data-empty-message]');
  const onTogglePanel = () => {
    const open = toggleButton.getAttribute('aria-expanded') !== 'true';
    toggleButton.setAttribute('aria-expanded', String(open));
    toggleButton.textContent = open ? 'Close' : 'Open';
    body.hidden = !open;
  };
  const onRailChange = event => {
    if (event.target !== railInput || !railInput.dataset.ideaSectionId) return;
    selected.set(railInput.dataset.ideaSectionId, railInput.checked);
    render();
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
    if (action === 'select-all' || action === 'select-none') for (const section of sections) selected.set(section.id, action === 'select-all');
    if (action === 'collapse-all' || action === 'expand-all') for (const section of sections) collapsed.set(section.id, action === 'collapse-all');
    render();
  };
  const onEmptyClick = event => {
    if (event.target.closest('button')?.dataset.action === 'retry') refresh();
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
    if (!button) return;
    const id = button.dataset.ideaSectionId;
    activeSectionId = id;
    preserveActiveSection = true;
    collapsed.set(id, !collapsed.get(id));
    render();
  };
  toggleButton.addEventListener('click', onTogglePanel);
  rail.addEventListener('change', onRailChange);
  rail.addEventListener('click', onRailClick);
  tools.addEventListener('click', onToolsClick);
  empty.addEventListener('click', onEmptyClick);
  list.addEventListener('change', onListChange);
  list.addEventListener('click', onListClick);
  doc.addEventListener('change', onDocChange);
  doc.addEventListener('click', onDocClick);

  function render() {
    count.textContent = `${sections.filter(section => selected.get(section.id) !== false).length} of ${sections.length} sections selected`;
    panel.hidden = false;
    empty.hidden = sections.length > 0;
    emptyText.textContent = emptyMessage;
    tools.hidden = sections.length === 0;
    count.hidden = sections.length === 0;
    list.hidden = sections.length === 0;
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
  function syncHeaders() {
    const currentIds = new Set(sections.map(section => section.id));
    for (const [id, header] of headers) if (!currentIds.has(id)) { header.remove(); headers.delete(id); }
    for (const section of sections) {
      const anchor = collapseTargets(section)[0] || section.nodes[0];
      if (!anchor?.parentNode) continue;
      let header = headers.get(section.id);
      if (!header) {
        header = doc.createElement('div'); header.className = HEADER_CLASS; header.dataset.ideaCaptureControl = 'true'; header.setAttribute(OWNED, 'header');
        const input = doc.createElement('input'); input.type = 'checkbox'; input.dataset.ideaSectionId = section.id;
        input.setAttribute('aria-label', `Include section: ${section.label}`);
        const label = doc.createElement('span'); label.className = 'idea-capture-section-label';
        const button = doc.createElement('button'); button.type = 'button'; button.dataset.ideaSectionId = section.id;
        header.append(input, label, button); headers.set(section.id, header);
      }
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
    const foreignNodes = sections.filter(candidate => candidate.id !== section.id).flatMap(candidate => candidate.nodes);
    const targets = new Set();
    for (const node of section.nodes) {
      const candidates = [];
      for (let ancestor = node.parentElement; ancestor && ancestor !== doc.body && ancestor !== doc.documentElement; ancestor = ancestor.parentElement) {
        if (!ancestor.matches('article, [data-testid^="conversation-turn-"], [data-turn-id], [data-message-id]')) continue;
        if (foreignNodes.some(foreign => ancestor.contains(foreign))) continue;
        if (ancestor.querySelector('textarea, input, [contenteditable="true"], [role="textbox"]')) continue;
        candidates.push(ancestor);
      }
      targets.add(candidates.at(-1) || node);
    }
    return [...targets];
  }
  function applyCollapse() {
    for (const section of sections) for (const node of collapseTargets(section)) {
      if (!classStates.has(node)) classStates.set(node, node.classList.contains(COLLAPSED_CLASS));
      node.classList.toggle(COLLAPSED_CLASS, collapsed.get(section.id) === true);
    }
  }
  function median(values) {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
  }
  function contentBounds() {
    const viewport = win.innerWidth || doc.documentElement.clientWidth;
    const maxWidth = viewport * 0.92;
    const main = doc.querySelector('main, [role="main"]');
    if (main) {
      const rect = main.getBoundingClientRect();
      if (rect.width > 0 && rect.width <= maxWidth) {
        cachedContentBounds = { left: rect.left, right: rect.right };
        return cachedContentBounds;
      }
    }
    const rects = [];
    for (const section of sections) for (const node of section.nodes) {
      if (!node.isConnected) continue;
      const descendants = node.querySelectorAll?.('p, [class*="markdown"], [data-testid], [data-message-author-role], user-query, model-response') || [];
      for (const candidate of [node, ...descendants]) {
        const rect = candidate.getBoundingClientRect();
        if (rect.width >= 160 && rect.width <= maxWidth && rect.height > 0) rects.push(rect);
      }
    }
    if (rects.length) {
      cachedContentBounds = { left: median(rects.map(rect => rect.left)), right: median(rects.map(rect => rect.right)) };
      return cachedContentBounds;
    }
    const headerRects = [...headers.values()].map(header => header.getBoundingClientRect()).filter(rect => rect.width >= 116 && rect.width <= maxWidth && rect.height > 0);
    if (headerRects.length) {
      cachedContentBounds = { left: median(headerRects.map(rect => rect.left)), right: median(headerRects.map(rect => rect.right)) };
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
  function syncRail() {
    if (!sections.length) { rail.hidden = true; return; }
    const section = sections.find(candidate => candidate.id === activeSectionId) || sectionAtViewportCenter();
    if (!section) { rail.hidden = true; return; }
    activeSectionId = section.id;
    const bounds = contentBounds();
    const viewport = win.innerWidth || doc.documentElement.clientWidth;
    if (!bounds) { rail.hidden = true; return; }
    const leftSpace = Math.max(0, bounds.left);
    const rightSpace = Math.max(0, viewport - bounds.right);
    const useLeft = leftSpace >= rightSpace;
    const space = useLeft ? leftSpace : rightSpace;
    const compact = space < 128;
    const railWidth = space < 48 ? 40 : compact ? Math.min(48, space - 8) : Math.min(196, space - 12);
    rail.hidden = false;
    rail.style.width = `${railWidth}px`;
    rail.dataset.compact = String(compact || space < 48);
    rail.style.left = space < 48 ? 'auto' : useLeft ? 'auto' : `${Math.max(6, bounds.right + 8)}px`;
    rail.style.right = space < 48 ? '8px' : useLeft ? `${Math.max(6, viewport - bounds.left + 8)}px` : 'auto';
    railInput.dataset.ideaSectionId = section.id;
    railInput.checked = selected.get(section.id) !== false;
    railInput.setAttribute('aria-label', `Include section: ${section.label}`);
    railLabel.textContent = section.label;
    railLabel.title = section.label;
    rail.setAttribute('aria-label', `Current section: ${section.label}`);
    const isCollapsed = collapsed.get(section.id) === true;
    railButton.dataset.ideaSectionId = section.id;
    railButton.textContent = isCollapsed ? 'Expand' : 'Collapse';
    railButton.setAttribute('aria-expanded', String(!isCollapsed));
    railButton.setAttribute('aria-label', `${isCollapsed ? 'Expand' : 'Collapse'} section: ${section.label}`);
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
    if (preserveActiveSection) syncRail();
    else scheduleActiveSection();
  }
  function restoreClasses() {
    for (const [node, hadClass] of classStates) node.classList.toggle(COLLAPSED_CLASS, hadClass);
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
        selected.clear(); collapsed.clear(); sections = []; activeSectionId = null; preserveActiveSection = false; cachedContentBounds = null; route = nextRoute;
      }
      const previous = sections;
      const discovery = extractConversation(doc, nextRoute, { includeNodes: true, includeMarkdown: false });
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
      for (const section of sections) {
        if (!selected.has(section.id)) selected.set(section.id, true);
        if (!collapsed.has(section.id)) collapsed.set(section.id, false);
      }
      const activeNodes = new Set(sections.flatMap(section => collapseTargets(section)));
      for (const [node, hadClass] of classStates) if (!activeNodes.has(node)) { node.classList.toggle(COLLAPSED_CLASS, hadClass); classStates.delete(node); }
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

  function capture(mode = 'preview') {
    refresh();
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
  return { capture, refresh, destroy() {
    if (destroyed) return;
    destroyed = true;
    observer.disconnect(); win.clearTimeout(timer); win.clearInterval(routePoll);
    win.removeEventListener('popstate', onRoute); win.removeEventListener('hashchange', onRoute);
    doc.removeEventListener('change', onDocChange); doc.removeEventListener('click', onDocClick);
    doc.removeEventListener('scroll', scheduleActiveSection, true); win.removeEventListener('resize', onResize);
    doc.removeEventListener('wheel', onUserScrollIntent, true); doc.removeEventListener('touchstart', onUserScrollIntent, true);
    doc.removeEventListener('keydown', onScrollKeyDown, true);
    doc.removeEventListener('pointerdown', onPointerDown, true);
    if (railFrame) win.cancelAnimationFrame(railFrame);
    rail.removeEventListener('change', onRailChange); rail.removeEventListener('click', onRailClick);
    toggleButton.removeEventListener('click', onTogglePanel); tools.removeEventListener('click', onToolsClick);
    empty.removeEventListener('click', onEmptyClick);
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
    style.textContent = `.${COLLAPSED_CLASS}{display:none!important}.idea-capture-section-header{display:flex;align-items:center;gap:8px;padding:7px 10px;margin:5px 0;background:#eef5f0;border:1px solid #c9d9ce;border-radius:7px;color:#1b3326;font:12px/1.4 system-ui,sans-serif;position:relative;z-index:10}.idea-capture-section-header input{margin:0}.idea-capture-section-label{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.idea-capture-section-header button{font:inherit;cursor:pointer;border:1px solid #b9cbbf;border-radius:5px;background:white;color:inherit;padding:3px 7px}`;
    (doc.head || doc.documentElement).append(style);
  }
  styles.set(doc, style);
  return style;
}
