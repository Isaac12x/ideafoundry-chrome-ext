import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

const hash = value => {
  let result = 2166136261;
  for (const char of value) { result ^= char.charCodeAt(0); result = Math.imul(result, 16777619); }
  return (result >>> 0).toString(36);
};

function messageId(node) {
  const providerNode = node.closest('[data-message-id], [data-turn-id], [data-testid^="conversation-turn-"]') || node;
  return providerNode.getAttribute('data-message-id') || providerNode.getAttribute('data-turn-id') ||
    (providerNode.getAttribute('data-testid') || '').match(/^conversation-turn-(.+)$/)?.[1] || null;
}

function hasMeaningfulContent(node) {
  const copy = node.cloneNode(true);
  copy.querySelectorAll('script,style,button,svg,nav,textarea,input,[aria-hidden="true"],[hidden],.sr-only,[data-idea-capture-control],[data-idea-capture-owned]').forEach(element => element.remove());
  return !!copy.textContent.trim() || !!copy.querySelector('img[src],video[src],audio[src],iframe[src],object[data],embed[src]');
}

export function extractConversation(doc = document, url = location.href, options = {}) {
  const host = new URL(url).hostname;
  const includeMarkdown = options.includeMarkdown !== false;
  let td;
  const convert = node => {
    if (!includeMarkdown) return '';
    if (!td) {
      td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
      td.use(gfm);
      td.addRule('safeCodeFence', {
        filter: 'pre',
        replacement: (_text, pre) => {
          const code = pre.querySelector('code') || pre;
          const text = code.textContent.replace(/\n$/, '');
          const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map(m => m[0].length));
          const fence = '`'.repeat(longest + 1);
          const language = (code.className.match(/language-([\w+-]+)/) || [])[1] || '';
          return `\n\n${fence}${language}\n${text}\n${fence}\n\n`;
        },
      });
    }
    const copy = node.cloneNode(true);
    copy.querySelectorAll('script,style,button,svg,nav,textarea,input,[aria-hidden="true"],[hidden],.sr-only,[data-idea-capture-control]').forEach(n => n.remove());
    copy.querySelectorAll('a[href],img[src]').forEach(n => {
      const attr = n.tagName === 'A' ? 'href' : 'src';
      try {
        const link = new URL(n.getAttribute(attr), url);
        if (!['http:', 'https:'].includes(link.protocol)) n.removeAttribute(attr);
        else n.setAttribute(attr, link.href);
      } catch { n.removeAttribute(attr); }
    });
    return td.turndown(copy.innerHTML).trim();
  };
  let provider = 'Other';
  let candidates = [];
  if (/(^|\.)(chatgpt\.com|chat\.openai\.com)$/.test(host)) {
    provider = 'ChatGPT';
    candidates = [...doc.querySelectorAll('[data-message-author-role]')].map(node => ({ node, role: node.dataset.messageAuthorRole }));
  } else if (/(^|\.)claude\.ai$/.test(host)) {
    provider = 'Claude';
    candidates = [...doc.querySelectorAll('[data-testid="user-message"], [data-is-streaming]')].map(node => ({ node, role: node.matches('[data-testid="user-message"]') ? 'user' : 'assistant' }));
    if (!candidates.some(candidate => candidate.role === 'assistant')) candidates = [...doc.querySelectorAll('[data-testid="user-message"], .font-claude-response')].map(node => ({ node, role: node.matches('[data-testid="user-message"]') ? 'user' : 'assistant' }));
  } else if (host === 'gemini.google.com') {
    provider = 'Gemini';
    candidates = [...doc.querySelectorAll('user-query, model-response')].map(node => ({ node, role: node.tagName === 'USER-QUERY' ? 'user' : 'assistant' }));
  } else {
    candidates = [...doc.querySelectorAll('[data-message-author-role], [data-role="user"], [data-role="assistant"]')].map(node => ({ node, role: node.dataset.messageAuthorRole || node.dataset.role }));
  }
  // Drop only nested wrappers that repeat a role. A containing message with a
  // different role is a separate speaker and must remain in the transcript.
  candidates = candidates.filter(({ node, role }) => !candidates.some(other => other.node !== node && other.role === role && other.node.contains(node)));
  const messages = candidates.map(({ node, role }) => {
    let contentNode = node;
    if (provider === 'ChatGPT') {
      const wrapper = node.closest('[data-testid^="conversation-turn-"], article');
      if (wrapper && wrapper !== node) {
        const nestedCandidates = [...wrapper.querySelectorAll('[data-message-author-role]')]
          .filter(candidate => !candidates.some(other => other.node !== candidate && other.node.contains(candidate)));
        if (nestedCandidates.length === 1 && nestedCandidates[0] === node) contentNode = wrapper;
      }
    }
    const markdown = convert(contentNode);
    return { node, contentNode, providerId: messageId(node), role: ({ user: 'User', assistant: 'Assistant', system: 'System' })[role] || 'Message', markdown };
  }).filter(message => !includeMarkdown || message.markdown);
  let warning = 'Captures messages currently loaded on the page. Load older messages before exporting; attachments and hidden branches are not included.';
  if (!messages.length && provider === 'Other') {
    const main = doc.querySelector('main, [role="main"], article');
    if (main && hasMeaningfulContent(main)) {
      const markdown = convert(main);
      if (!includeMarkdown || markdown) {
        messages.push({ node: main, contentNode: main, providerId: null, role: 'Page content', markdown });
        warning = 'Generic page capture: speaker boundaries could not be identified. Review the preview before saving. Only loaded content is included.';
      }
    }
  }
  if (!messages.length) throw new Error('No conversation found. Open a conversation, sign in if needed, and wait for its messages to load.');
  const sections = [];
  const occurrences = new Map();
  let current;
  for (const message of messages) {
    if (message.role === 'User' || !current) {
      const label = message.role === 'User' ? message.node.textContent.replace(/\s+/g, ' ').trim() : 'Earlier messages';
      const fallback = message.role === 'User' ? hash(label) : 'lead';
      const base = message.providerId ? `provider-${hash(message.providerId)}` : fallback;
      const occurrence = occurrences.get(base) || 0;
      occurrences.set(base, occurrence + 1);
      current = { id: `section-${base}-${occurrence}`, label: label.slice(0, 100) || 'User message', messages: [], nodes: [], identityNode: message.node };
      sections.push(current);
    }
    message.sectionId = current.id;
    current.messages.push(message);
    current.nodes.push(message.node);
  }
  const publicSections = sections.map(({ id, label, messages: sectionMessages, nodes, identityNode }) => ({
    id, label, messageCount: sectionMessages.length,
    ...(options.includeNodes ? { nodes, identityNode } : {}),
  }));
  const publicMessages = messages.map(({ node, contentNode, providerId, ...message }) => message);
  const streaming = !!doc.querySelector('[data-is-streaming="true"], [data-testid="stop-button"], button[aria-label="Stop response"]');
  return { title: doc.title.replace(/\s*[-|–]\s*(ChatGPT|Claude|Gemini)\s*$/i, '').trim() || 'Conversation', url, provider, capturedAt: new Date().toISOString(), warning, messages: publicMessages, sections: publicSections, streaming };
}
