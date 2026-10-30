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

const sidebarSelector = 'nav, aside, [role="navigation"], [role="complementary"], #sidebar, #left-sidebar, #right-sidebar, .sidebar, .app-sidebar, .conversation-sidebar, .sidebar-panel, .sidebar-container, [aria-label*="sidebar" i], [data-testid*="sidebar" i]';
const chatGptUserBubbleSelector = '.bg-user-message, .user-message-bubble, [class*="user-message-bubble"]';

function isInSidebar(node) {
  return !!node.closest?.(sidebarSelector);
}

function isVisibleConversationNode(node) {
  for (let current = node; current?.nodeType === 1; current = current.parentElement) {
    if (current.hidden || current.getAttribute('aria-hidden') === 'true' || /display\s*:\s*none|visibility\s*:\s*(hidden|collapse)/i.test(current.getAttribute('style') || '')) return false;
    if (current.classList.contains('idea-capture-section-collapsed')) continue;
    const style = current.ownerDocument?.defaultView?.getComputedStyle?.(current);
    if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse') return false;
  }
  return true;
}

function chatGptRole(node) {
  const labeled = node.matches('[data-message-author-role], [data-role], [data-turn-role]')
    ? node
    : node.querySelector('[data-message-author-role], [data-role], [data-turn-role]');
  const explicit = labeled?.getAttribute('data-message-author-role') || labeled?.getAttribute('data-role') || labeled?.getAttribute('data-turn-role');
  if (/^(user|assistant|system)$/i.test(explicit || '')) return explicit.toLowerCase();
  if (node.matches(`[data-testid="user-message"], [class*="user-turn"], ${chatGptUserBubbleSelector}`) || node.querySelector('[data-testid="user-message"], [class*="user-turn"]')) return 'user';
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

export function chatGptConversationRoot(doc) {
  const roots = [...doc.querySelectorAll('#thread, main, [role="main"]')].filter(node => !isInSidebar(node));
  const visible = node => {
    for (let current = node; current?.nodeType === 1; current = current.parentElement) {
      if (current.hidden || current.getAttribute('aria-hidden') === 'true') return false;
      if (/display\s*:\s*none|visibility\s*:\s*(hidden|collapse)/i.test(current.getAttribute('style') || '')) return false;
      if (current.classList.contains('idea-capture-section-collapsed')) continue;
      const style = doc.defaultView?.getComputedStyle?.(current);
      if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse') return false;
    }
    return true;
  };
  const count = (node, selector) => [...node.querySelectorAll(selector)]
    .filter(candidate => !isInSidebar(candidate) && visible(candidate)).length;
  const score = node => {
    const roles = count(node, '[data-message-author-role], [data-role="user"], [data-role="assistant"]');
    const turns = count(node, '[data-testid^="conversation-turn-"], [data-turn-id]');
    const bubbles = count(node, chatGptUserBubbleSelector);
    const prose = count(node, '.markdown, .prose');
    const result = roles * 8 + turns * 6 + bubbles * 7 + prose * 3;
    return result > 0 && node.id === 'thread' ? result + 2 : result;
  };
  return roots.sort((a, b) => score(b) - score(a) || (a.contains(b) ? 1 : b.contains(a) ? -1 : 0))[0] || doc;
}

function chatGptClassTurns(root) {
  const result = [];
  const add = (selector, role) => {
    for (const node of root.querySelectorAll(selector)) {
      if (isInSidebar(node) || !isVisibleConversationNode(node)) continue;
      if (role === 'assistant' && node.closest(`${chatGptUserBubbleSelector}, [data-message-author-role="user"], [data-role="user"]`)) continue;
      // Assistant styling wrappers can contain a separately labeled user
      // message. Capturing the wrapper would duplicate that prompt as an answer.
      if (role === 'assistant' && node.querySelector(`${chatGptUserBubbleSelector}, [data-message-author-role="user"], [data-role="user"]`)) continue;
      if (role === 'assistant') {
        let ancestor = node.parentElement;
        let coveredByLabeledTurn = false;
        while (ancestor && ancestor !== root) {
          if (ancestor.matches('[data-testid^="conversation-turn-"], article[data-turn-id], article') && chatGptRole(ancestor)) {
            coveredByLabeledTurn = true;
            break;
          }
          ancestor = ancestor.parentElement;
        }
        if (coveredByLabeledTurn) continue;
      }
      result.push({ node, role });
    }
  };
  // Current ChatGPT renders user text inside a user-message-bubble and
  // assistant prose inside markdown/prose containers. These classes remain
  // useful when the older role attributes and conversation-turn test IDs are
  // absent. Restrict prose candidates to a real conversation root chosen above.
  add(chatGptUserBubbleSelector, 'user');
  // Some builds split one answer across several prose containers and leave
  // tables or follow-up paragraphs beside them. The assistant turn wrapper is
  // the message boundary in that layout, so convert it once and let export
  // cleanup remove its controls and hidden branches.
  add('[class*="agent-turn"], [class*="assistant-turn"]', 'assistant');
  add('.markdown, .prose', 'assistant');
  return result;
}

function chatGptCommonAncestor(nodes) {
  if (!nodes.length) return null;
  const ancestors = new Set();
  for (let current = nodes[0]; current; current = current.parentElement) ancestors.add(current);
  for (let current = nodes[1]?.parentElement; current; current = current.parentElement) {
    if (ancestors.has(current) && nodes.every(node => current === node || current.contains(node))) return current;
  }
  return nodes.length === 1 ? nodes[0].parentElement : null;
}

// These nodes mark real boundaries in the page. Presentation-only nodes such
// as buttons and screen-reader labels are removed from the export clone, but
// they must not split one reply into a pile of inferred messages.
const inferredBarrierSelector = `${chatGptUserBubbleSelector},script,style,nav,aside,header,footer,form,textarea,input,select,[contenteditable="true"],[role="navigation"],[role="complementary"],[role="toolbar"],[class*="sidebar" i],[class*="composer" i],[data-testid*="composer" i],[data-testid*="header" i],[aria-label*="composer" i],[hidden],[aria-hidden="true"],[data-idea-capture-control],[data-idea-capture-owned]`;
const collapseUnsafeSelector = `nav,aside,header,footer,form,textarea,input:not([data-idea-section-id]),select,[contenteditable="true"],[role="navigation"],[role="complementary"],[class*="sidebar" i],[class*="composer" i],[data-testid*="composer" i],[aria-label*="composer" i]`;
export function isReadOnlyCodeSurface(node) {
  return !!node?.matches?.('[role="textbox"]') && node.matches('pre[aria-readonly="true"]') && !!node.querySelector('code');
}
export function isCollapsibleCodePanel(node) {
  if (!node?.querySelector?.('pre code')) return false;
  const hasToolbar = [...node.children].some(child => child.matches('header, [role="toolbar"], [class*="code-toolbar" i], [data-testid*="code-toolbar" i]') ||
    (child.querySelector('button') && !child.querySelector('pre, textarea, input')));
  const hasDirectCode = [...node.children].some(child => child.matches('pre') && child.querySelector('code'));
  const hasCodeFrame = node.matches('[class*="code-panel" i], [data-testid*="code-panel" i]') || (hasToolbar && hasDirectCode);
  if (!hasCodeFrame) return false;
  if (node.matches('html, body, main, [role="main"], article, [data-testid^="conversation-turn-"], [data-turn-id], [data-message-id]')) return false;
  if (node.matches('form, nav, aside, footer, [role="navigation"], [role="complementary"], [contenteditable="true"], [class*="sidebar" i], [class*="composer" i], [data-testid*="composer" i], [aria-label*="composer" i]') ||
      node.querySelector('form, nav, aside, footer, [role="navigation"], [role="complementary"], [contenteditable="true"], [class*="sidebar" i], [class*="composer" i], [data-testid*="composer" i], [aria-label*="composer" i]')) return false;
  if ([...node.querySelectorAll('textarea, input:not([data-idea-section-id])')].some(editor => !editor.readOnly)) return false;
  if ([...node.querySelectorAll('[role="textbox"]')].some(textbox => !isReadOnlyCodeSurface(textbox) &&
      !(textbox.matches('textarea[readonly]') && textbox.closest('pre')?.querySelector('code')))) return false;
  if ([...node.querySelectorAll('p, h1, h2, h3, h4, h5, h6, table, blockquote, ul, ol')]
    .some(content => !content.closest('pre, header, [role="toolbar"], [class*="code-toolbar" i], [data-testid*="code-toolbar" i]'))) return false;
  return true;
}
function collapseUnsafe(node) {
  if (node.matches?.(collapseUnsafeSelector)) return true;
  // Read-only code surfaces may use textbox semantics for selection. They are
  // rendered content; editable textboxes remain protected.
  return node.matches?.('[role="textbox"]') && !isReadOnlyCodeSurface(node);
}
function containsCollapseUnsafe(node) {
  return collapseUnsafe(node) || [...node.querySelectorAll(`${collapseUnsafeSelector}, [role="textbox"]`)].some(collapseUnsafe);
}
const exportExcludedSelector = `script,style,nav,aside,header,footer,form,textarea,input,select,[contenteditable="true"],[role="navigation"],[role="complementary"],[role="toolbar"],[class*="sidebar" i],[class*="toolbar" i],[class*="composer" i],[data-testid*="composer" i],[data-testid*="header" i],[aria-label*="composer" i],[hidden],[aria-hidden="true"],.sr-only,[data-idea-capture-control],[data-idea-capture-owned]`;

function inferredContentNodes(source) {
  if (source.matches?.(inferredBarrierSelector)) return [];
  // Keep the structural reply wrapper as one message. The converter removes
  // nested page chrome and controls, preserving surrounding text, citations,
  // and media without turning each surviving child into a separate message.
  return hasMeaningfulContent(source) ? [source] : [];
}

function inferredUncoveredContentNodes(source, existingCandidates) {
  if (source.matches?.(inferredBarrierSelector)) return [];
  const overlapping = existingCandidates.filter(candidate => candidate.role !== 'user' &&
    (source === candidate.node || candidate.node.contains(source) || source.contains(candidate.node)));
  if (!overlapping.some(candidate => source !== candidate.node && source.contains(candidate.node))) {
    return overlapping.length || !inferredContentNodes(source).length ? [] : [{ node: source, contentNode: source }];
  }
  // A reply shell may contain reported prose plus streamed element branches
  // beside it. Keep those uncovered children without duplicating the reported
  // candidate.
  return [...source.children].flatMap(child => inferredUncoveredContentNodes(child, existingCandidates));
}

function sectionCollapseNodes(section, root, sections) {
  if (!section.identityNode || !root.contains(section.identityNode)) return [...new Set(section.nodes)];
  const sources = [...new Set([section.identityNode, ...section.nodes])].filter(node => root.contains(node));
  const foreignBubbles = sections.filter(other => other !== section)
    .flatMap(other => [other.identityNode, ...other.nodes]).filter(Boolean);
  const nextIdentity = sections.slice(sections.indexOf(section) + 1).map(other => other.identityNode)
    .find(node => node && root.contains(node));
  const presentationHint = /action|toolbar|control|reaction|gallery|reference|citation|source/i;
  const isPresentationBranch = node => {
    if (containsCollapseUnsafe(node)) return false;
    if (foreignBubbles.some(foreign => node === foreign || node.contains(foreign))) return false;
    const hint = `${node.id || ''} ${node.className?.baseVal || node.className || ''} ${node.getAttribute?.('data-testid') || ''} ${node.getAttribute?.('aria-label') || ''}`
      .split(/\s+/).some(value => presentationHint.test(value));
    if (hint) return true;
    if (hasMeaningfulContent(node)) return false;
    return node.matches?.('button,[aria-hidden="true"],[hidden],.sr-only,[role="toolbar"],[role="presentation"]') ||
      node.querySelector?.('button,[aria-hidden="true"],[hidden],.sr-only,[role="toolbar"],[role="presentation"]') || false;
  };
  const safeWrapper = node => {
    if (collapseUnsafe(node)) return null;
    if (isCollapsibleCodePanel(node)) {
      for (let ancestor = node.parentElement; ancestor && ancestor !== root; ancestor = ancestor.parentElement) {
        if (collapseUnsafe(ancestor)) return null;
        if (foreignBubbles.some(foreign => ancestor === foreign || ancestor.contains(foreign))) break;
      }
      return node;
    }
    let best = node;
    for (let ancestor = node.parentElement; ancestor && ancestor !== root; ancestor = ancestor.parentElement) {
      if (collapseUnsafe(ancestor)) break;
      if (foreignBubbles.some(foreign => ancestor === foreign || ancestor.contains(foreign))) break;
      if (containsCollapseUnsafe(ancestor)) break;
      best = ancestor;
    }
    return best;
  };
  const safePieces = node => {
    if (foreignBubbles.includes(node)) return [];
    if (foreignBubbles.some(foreign => node.contains(foreign))) return [...node.children].flatMap(child => safePieces(child));
    if (isCollapsibleCodePanel(node)) return [safeWrapper(node)].filter(Boolean);
    if (collapseUnsafe(node)) return [];
    if (containsCollapseUnsafe(node)) {
      return [...node.children].flatMap(child => safePieces(child));
    }
    return [safeWrapper(node)].filter(Boolean);
  };
  const targets = [...new Set(sources.flatMap(safePieces))];
  // Also collapse presentation branches that sit beside a captured message
  // inside its prompt-to-prompt interval. Some ChatGPT layouts put actions,
  // references, or empty gallery shells after the reply wrapper as siblings.
  for (const source of sources) {
    if (nextIdentity && (source === nextIdentity || nextIdentity.contains(source) ||
        (source.compareDocumentPosition(nextIdentity) & 2))) continue;
    let pathNode = source;
    for (let parent = source.parentElement; parent && root.contains(parent); pathNode = parent, parent = parent.parentElement) {
      for (const sibling of parent.children) {
        if (sibling === pathNode || !(pathNode.compareDocumentPosition(sibling) & 4)) continue;
        if (nextIdentity && (sibling === nextIdentity ||
            (sibling.compareDocumentPosition(nextIdentity) & 2))) continue;
        if (isPresentationBranch(sibling) || hasMeaningfulContent(sibling) || sibling.matches?.('pre,code') || sibling.querySelector?.('pre,code')) {
          targets.push(...safePieces(sibling));
        }
      }
      if (parent === root) break;
    }
  }
  const uniqueTargets = [...new Set(targets)];
  return uniqueTargets.filter(target => !uniqueTargets.some(ancestor => ancestor !== target && ancestor.contains(target)));
}

function chatGptSiblingContent(anchor, stopAt, bubbles, existingCandidates) {
  const result = [];
  // A turn branch that is itself the user bubble has no in-branch siblings.
  // In particular, do not climb past it into adjacent turns or page chrome.
  if (anchor === stopAt || !stopAt?.contains(anchor)) return result;
  let pathNode = anchor;
  for (let parent = anchor.parentElement; parent && stopAt.contains(parent); pathNode = parent, parent = parent.parentElement) {
    for (const sibling of parent.children) {
      if (sibling === pathNode || pathNode.contains(sibling) || bubbles.some(bubble => sibling === bubble || sibling.contains(bubble))) continue;
      if (!(anchor.compareDocumentPosition(sibling) & 4)) continue;
      for (const candidate of inferredUncoveredContentNodes(sibling, existingCandidates)) result.push({ ...candidate, role: 'message' });
    }
    if (parent === stopAt) break;
  }
  return result;
}

function chatGptInferredTurns(root, bubbles, existingCandidates) {
  const result = [];

  if (bubbles.length > 1) {
    const common = chatGptCommonAncestor(bubbles);
    if (!common) return result;
    const branches = [...common.children];
    const branchFor = bubble => {
      let branch = bubble;
      while (branch.parentElement && branch.parentElement !== common) branch = branch.parentElement;
      return branch;
    };
    const first = branches.indexOf(branchFor(bubbles[0]));
    if (first < 0) return result;
    for (const branch of branches.slice(first)) {
      const containedBubbles = bubbles.filter(bubble => branch === bubble || branch.contains(bubble));
      if (containedBubbles.length) {
        for (const bubble of containedBubbles) result.push(...chatGptSiblingContent(bubble, branch, bubbles, existingCandidates));
      }
      else {
        for (const candidate of inferredUncoveredContentNodes(branch, existingCandidates)) result.push({ ...candidate, role: 'message' });
      }
    }
    return result;
  }

  // With one prompt there is no repeated user boundary to establish a message
  // list. Walk outward only through the selected conversation root and use
  // following sibling branches. This can recover a nested reply while keeping
  // the adapter anchored to the actual user bubble.
  const bubble = bubbles[0];
  if (!bubble) return result;
  result.push(...chatGptSiblingContent(bubble, root, bubbles, existingCandidates));
  return result;
}

export function extractConversation(doc = document, url = location.href, options = {}) {
  const host = new URL(url).hostname;
  const includeMarkdown = options.includeMarkdown !== false;
  const media = [];
  const mediaOrdinals = new Map();
  let td;
  const layoutProperties = ['display','position','inset','top','right','bottom','left','box-sizing','width','max-width','min-width','height','min-height','max-height','overflow','overflow-x','overflow-y','margin','padding','color','background-color','background-image','background-size','background-position','background-repeat','font','font-size','font-weight','font-family','line-height','letter-spacing','text-align','text-decoration','text-transform','text-indent','white-space','word-break','overflow-wrap','list-style','list-style-position','list-style-type','border','border-top','border-right','border-bottom','border-left','border-radius','border-collapse','border-spacing','table-layout','box-shadow','vertical-align','opacity','order','flex','flex-direction','flex-wrap','flex-grow','flex-shrink','flex-basis','align-items','align-self','justify-content','gap','grid','grid-area','grid-column','grid-row','grid-template-columns','grid-template-rows','grid-auto-flow','justify-self','object-fit','columns','column-count','column-gap','column-rule','break-inside','break-before','break-after','fill','fill-opacity','fill-rule','stroke','stroke-width','stroke-linecap','stroke-linejoin','stroke-dasharray','stroke-dashoffset','stroke-opacity'];
  const layoutStyleValues = element => {
    const collapsed = [];
    for (let current = element; current?.nodeType === 1; current = current.parentElement) {
      if (current.classList.contains('idea-capture-section-collapsed')) {
        current.classList.remove('idea-capture-section-collapsed');
        collapsed.push(current);
      }
    }
    try {
      const computed = doc.defaultView.getComputedStyle(element);
      return Object.fromEntries(layoutProperties.map(property => [property, computed.getPropertyValue(property)]));
    } finally {
      collapsed.forEach(node => node.classList.add('idea-capture-section-collapsed'));
    }
  };
  const inlineLayoutStyles = (source, clone, originalForClone) => {
    const copies = [clone, ...clone.querySelectorAll('*')];
    copies.forEach(element => {
      const original = element === clone ? source : originalForClone.get(element);
      if (!original) return;
      const computed = layoutStyleValues(original);
      const declarations = layoutProperties.map(property => `${property}:${computed[property]}`).filter(value => !value.endsWith(':'));
      element.setAttribute('style', declarations.join(';'));
      for (const attribute of [...element.attributes]) {
        if (/^on/i.test(attribute.name) || attribute.name === 'srcdoc') element.removeAttribute(attribute.name);
      }
    });
  };
  const captureLayoutTree = messages => {
    const sourceNodes = messages.map(message => message.node).filter(node => node?.nodeType === 1);
    if (!sourceNodes.length) return '';
    const ancestors = new Set();
    for (let current = sourceNodes[0]; current; current = current.parentElement) ancestors.add(current);
    let root = sourceNodes[0].parentElement;
    while (root && !sourceNodes.every(node => root === node || root.contains(node))) root = root.parentElement;
    while (root && !ancestors.has(root)) root = root.parentElement;
    if (!root) return '';
    const pageRoot = sourceNodes[0].closest('main,[role="main"],#thread');
    if (pageRoot && sourceNodes.every(node => pageRoot === node || pageRoot.contains(node))) root = pageRoot;
    const clone = root.cloneNode(true);
    const originals = [root, ...root.querySelectorAll('*')];
    const clones = [clone, ...clone.querySelectorAll('*')];
    const cloneBySource = new Map(originals.map((node, index) => [node, clones[index]]));
    const selected = [];
    for (const message of messages) {
      const target = message.node;
      const targetClone = cloneBySource.get(target);
      if (!targetClone?.parentNode || !message.html) continue;
      const fragment = doc.createElement('template');
      fragment.innerHTML = message.html;
      const roots = [...fragment.content.childNodes].filter(node => node.nodeType === 1);
      let replacement;
      if (roots.length === 1 && fragment.content.childNodes.length === 1 && message.contentNode === target) {
        replacement = roots[0];
      } else {
        replacement = doc.createElement('div');
        replacement.append(fragment.content);
        const computed = doc.defaultView.getComputedStyle(target);
        const styles = layoutStyleValues(target);
        replacement.setAttribute('style', `display:${styles.display};width:${styles.width};max-width:${styles['max-width']};margin:${styles.margin};padding:${styles.padding};box-sizing:${styles['box-sizing']};color:${styles.color};background-color:${styles['background-color']};order:${styles.order};flex:${styles.flex};align-self:${styles['align-self']};justify-self:${styles['justify-self']};grid-area:${styles['grid-area']};grid-column:${styles['grid-column']};grid-row:${styles['grid-row']}`);
      }
      replacement.setAttribute('data-idea-export-section', message.sectionId || '');
      replacement.setAttribute('aria-label', message.role);
      if (targetClone === clone) {
        clone.replaceChildren(...replacement.childNodes);
        clone.setAttribute('data-idea-export-section', message.sectionId || '');
        clone.setAttribute('aria-label', message.role);
        selected.push(clone);
        continue;
      }
      targetClone.replaceWith(replacement);
      selected.push(replacement);
    }
    if (!selected.length) return '';
    const keep = new Set();
    const ancestorPath = new Set();
    for (const element of selected) {
      for (let current = element; current; current = current.parentElement) { keep.add(current); ancestorPath.add(current); }
      element.querySelectorAll('*').forEach(child => keep.add(child));
    }
    for (const element of [...clone.querySelectorAll('*')].reverse()) if (!keep.has(element)) element.remove();
    for (const ancestor of ancestorPath) if (!selected.includes(ancestor)) for (const child of [...ancestor.childNodes]) if (child.nodeType !== 1) child.remove();
    // Retain the page's real layout ancestors (main/thread/turn containers)
    // while removing every unselected sibling and page chrome branch.
    const paths = new Set();
    for (const element of selected) for (let current = element; current; current = current.parentElement) paths.add(current);
    for (const element of paths) {
      const original = originals[clones.indexOf(element)];
      if (!original) continue;
      const computed = layoutStyleValues(original);
      // Ancestor dimensions were measured with unselected branches present.
      // Keeping fixed heights or explicit grid rows leaves large blank areas
      // after pruning, so let the retained conversation content size them.
      computed.height = 'auto'; computed['min-height'] = '0'; computed['max-height'] = 'none';
      computed.overflow = 'visible'; computed['grid-template-rows'] = 'none';
      element.setAttribute('style', layoutProperties.map(property => `${property}:${computed[property]}`).filter(value => !value.endsWith(':')).join(';'));
      for (const attribute of [...element.attributes]) if (/^on/i.test(attribute.name) || ['src','srcset','poster','action','formaction','srcdoc'].includes(attribute.name)) element.removeAttribute(attribute.name);
    }
    return clone.outerHTML;
  };
  const convert = (node, messageRole, messageIndex) => {
    if (!includeMarkdown) return '';
    if (!isVisibleConversationNode(node)) return '';
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
    const copy = doc.createElement('div');
    const cloned = node.cloneNode(true);
    copy.append(cloned);
    const originalElements = [...node.querySelectorAll('*')];
    const clonedElements = [...cloned.querySelectorAll('*')];
    const originalForClone = new WeakMap(clonedElements.map((element, index) => [element, originalElements[index]]));
    originalElements.forEach((original, index) => {
      if (!isVisibleConversationNode(original)) clonedElements[index]?.remove();
    });
    copy.querySelectorAll(exportExcludedSelector).forEach(n => n.remove());

    let mediaOrdinal = mediaOrdinals.get(messageIndex) || 0;
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
        ...(options.includeLayout ? { layoutStyle: (() => {
          const computed = layoutStyleValues(originalForClone.get(element) || element);
          return layoutProperties.map(property => `${property}:${computed[property]}`).filter(value => !value.endsWith(':')).join(';');
        })() } : {}),
        ...(error ? { error } : {}),
      };
      media.push(item);
      mediaOrdinals.set(messageIndex, mediaOrdinal);
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
    const mediaSelector = `img[src],img[srcset],audio[src],video[src],audio source[src],video source[src],object[data],embed[src],iframe[src],canvas${options.includeLayout ? '' : ',svg[aria-label]'}`;
    const mediaElements = [...copy.querySelectorAll(mediaSelector)];
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
        const originalCanvas = originalForClone.get(element) || (node.matches?.('canvas') ? node : null);
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
    copy.querySelectorAll(`${options.includeLayout ? '' : 'svg,'}[data-idea-capture-control],[data-idea-capture-owned]`).forEach(n => n.remove());
    copy.querySelectorAll('a[href],img[src]').forEach(n => {
      const attr = n.tagName === 'A' ? 'href' : 'src';
      try {
        const link = new URL(n.getAttribute(attr), url);
        if (!['http:', 'https:'].includes(link.protocol)) n.removeAttribute(attr);
        else n.setAttribute(attr, link.href);
      } catch { n.removeAttribute(attr); }
    });
    if (options.includeLayout) {
      inlineLayoutStyles(node, cloned, originalForClone);
      // Inline computed SVG paint values so charts and diagrams do not depend
      // on the source page's stylesheet after export.
      for (const svg of cloned.querySelectorAll('svg')) {
        const originalSvg = originalForClone.get(svg);
        const svgNodes = [svg, ...svg.querySelectorAll('*')];
        for (const child of svgNodes) {
          const original = child === svg ? originalSvg : originalForClone.get(child);
          if (!original) continue;
          const computed = doc.defaultView.getComputedStyle(original);
          const styles = ['fill','fill-opacity','fill-rule','stroke','stroke-width','stroke-linecap','stroke-linejoin','stroke-dasharray','stroke-dashoffset','stroke-opacity','color','opacity'];
          for (const property of styles) {
            const value = computed.getPropertyValue(property);
            if (value) child.style.setProperty(property, value);
          }
          for (const attribute of [...child.attributes]) if (/^on/i.test(attribute.name)) child.removeAttribute(attribute.name);
        }
        svg.querySelectorAll('script,foreignObject,animate,animateMotion,animateTransform,set').forEach(child => child.remove());
        for (const child of [svg, ...svg.querySelectorAll('*')]) for (const name of ['href','xlink:href']) {
          const value = child.getAttribute(name);
          if (value && !value.startsWith('#') && !value.startsWith('data:image/')) child.removeAttribute(name);
        }
      }
    }
    return { markdown: td.turndown(copy.innerHTML).trim(), ...(options.includeLayout ? { html: cloned.outerHTML } : {}) };
  };
  let provider = 'Other';
  let candidates = [];
  let unlabeledChatGptTurns = false;
  let chatGptPromptsOnly = false;
  if (/(^|\.)(chatgpt\.com|chat\.openai\.com)$/.test(host)) {
    provider = 'ChatGPT';
    const root = chatGptConversationRoot(doc);
    candidates = [...root.querySelectorAll('[data-message-author-role]')]
      .filter(node => !isInSidebar(node))
      .filter(isVisibleConversationNode)
      .filter(node => hasMeaningfulContent(node))
      .map(node => ({ node, role: node.dataset.messageAuthorRole }));
    const turns = [...root.querySelectorAll('[data-testid^="conversation-turn-"], article[data-turn-id], article')]
      .filter(node => !isInSidebar(node) && isVisibleConversationNode(node))
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
    for (const candidate of chatGptClassTurns(root)) {
      // Semantic role attributes and labeled turn articles take precedence
      // over generic prose classes, which can also occur inside user turns.
      if (!candidates.some(existing => existing.node === candidate.node || existing.node.contains(candidate.node))) {
        candidates.push(candidate);
      }
    }
    const userBubbles = [...root.querySelectorAll(chatGptUserBubbleSelector)]
      .filter(node => !isInSidebar(node) && isVisibleConversationNode(node) && hasMeaningfulContent(node));
    const inferredTurns = chatGptInferredTurns(root, userBubbles, candidates);
    for (const candidate of inferredTurns) {
      if (!candidates.some(existing => existing.node === candidate.node || existing.node.contains(candidate.node))) candidates.push(candidate);
    }
    if (inferredTurns.length) unlabeledChatGptTurns = true;
    chatGptPromptsOnly = userBubbles.length > 0 && !candidates.some(candidate => candidate.role === 'assistant') && inferredTurns.length === 0;
    const uncoveredTurns = unrecognizedTurns.filter(node => !candidates.some(candidate => node.contains(candidate.node)));
    const isConversationRoute = /\/c\/[^/]+/.test(new URL(url).pathname);
    if (uncoveredTurns.length && isConversationRoute && candidates.length) {
      candidates.push(...uncoveredTurns.map(node => ({ node, role: 'message' })));
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
  candidates = candidates.filter(({ node, role }) => isVisibleConversationNode(node) &&
    !candidates.some(other => other.node !== node && other.role === role && other.node.contains(node)));
  // A neutral branch can be split by nested action controls or presentation
  // labels. Treat adjacent inferred fragments as one logical reply.
  const logicalCandidates = [];
  for (const candidate of candidates) {
    const previous = logicalCandidates.at(-1);
    const explicitTurn = node => node?.closest?.('[data-testid^="conversation-turn-"], article[data-turn-id]');
    const previousTurn = explicitTurn(previous?.node);
    const candidateTurn = explicitTurn(candidate.node);
    const sameInferredTurn = !previousTurn && !candidateTurn || previousTurn && candidateTurn && previousTurn === candidateTurn;
    if (candidate.role === 'message' && previous?.role === 'message' && sameInferredTurn && candidate.contentNode) {
      previous.nodes.push(...(candidate.nodes || [candidate.node]));
      previous.contentNodes.push(...(candidate.contentNodes || [candidate.contentNode || candidate.node]));
    } else {
      logicalCandidates.push({ ...candidate, nodes: candidate.nodes || [candidate.node], contentNodes: candidate.contentNodes || [candidate.contentNode || candidate.node] });
    }
  }
  const messages = logicalCandidates.map(({ node, role, contentNode: inferredNode, nodes, contentNodes }, messageIndex) => {
    let contentNode = contentNodes.length === 1 ? (inferredNode || contentNodes[0]) : contentNodes;
    if (provider === 'ChatGPT' && !inferredNode) {
      const wrapper = node.closest('[data-testid^="conversation-turn-"], article, [data-turn-id], [data-message-id], [class*="assistant-turn"], [class*="agent-turn"]');
      if (wrapper && wrapper !== node) {
        const nestedCandidates = logicalCandidates.filter(candidate => wrapper.contains(candidate.node));
        if (nestedCandidates.length === 1 && nestedCandidates[0].node === node) contentNode = wrapper;
      }
    }
    const converted = (Array.isArray(contentNode) ? contentNode : [contentNode])
      .map(part => convert(part, ({ user: 'User', assistant: 'Assistant', system: 'System' })[role] || 'Message', messageIndex))
      .filter(Boolean);
    const markdown = converted.map(item => item.markdown).join('\n\n').trim();
    const html = options.includeLayout ? converted.map(item => item.html).join('\n') : undefined;
    return { node, nodes, contentNode, providerId: messageId(node), messageIndex, role: ({ user: 'User', assistant: 'Assistant', system: 'System' })[role] || 'Message', markdown, ...(html ? { html } : {}) };
  }).filter(message => !includeMarkdown || message.markdown);
  let warning = 'Captures messages currently loaded on the page. Load older messages before exporting; detected media is included when available, and hidden branches are not included.';
  if (unlabeledChatGptTurns) warning = 'Some ChatGPT messages did not expose a speaker label. Their order was inferred from visible turn structure; review the preview before saving. Only loaded content is included.';
  if (chatGptPromptsOnly) warning = 'ChatGPT user prompts were detected, but reply boundaries could not be identified. The capture may be incomplete; review the preview before saving. Only loaded content is included.';
  if (!messages.length && provider === 'Other') {
    const main = doc.querySelector('main, [role="main"], article');
    if (main && hasMeaningfulContent(main)) {
      const converted = convert(main, 'Page content', 0);
      const markdown = converted.markdown;
      if (!includeMarkdown || markdown) {
        messages.push({ node: main, contentNode: main, providerId: null, messageIndex: 0, role: 'Page content', markdown, ...(converted.html ? { html: converted.html } : {}) });
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
    current.nodes.push(...(message.nodes || [message.node]));
  }
  if (provider === 'ChatGPT') for (const section of sections) section.collapseNodes = sectionCollapseNodes(section, chatGptConversationRoot(doc), sections);
  const publicSections = sections.map(({ id, label, messages: sectionMessages, nodes, identityNode, collapseNodes }) => ({
    id, label, messageCount: sectionMessages.length,
    ...(options.includeNodes ? { nodes, identityNode, collapseNodes: collapseNodes || nodes } : {}),
  }));
  const layoutHtml = options.includeLayout ? captureLayoutTree(messages) : undefined;
  const publicMessages = messages.map(({ node, nodes, contentNode, providerId, ...message }) => message);
  const streaming = !!doc.querySelector('[data-is-streaming="true"], [data-testid="stop-button"], button[aria-label="Stop response"]');
  const layout = options.includeLayout ? Object.fromEntries(['color','background-color','font-family','font-size','line-height','margin','padding'].map(property => [property, layoutStyleValues(doc.body || doc.documentElement)[property]])) : undefined;
  return { title: doc.title.replace(/\s*[-|–]\s*(ChatGPT|Claude|Gemini)\s*$/i, '').trim() || 'Conversation', url, provider, capturedAt: new Date().toISOString(), warning, messages: publicMessages, sections: publicSections, media, streaming, ...(layout ? { layout, layoutHtml } : {}) };
}
