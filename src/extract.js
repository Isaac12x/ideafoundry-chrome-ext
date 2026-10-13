import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

export function extractConversation(doc = document, url = location.href) {
  const host = new URL(url).hostname;
  const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
  td.use(gfm);
  td.addRule('safeCodeFence', {
    filter: 'pre',
    replacement: (_text, node) => {
      const code = node.querySelector('code') || node;
      const text = code.textContent.replace(/\n$/, '');
      const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map(m => m[0].length));
      const fence = '`'.repeat(longest + 1);
      const language = (code.className.match(/language-([\w+-]+)/) || [])[1] || '';
      return `\n\n${fence}${language}\n${text}\n${fence}\n\n`;
    },
  });
  const clean = node => {
    const copy = node.cloneNode(true);
    copy.querySelectorAll('script,style,button,svg,nav,textarea,input,[aria-hidden="true"],[hidden],.sr-only').forEach(n => n.remove());
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
    candidates = [...doc.querySelectorAll('[data-message-author-role]')].map(n => [n, n.dataset.messageAuthorRole]);
  } else if (/(^|\.)claude\.ai$/.test(host)) {
    provider = 'Claude';
    candidates = [...doc.querySelectorAll('[data-testid="user-message"], [data-is-streaming]')].map(n => [n, n.matches('[data-testid="user-message"]') ? 'user' : 'assistant']);
    if (!candidates.some(([,r]) => r === 'assistant')) candidates = [...doc.querySelectorAll('[data-testid="user-message"], .font-claude-response')].map(n => [n, n.matches('[data-testid="user-message"]') ? 'user' : 'assistant']);
  } else if (host === 'gemini.google.com') {
    provider = 'Gemini';
    candidates = [...doc.querySelectorAll('user-query, model-response')].map(n => [n, n.tagName === 'USER-QUERY' ? 'user' : 'assistant']);
  } else {
    candidates = [...doc.querySelectorAll('[data-message-author-role], [data-role="user"], [data-role="assistant"]')].map(n => [n, n.dataset.messageAuthorRole || n.dataset.role]);
  }
  // Providers sometimes nest wrappers with the same message attributes.
  candidates = candidates.filter(([n]) => !candidates.some(([other]) => other !== n && other.contains(n)));
  let warning = 'Captures messages currently loaded on the page. Load older messages before exporting; attachments and hidden branches are not included.';
  let messages = candidates.map(([node, role]) => ({ role: ({ user: 'User', assistant: 'Assistant', system: 'System' })[role] || 'Message', markdown: clean(node) })).filter(m => m.markdown);
  if (!messages.length && provider === 'Other') {
    const main = doc.querySelector('main, [role="main"], article');
    if (main) messages = [{ role: 'Page content', markdown: clean(main) }].filter(m => m.markdown);
    warning = 'Generic page capture: speaker boundaries could not be identified. Review the preview before saving. Only loaded content is included.';
  }
  if (!messages.length) throw new Error('No conversation found. Open a conversation, sign in if needed, and wait for its messages to load.');
  const streaming = !!doc.querySelector('[data-is-streaming="true"], [data-testid="stop-button"], button[aria-label="Stop response"]');
  return { title: doc.title.replace(/\s*[-|–]\s*(ChatGPT|Claude|Gemini)\s*$/i, '').trim() || 'Conversation', url, provider, capturedAt: new Date().toISOString(), warning, messages, streaming };
}
