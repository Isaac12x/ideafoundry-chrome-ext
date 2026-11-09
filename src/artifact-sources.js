// Resolve only frames referenced by selected artifacts. The injected function
// reads original source; it never evaluates the captured application.
export async function resolveArtifactSources(conversation, tabId, scripting = chrome.scripting) {
  const pending = (conversation.artifacts || []).filter(item => item.unavailableReason && item.frameUrl);
  if (!pending.length) return conversation;
  const urls = [...new Set(pending.map(item => item.frameUrl))];
  const results = await scripting.executeScript({
    target: { tabId, allFrames: true },
    func: async requested => {
      if (window === window.top || !requested.includes(location.href)) return null;
      try {
        if (!/^https?:$/.test(location.protocol) && location.protocol !== 'blob:') throw new Error('This artifact frame does not expose a readable source URL.');
        const response = await fetch(location.href, { credentials: 'same-origin', redirect: 'error', signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error(`Artifact source request failed (${response.status}).`);
        if (!/text\/html|application\/xhtml\+xml/i.test(response.headers.get('content-type') || '')) throw new Error('Artifact frame did not return an HTML source document.');
        return { url: location.href, html: await response.text() };
      } catch (error) {
        return { url: location.href, error: error.message };
      }
    },
    args: [urls],
  });
  return {
    ...conversation,
    artifacts: conversation.artifacts.map(item => {
      if (!pending.includes(item)) return item;
      const matches = results.map(entry => entry.result).filter(result => result?.url === item.frameUrl);
      if (matches.length !== 1 || !matches[0].html) return { ...item, unavailableReason: matches[0]?.error || 'Artifact source could not be uniquely read from its preview frame. Open its source view and capture again.' };
      const { unavailableReason, ...artifact } = item;
      return { ...artifact, kind: 'html', source: { html: matches[0].html, baseUrl: item.frameUrl } };
    }),
  };
}
