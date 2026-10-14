import manifest from '../manifest.json' with { type: 'json' };
import { chatGptConversationRoot } from './extract.js';

const SAMPLE_LIMIT = 12;
const ANCESTRY_LIMIT = 10;
const ROOT_LIMIT = 10;

const SELECTORS = {
  conversationRoot: '#thread, main, [role="main"]',
  messageRole: '[data-message-author-role], [data-role="user"], [data-role="assistant"], [data-turn-role]',
  conversationTurn: '[data-testid^="conversation-turn-"], [data-turn-id], [data-message-id]',
  article: 'article',
  chatGptUserBubble: '.user-message-bubble, [class*="user-message-bubble"]',
  chatGptReportedUserBubble: '.bg-user-message',
  chatGptUserText: '.whitespace-pre-wrap',
  chatGptAssistantText: '.markdown, .prose',
  claudeMessage: '[data-testid="user-message"], [data-is-streaming], .font-claude-response',
  geminiMessage: 'user-query, model-response',
};

function providerFor(hostname) {
  if (/(^|\.)(chatgpt\.com|chat\.openai\.com)$/i.test(hostname)) return 'ChatGPT';
  if (/(^|\.)claude\.ai$/i.test(hostname)) return 'Claude';
  if (hostname.toLowerCase() === 'gemini.google.com') return 'Gemini';
  return 'Other';
}

function safeDescriptor(node, win) {
  const attrs = {};
  for (const name of ['data-testid', 'data-message-author-role', 'data-role', 'data-turn-role', 'data-turn-id', 'data-message-id']) {
    const value = node.getAttribute?.(name);
    if (value) attrs[name] = value.slice(0, 80);
  }
  const rawClass = typeof node.className === 'string' ? node.className : node.getAttribute?.('class') || '';
  const descriptor = {
    tag: String(node.tagName || '').toLowerCase(),
    ...(node.id ? { id: String(node.id).slice(0, 80) } : {}),
    ...(rawClass ? { class: rawClass.trim().split(/\s+/).slice(0, 8).join(' ').slice(0, 120) } : {}),
    ...(Object.keys(attrs).length ? { data: attrs } : {}),
    visibility: visibilityOf(node, win),
  };
  return descriptor;
}

function visibilityOf(node, win) {
  for (let current = node; current?.nodeType === 1; current = current.parentElement) {
    if (current.hidden || current.getAttribute('aria-hidden') === 'true') return 'hidden';
    const styleText = current.getAttribute('style') || '';
    if (/display\s*:\s*none|visibility\s*:\s*(hidden|collapse)|content-visibility\s*:\s*hidden/i.test(styleText)) return 'hidden';
    try {
      const style = win?.getComputedStyle?.(current);
      if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse' || style?.contentVisibility === 'hidden') return 'hidden';
    } catch { /* Fall back to explicit attributes and inline styles. */ }
  }
  return 'visible';
}

function ancestryOf(node, root, win) {
  const ancestry = [];
  for (let current = node; current && ancestry.length < ANCESTRY_LIMIT; current = current.parentElement) {
    ancestry.push(safeDescriptor(current, win));
    if (current === root) break;
  }
  return ancestry;
}

/**
 * Return structural page diagnostics without reading or returning DOM text,
 * media attributes, or the page URL path (which may contain conversation IDs).
 */
export function collectDiagnostics(doc = document, url = location.href) {
  const win = doc.defaultView;
  let parsedUrl;
  try { parsedUrl = new URL(url); } catch { parsedUrl = new URL(win?.location?.href || 'https://unknown.invalid/'); }
  const provider = providerFor(parsedUrl.hostname);
  const roots = [...doc.querySelectorAll(SELECTORS.conversationRoot)];
  const outerRoots = roots.filter(node => !roots.some(other => other !== node && other.contains(node)));
  const selectedChatGptRoot = provider === 'ChatGPT' ? chatGptConversationRoot(doc) : null;
  const structuralCounts = node => ({
    paragraphs: node.querySelectorAll('p').length,
    media: node.querySelectorAll('img, video, audio, figure, table, canvas, svg, iframe, object, embed').length,
    userBubbles: node.querySelectorAll(`${SELECTORS.chatGptUserBubble}, ${SELECTORS.chatGptReportedUserBubble}`).length,
    userText: node.querySelectorAll(SELECTORS.chatGptUserText).length,
  });
  const rootCandidates = roots.slice(0, ROOT_LIMIT).map(node => ({
    selector: node.matches('#thread') ? '#thread' : node.matches('main') ? 'main' : '[role="main"]',
    ...safeDescriptor(node, win),
    descendantCounts: {
      roleMessages: node.querySelectorAll(SELECTORS.messageRole).length,
      turnMarkers: node.querySelectorAll(SELECTORS.conversationTurn).length,
      userBubbles: node.querySelectorAll(SELECTORS.chatGptUserBubble).length,
      reportedUserBubbles: node.querySelectorAll(SELECTORS.chatGptReportedUserBubble).length,
      assistantText: node.querySelectorAll(SELECTORS.chatGptAssistantText).length,
    },
    outermost: outerRoots.includes(node),
    selected: node === selectedChatGptRoot,
  }));
  const selectorCounts = Object.fromEntries(Object.entries(SELECTORS).map(([name, selector]) => [name, doc.querySelectorAll(selector).length]));
  const sampleSelectors = [
    ['messageRole', SELECTORS.messageRole],
    ['conversationTurn', SELECTORS.conversationTurn],
    ['chatGptUserBubble', SELECTORS.chatGptUserBubble],
    ['chatGptUserText', SELECTORS.chatGptUserText],
    ['chatGptAssistantText', SELECTORS.chatGptAssistantText],
    ['claudeMessage', SELECTORS.claudeMessage],
    ['geminiMessage', SELECTORS.geminiMessage],
  ];
  const samples = [];
  const addSamples = (kind, nodes, limit) => {
    let added = 0;
    for (const node of nodes) {
      if (added >= limit || samples.length >= SAMPLE_LIMIT) break;
      if (node.closest('[data-idea-capture-owned], [data-idea-capture-control]')) continue;
      const root = roots.find(candidate => candidate === node || candidate.contains(node)) || null;
      samples.push({ kind, ancestry: ancestryOf(node, root, win) });
      added++;
    }
  };
  // Reserve room for both known user bubbles and structural evidence from
  // content outside those bubbles, even when legacy selectors happen to match.
  const knownUserBubbles = [...doc.querySelectorAll(`${SELECTORS.chatGptUserBubble}, ${SELECTORS.chatGptReportedUserBubble}, [data-message-author-role="user"], [data-role="user"], [data-turn-role="user"]`)];
  addSamples('knownUserBubble', knownUserBubbles, 3);
  const diagnosticRoot = selectedChatGptRoot || roots.find(node => node.matches('main') && visibilityOf(node, win) === 'visible') || roots[0] || doc.body;
  if (diagnosticRoot) {
    const outsideUserBubble = node => !node.closest(`${SELECTORS.chatGptUserBubble}, ${SELECTORS.chatGptReportedUserBubble}, [data-message-author-role="user"], [data-role="user"], [data-turn-role="user"], nav, aside, [role="navigation"], [contenteditable="true"], textarea, input, [data-idea-capture-owned], [data-idea-capture-control]`);
    const paragraphs = [...diagnosticRoot.querySelectorAll('p')].filter(outsideUserBubble);
    const media = [...diagnosticRoot.querySelectorAll('img, video, audio, figure, table, canvas, svg, iframe, object, embed')].filter(outsideUserBubble);
    addSamples('contentParagraph', paragraphs, 3);
    addSamples('contentMedia', media, 3);
  }
  for (const [kind, selector] of sampleSelectors) {
    const categoryLimit = kind === 'chatGptUserBubble' ? 2 : 1;
    for (const node of doc.querySelectorAll(selector)) {
      if (samples.length >= SAMPLE_LIMIT) break;
      if (samples.filter(sample => sample.kind === kind).length >= categoryLimit) break;
      if (node.closest('[data-idea-capture-owned], [data-idea-capture-control]')) continue;
      const root = roots.find(candidate => candidate === node || candidate.contains(node)) || null;
      samples.push({ kind, ancestry: ancestryOf(node, root, win) });
    }
  }
  const topBranchStructure = diagnosticRoot ? [...diagnosticRoot.children].slice(0, 8).map(node => ({
    ...safeDescriptor(node, win),
    descendantCounts: structuralCounts(node),
  })) : [];
  return {
    version: manifest.version,
    diagnosticsVersion: 2,
    provider,
    hostname: parsedUrl.hostname,
    routeShape: parsedUrl.pathname.split('/').filter(Boolean).map(segment => /^(g|c|chat|app|share)$/i.test(segment) ? segment.toLowerCase() : '…'),
    rootCandidateCount: roots.length,
    rootCandidates,
    topBranchStructure,
    selectorCounts,
    samples,
    limits: { sampleLimit: SAMPLE_LIMIT, ancestryLimit: ANCESTRY_LIMIT, rootLimit: ROOT_LIMIT, topBranchLimit: 8 },
  };
}
