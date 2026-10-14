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

function userLabel(node) {
  const copy = node.cloneNode(true);
  copy.querySelectorAll('script,style,button,svg,nav,textarea,input,[aria-hidden="true"],[hidden],.sr-only,[data-idea-capture-control],[data-idea-capture-owned]').forEach(element => element.remove());
  return copy.textContent.replace(/\s+/g, ' ').trim();
}

function hasMeaningfulContent(node) {
  const copy = node.cloneNode(true);
  copy.querySelectorAll('script,style,nav,textarea,input,[aria-hidden="true"],[hidden],.sr-only,[data-idea-capture-control],[data-idea-capture-owned]').forEach(element => element.remove());
  const labeledSvg = [...copy.querySelectorAll('svg[aria-label]')].some(svg => !svg.closest('button,nav,aside,[role="navigation"]'));
  copy.querySelectorAll('svg').forEach(svg => svg.remove());
  // Buttons are usually turn controls, but some providers wrap the actual
  // image in a button. Keep those media nodes while discarding button labels.
  copy.querySelectorAll('button').forEach(button => {
    const media = button.querySelector('img[src],img[srcset],video[src],audio[src],video source[src],audio source[src],iframe[src],object[data],embed[src],canvas');
    if (!media) button.remove();
    else [...button.childNodes].filter(child => child.nodeType === 3).forEach(child => child.remove());
  });
  return !!copy.textContent.trim() || !!copy.querySelector('img[src],img[srcset],video[src],audio[src],video source[src],audio source[src],iframe[src],object[data],embed[src],canvas') || labeledSvg;
}

function chatGptRole(node) {
  const labeled = node.matches('[data-message-author-role], [data-role], [data-turn-role]')
    ? node
    : node.querySelector('[data-message-author-role], [data-role], [data-turn-role]');
  const explicit = labeled?.getAttribute('data-message-author-role') || labeled?.getAttribute('data-role') || labeled?.getAttribute('data-turn-role');
  if (/^(user|assistant|system)$/i.test(explicit || '')) return explicit.toLowerCase();
  if (node.matches('[data-testid="user-message"], [class*="user-turn"]') || node.querySelector('[data-testid="user-message"], [class*="user-turn"]')) return 'user';
  if (node.matches('[class*="agent-turn"], [class*="assistant-turn"]') || node.querySelector('[class*="agent-turn"], [class*="assistant-turn"]')) return 'assistant';

  // ChatGPT has rendered some conversation turns as articles whose only role
  // label is an accessible heading (for example, "You said:" / "ChatGPT said:").
  const labels = [node, ...node.querySelectorAll('h1,h2,h3,h4,h5,h6,[aria-label],[role="heading"]')]
    .map(element => `${element.getAttribute('aria-label') || ''} ${element.textContent || ''}`.trim())
    .filter(Boolean);
  if (labels.some(label => /^(you|user)\s+(said|asked)\b/i.test(label))) return 'user';
  if (labels.some(label => /^(chatgpt|assistant)\s+(said|replied|answered)\b/i.test(label))) return 'assistant';
  if (labels.some(label => /^(tú|usted)\s+(dijiste|preguntaste)\b|^dijiste\s*:/i.test(label))) return 'user';
  if (labels.some(label => /^chatgpt\s+(dijo|respondió)\b|^chatgpt\s*:/i.test(label))) return 'assistant';
  return null;
}

function chatGptConversationRoot(doc) {
  return doc.querySelector('main [data-testid^="conversation-turn-"], [role="main"] [data-testid^="conversation-turn-"]')?.closest('main, [role="main"]')
    || doc.querySelector('main, [role="main"]')
    || doc;
}

export function extractConversation(doc = document, url = location.href, options = {}) {
  const host = new URL(url).hostname;
  const includeMarkdown = options.includeMarkdown !== false;
  const media = [];
  let td;
  const convert = (node, messageRole, messageIndex) => {
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
    copy.querySelectorAll('script,style,nav,textarea,input,[aria-hidden="true"],[hidden],.sr-only,[data-idea-capture-control],[data-idea-capture-owned]').forEach(n => n.remove());

    let mediaOrdinal = 0;
    const addMedia = (element, kind, mediaUrl, error = '') => {
      if (!mediaUrl && !error) return null;
      const id = `media-${messageIndex}-${mediaOrdinal++}`;
      let filename = element.getAttribute('download') || '';
      if (!filename) {
        try {
          const parsed = new URL(mediaUrl, url);
          if (parsed.protocol === 'http:' || parsed.protocol === 'https:') filename = parsed.pathname.split('/').pop() || '';
        } catch { /* Keep an empty filename for non-URL sources. */ }
      }
      const item = {
        id, kind, url: mediaUrl,
        alt: element.getAttribute('alt') || '',
        title: element.getAttribute('title') || '',
        filename,
        mime: element.getAttribute('type') || '',
        messageRole, messageIndex,
        ...(error ? { error } : {}),
      };
      media.push(item);
      const placeholder = doc.createTextNode(`{{idea-media:${id}}}`);
      element.parentNode?.insertBefore(placeholder, element);
      element.remove();
      return item;
    };
    const kindForUrl = value => {
      let pathname = value;
      try { pathname = new URL(value, url).pathname; } catch { /* Use the raw source. */ }
      const extension = pathname.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
      if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'bmp', 'tif', 'tiff'].includes(extension)) return 'image';
      if (['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus'].includes(extension)) return 'audio';
      if (['mp4', 'webm', 'mov', 'm4v', 'avi', 'mkv'].includes(extension)) return 'video';
      return 'file';
    };
    const mediaAnchors = new Set();
    for (const anchor of copy.querySelectorAll('a[href]')) {
      const href = anchor.getAttribute('href') || '';
      const extension = (() => { try { return new URL(href, url).pathname.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() || ''; } catch { return ''; } })();
      const downloadable = anchor.hasAttribute('download') || /^(png|jpe?g|gif|webp|avif|svg|bmp|tiff?|mp3|wav|ogg|m4a|aac|flac|opus|mp4|webm|mov|m4v|avi|mkv|pdf|docx?|xlsx?|pptx?|zip|csv|txt)$/i.test(extension);
      if (!downloadable) continue;
      const absolute = (() => { try { return new URL(href, url).href; } catch { return href; } })();
      addMedia(anchor, kindForUrl(absolute), absolute);
      mediaAnchors.add(anchor);
    }
    const srcsetUrl = value => {
      if (!value || value.startsWith('data:')) return '';
      return value.split(',')[0].trim().split(/\s+/)[0] || '';
    };
    const mediaSelector = 'img[src],img[srcset],audio[src],video[src],audio source[src],video source[src],object[data],embed[src],iframe[src],canvas,svg[aria-label]';
    const mediaElements = [...copy.querySelectorAll(mediaSelector)];
    let canvasIndex = 0;
    for (const element of mediaElements) {
      if (element.closest('a[href]') && mediaAnchors.has(element.closest('a[href]'))) continue;
      if (element.tagName.toLowerCase() === 'svg' && element.closest('button')) continue;
      const parentMedia = element.matches('source') ? element.closest('audio,video') : null;
      if (parentMedia?.getAttribute('src')) continue;
      if (parentMedia && parentMedia.querySelector('source[src]') !== element) continue;
      const kind = element.tagName.toLowerCase() === 'img' || element.tagName.toLowerCase() === 'svg' || element.tagName.toLowerCase() === 'canvas' ? 'image'
        : element.tagName.toLowerCase() === 'audio' || element.tagName.toLowerCase() === 'source' && element.closest('audio') ? 'audio'
          : element.tagName.toLowerCase() === 'video' || element.tagName.toLowerCase() === 'source' && element.closest('video') ? 'video' : 'file';
      const tag = element.tagName.toLowerCase();
      const attr = tag === 'object' ? 'data' : tag === 'iframe' ? 'src' : 'src';
      let raw = element.getAttribute(attr) || (tag === 'img' ? srcsetUrl(element.getAttribute('srcset')) : '');
      let mediaError = '';
      if (tag === 'canvas') {
        const originalCanvas = node.querySelectorAll('canvas')[canvasIndex++];
        try { raw = originalCanvas.toDataURL('image/png'); } catch { mediaError = 'Canvas image could not be captured.'; }
      }
      if (tag === 'svg') {
        const xml = new doc.defaultView.XMLSerializer().serializeToString(element);
        raw = `data:image/svg+xml,${encodeURIComponent(xml)}`;
      }
      const absolute = raw ? (() => { try { return new URL(raw, url).href; } catch { return raw; } })() : '';
      const item = addMedia(element, kind, absolute, mediaError);
      if (item && (tag === 'canvas' || tag === 'svg')) item.mime = tag === 'canvas' ? 'image/png' : 'image/svg+xml';
    }
    copy.querySelectorAll('button').forEach(button => {
      const placeholders = button.textContent.match(/\{\{idea-media:[a-zA-Z0-9_-]{1,100}\}\}/g);
      if (placeholders?.length) button.replaceWith(doc.createTextNode(placeholders.join('\n')));
      else button.remove();
    });
    copy.querySelectorAll('svg,[data-idea-capture-control],[data-idea-capture-owned]').forEach(n => n.remove());
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
  let unlabeledChatGptTurns = false;
  if (/(^|\.)(chatgpt\.com|chat\.openai\.com)$/.test(host)) {
    provider = 'ChatGPT';
    const root = chatGptConversationRoot(doc);
    candidates = [...root.querySelectorAll('[data-message-author-role]')]
      .filter(node => !node.closest('nav,aside,[role="navigation"]'))
      .filter(node => hasMeaningfulContent(node))
      .map(node => ({ node, role: node.dataset.messageAuthorRole }));
    const turns = [...root.querySelectorAll('[data-testid^="conversation-turn-"], article[data-turn-id], article')]
      .filter(node => !node.closest('nav,aside,[role="navigation"]'))
      .filter(node => node.matches('[data-testid^="conversation-turn-"], article[data-turn-id]') || !!chatGptRole(node))
      .filter(node => !node.parentElement?.closest('[data-testid^="conversation-turn-"], article[data-turn-id], article'));
    const unrecognizedTurns = [];
    for (const node of turns) {
      if (candidates.some(candidate => candidate.node === node || node.contains(candidate.node))) continue;
      if (!hasMeaningfulContent(node)) continue;
      const role = chatGptRole(node);
      if (role) candidates.push({ node, role });
      else unrecognizedTurns.push(node);
    }
    const isConversationRoute = /\/c\/[^/]+/.test(new URL(url).pathname);
    if (unrecognizedTurns.length && isConversationRoute && candidates.length) {
      candidates.push(...unrecognizedTurns.map(node => ({ node, role: 'message' })));
      unlabeledChatGptTurns = true;
    } else if (!candidates.length && root.matches?.('main, [role="main"]') && isConversationRoute) {
      for (const node of turns) if (hasMeaningfulContent(node)) candidates.push({ node, role: 'message' });
      if (candidates.length) unlabeledChatGptTurns = true;
    }
    candidates.sort((a, b) => a.node === b.node ? 0 : (a.node.compareDocumentPosition(b.node) & 4) ? -1 : 1);
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
  const messages = candidates.map(({ node, role }, messageIndex) => {
    let contentNode = node;
    if (provider === 'ChatGPT') {
      const wrapper = node.closest('[data-testid^="conversation-turn-"], article');
      if (wrapper && wrapper !== node) {
        const nestedCandidates = [...wrapper.querySelectorAll('[data-message-author-role]')]
          .filter(candidate => !candidates.some(other => other.node !== candidate && other.node.contains(candidate)));
        if (nestedCandidates.length === 1 && nestedCandidates[0] === node) contentNode = wrapper;
      }
    }
    const markdown = convert(contentNode, ({ user: 'User', assistant: 'Assistant', system: 'System' })[role] || 'Message', messageIndex);
    return { node, contentNode, providerId: messageId(node), messageIndex, role: ({ user: 'User', assistant: 'Assistant', system: 'System' })[role] || 'Message', markdown };
  }).filter(message => !includeMarkdown || message.markdown);
  let warning = 'Captures messages currently loaded on the page. Load older messages before exporting; detected media is included when available, and hidden branches are not included.';
  if (unlabeledChatGptTurns) warning = 'Some ChatGPT turns did not expose a speaker label. Their article order is preserved as messages; review the preview before saving. Only loaded content is included.';
  if (!messages.length && provider === 'Other') {
    const main = doc.querySelector('main, [role="main"], article');
    if (main && hasMeaningfulContent(main)) {
      const markdown = convert(main, 'Page content', 0);
      if (!includeMarkdown || markdown) {
        messages.push({ node: main, contentNode: main, providerId: null, messageIndex: 0, role: 'Page content', markdown });
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
      const label = message.role === 'User' ? userLabel(message.node) : 'Earlier messages';
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
  return { title: doc.title.replace(/\s*[-|–]\s*(ChatGPT|Claude|Gemini)\s*$/i, '').trim() || 'Conversation', url, provider, capturedAt: new Date().toISOString(), warning, messages: publicMessages, sections: publicSections, media, streaming };
}
