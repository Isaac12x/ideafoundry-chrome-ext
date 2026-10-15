import { defaults, withDefaults, validateSettings, validateJob, httpUrl, urlMatchesCaptureSites, resolveCaptureSites } from './shared.js';
import { uploadInApp } from './kb-upload.js';
import { mediaOrigins } from './media.js';
import { handleActionClick } from './action.js';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const settings = async () => withDefaults((await chrome.storage.local.get('settings')).settings || defaults);
let rendering;
let polling = false;
async function ensureRenderer() {
  if (rendering) return rendering;
  rendering = (async () => {
    if (!(await chrome.offscreen.hasDocument())) await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['BLOBS'], justification: 'Generate PDF and Markdown files locally and create download URLs.' });
  })();
  try { await rendering; } finally { rendering = null; }
}
async function render(conversation, format, download, assetBase = null) {
  if (!['md', 'pdf'].includes(format)) throw new Error('Choose Markdown or PDF.');
  await ensureRenderer();
  const result = await chrome.runtime.sendMessage({ target: 'offscreen', conversation, format, download, assetBase });
  if (!result?.ok) throw new Error(result?.error || 'File generation failed.');
  return result;
}
async function capture(tabId, mode = 'preview', resolvePageMedia = false) {
  const tab = await chrome.tabs.get(tabId);
  httpUrl(tab.url);
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func: mode => {
    if (!globalThis.__ideaCapture?.ok || !globalThis.__ideaCaptureController) return { ok: false, error: globalThis.__ideaCapture?.error || 'Could not initialize section controls.' };
    try { return { ok: true, conversation: globalThis.__ideaCaptureController.capture(mode) }; }
    catch (error) { return { ok: false, error: error.message }; }
  }, args: [mode] });
  if (!result?.ok) throw new Error(result?.error || 'Could not read this page.');
  const conversation = result.conversation;
  if ((mode === 'export' || resolvePageMedia) && conversation.media?.length) {
    const pageResults = await chrome.scripting.executeScript({ target: { tabId }, func: async (items, maxBytes) => {
      const results = [];
      let total = 0;
      for (const item of items) {
        let url;
        try { url = new URL(item.url, location.href); } catch { continue; }
        if (url.username || url.password) { results.push({ id: item.id, error: 'Media URL contains embedded credentials and was omitted.' }); continue; }
        if (!(url.protocol === 'blob:' || ((url.protocol === 'http:' || url.protocol === 'https:') && url.origin === location.origin))) continue;
        try {
          const response = await fetch(url.href, { credentials: 'same-origin', redirect: 'error', signal: AbortSignal.timeout(15_000) });
          if (!response.ok) throw new Error(`Page media read failed (${response.status}).`);
          const declaredLength = Number(response.headers.get('content-length'));
          if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new Error('Page-owned media exceeds the 8 MB capture limit.');
          const reader = response.body.getReader();
          const chunks = [];
          let size = 0;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength; total += value.byteLength;
            if (size > maxBytes || total > maxBytes) { await reader.cancel(); throw new Error('Page-owned media exceeds the 8 MB capture limit.'); }
            chunks.push(value);
          }
          const blob = new Blob(chunks, { type: response.headers.get('content-type') || item.mime || '' });
          const data = await new Promise((resolve, reject) => {
            const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error('Could not read page media.')); reader.readAsDataURL(blob);
          });
          results.push({ id: item.id, data, mime: blob.type || item.mime || 'application/octet-stream' });
        } catch (error) { results.push({ id: item.id, error: error.message }); }
      }
      return results;
    }, args: [conversation.media, 8 * 1024 * 1024] });
    const pageMedia = new Map((pageResults[0]?.result || []).map(item => [item.id, item]));
    conversation.media = conversation.media.map(item => pageMedia.has(item.id) ? { ...item, ...pageMedia.get(item.id) } : item);
  }
  if (JSON.stringify(conversation).length > 24_000_000) throw new Error('Conversation and inline media exceed the 24 MB capture limit.');
  return conversation;
}
async function loaded(tabId) {
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    if ((await chrome.tabs.get(tabId)).status === 'complete') return;
    await pause(500);
  }
  throw new Error('Page loading timed out. Open it in your browser and retry.');
}
async function permitted(origin) {
  if (!(await chrome.permissions.contains({ origins: [`${origin}/*`] }))) throw new Error(`Allow this site in the browser's extension site access settings: ${origin}`);
}
async function sendToKB(conversation, format) {
  conversation = await permissionFilteredMedia(conversation);
  const config = validateSettings(await settings());
  await permitted(config.appUrl);
  const file = await render(conversation, format, false, { appUrl: config.appUrl, source: config.source, directory: config.directory });
  const tabs = await chrome.tabs.query({ url: `${config.appUrl}/*` });
  let tab = tabs[0];
  const created = !tab;
  if (created) tab = await chrome.tabs.create({ url: `${config.appUrl}/knowledge-base`, active: false });
  try {
    await loaded(tab.id);
    const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: uploadInApp, args: [file, { appUrl: config.appUrl, source: config.source, directory: config.directory }] });
    if (!results[0]?.result) throw new Error('Upload did not finish. Check the KB before retrying.');
    if (!results[0].result.ok) throw new Error(results[0].result.error);
    return results[0].result;
  } finally {
    if (created) await chrome.tabs.remove(tab.id).catch(() => {});
  }
}
async function permissionFilteredMedia(conversation) {
  const missing = [];
  for (const origin of mediaOrigins(conversation)) if (!(await chrome.permissions.contains({ origins: [origin] }))) missing.push(origin);
  if (!missing.length) return conversation;
  const missingHosts = new Set(missing.map(value => new URL(value.replace(/\*$/, '')).origin));
  return { ...conversation, media: (conversation.media || []).map(item => {
    try {
      if (item.data || item.error) return item;
      if (missingHosts.has(new URL(item.url).origin)) return { ...item, error: 'Browser site access is disabled for this media site. Allow access in the extension menu and retry.' };
    } catch { /* data and page-owned blob media need no host permission */ }
    return item;
  }) };
}
async function queueRequest(config, path, body) {
  const response = await fetch(`${config.queueUrl}${path}`, {
    method: 'POST', headers: { Authorization: `Bearer ${config.queueToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}), signal: AbortSignal.timeout(15_000), redirect: 'error', credentials: 'omit',
  });
  if (!response.ok) throw new Error(`Queue request failed (${response.status}).`);
  return response.status === 204 ? null : response.json();
}
async function status(value) { await chrome.storage.local.set({ remoteStatus: { ...value, updatedAt: new Date().toISOString() } }); }
async function poll() {
  if (polling) return;
  polling = true;
  let tabId;
  try {
    const config = validateSettings(await settings());
    if (!config.remoteEnabled) return;
    await permitted(new URL(config.queueUrl).origin);
    // Resume only result delivery after a worker restart, never repeat an uncertain upload.
    const { pendingResult } = await chrome.storage.local.get('pendingResult');
    if (pendingResult) {
      if (pendingResult.queueUrl !== config.queueUrl) throw new Error('An undelivered result belongs to the previous queue. Restore its address to deliver it.');
      await queueRequest(config, `/jobs/${pendingResult.id}/complete`, pendingResult.result);
      await chrome.storage.local.remove('pendingResult');
      await status(pendingResult.result);
      return;
    }
    const incoming = await queueRequest(config, '/jobs/claim');
    if (!incoming) { await status({ state: 'idle' }); return; }
    let result;
    try {
      const job = validateJob(incoming, config.captureSites);
      // Persist an uncertain failure before any capture/upload; a restart will report it, not retry it.
      await chrome.storage.local.set({ pendingResult: { id: job.id, queueUrl: config.queueUrl, result: { state: 'failed', error: 'Capture interrupted. Check the KB before submitting a new job.' } } });
      await permitted(httpUrl(job.url).origin);
      await status({ state: 'capturing', jobId: job.id });
      const tab = await chrome.tabs.create({ url: job.url, active: false });
      tabId = tab.id;
      await loaded(tabId);
      let conversation;
      let previous = '';
      let stable = 0;
      const deadline = Date.now() + 45_000;
      while (Date.now() < deadline) {
        await pause(2000);
        const currentTab = await chrome.tabs.get(tabId);
        if (httpUrl(currentTab.url).origin !== httpUrl(job.url).origin) throw new Error('Conversation redirected to another origin. Sign in and retry.');
        try { conversation = await capture(tabId, 'all'); } catch { continue; }
        const fingerprint = JSON.stringify(conversation.messages);
        stable = fingerprint === previous ? stable + 1 : 0;
        previous = fingerprint;
        if (stable >= 3 && !conversation.streaming) break;
      }
      if (!conversation || stable < 3 || conversation.streaming) throw new Error('Conversation did not finish loading. Sign in, finish generation, and retry.');
      if (conversation.provider === 'Other' && conversation.messages[0]?.role === 'Page content') throw new Error('Remote capture requires identifiable messages. Review generic pages in the on-page widget.');
      conversation = await capture(tabId, 'all', true);
      // Honor disable/reconfiguration before exporting content.
      const latest = await settings();
      const latestConfig = validateSettings(latest);
      if (!latest.remoteEnabled || latest.queueUrl !== config.queueUrl || latest.appUrl !== config.appUrl || !urlMatchesCaptureSites(job.url, latestConfig.captureSites)) throw new Error('Remote settings changed; capture cancelled.');
      const saved = await sendToKB(conversation, job.format);
      result = { state: 'completed', filename: saved.name };
    } catch (error) { result = { state: 'failed', error: error.message }; }
    await chrome.storage.local.set({ pendingResult: { id: incoming.id, queueUrl: config.queueUrl, result } });
    await queueRequest(config, `/jobs/${encodeURIComponent(incoming.id)}/complete`, result);
    await chrome.storage.local.remove('pendingResult');
    await status(result);
  } catch (error) { await status({ state: 'error', error: error.message }); }
  finally { if (tabId) await chrome.tabs.remove(tabId).catch(() => {}); polling = false; }
}
async function alarm() {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  const config = await settings();
  if (config.remoteEnabled) await chrome.alarms.create('remote-capture', { periodInMinutes: 0.5 });
  else await chrome.alarms.clear('remote-capture');
}
async function registerActionMenu() {
  await chrome.contextMenus.removeAll().catch(() => {});
  try {
    chrome.contextMenus.create({ id: 'idea-capture-settings', title: 'Open capture settings', contexts: ['action'] });
  } catch (error) { console.warn('IdeaFoundry settings menu could not be registered:', error.message); }
}
chrome.runtime.onInstalled.addListener(() => { void alarm(); void registerActionMenu(); });
chrome.runtime.onStartup.addListener(() => { void alarm(); void registerActionMenu(); });
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'idea-capture-settings') return;
  await chrome.runtime.openOptionsPage();
  if (tab?.id) {
    await chrome.action.setBadgeText({ tabId: tab.id, text: '' });
    await chrome.action.setTitle({ tabId: tab.id, title: 'IdeaFoundry capture widget' });
  }
});
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'remote-capture') void poll(); });
chrome.action.onClicked.addListener(async tab => {
  const clearBadge = async () => {
    if (!tab?.id) return;
    await chrome.action.setBadgeText({ tabId: tab.id, text: '' });
    await chrome.action.setTitle({ tabId: tab.id, title: 'IdeaFoundry capture widget' });
  };
  try {
    const outcome = await handleActionClick(tab, {
      getSettings: settings,
      openOptions: () => chrome.runtime.openOptionsPage(),
      injectCapture: async tabId => {
        await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
        const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func: () => {
          if (globalThis.__ideaCaptureBoot) return Promise.resolve(globalThis.__ideaCaptureBoot).then(() => {
            const controller = globalThis.__ideaCaptureController;
            if (!controller) return { ok: false, error: globalThis.__ideaCapture?.error || 'Could not start the capture widget.' };
            controller.open(); return { ok: true };
          });
          const controller = globalThis.__ideaCaptureController;
          if (!controller) return { ok: false, error: globalThis.__ideaCapture?.error || 'Could not start the capture widget.' };
          controller.open(); return { ok: true };
        } });
        if (!result?.ok) throw new Error(result?.error || 'Could not open the capture widget.');
      },
    });
    if (outcome.error && !outcome.settingsOpened) throw outcome.error;
    if (outcome.excluded && tab?.id) await chrome.action.setTitle({ tabId: tab.id, title: 'Add this site under Allowed capture URLs, then refresh the page.' });
    if (outcome.error && tab?.id) await chrome.action.setTitle({ tabId: tab.id, title: `Capture unavailable: ${outcome.error.message}` });
    if (outcome.captured) await clearBadge();
  } catch (error) {
    console.warn('IdeaFoundry capture could not open:', error.message);
    if (tab?.id) {
      await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#a64d31' });
      await chrome.action.setBadgeText({ tabId: tab.id, text: '!' });
      await chrome.action.setTitle({ tabId: tab.id, title: `Capture unavailable: ${error.message}` });
    }
  }
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message.target === 'offscreen') return;
  const fromExtension = sender.url?.startsWith(chrome.runtime.getURL(''));
  if (!fromExtension && !sender.tab?.id) return;
  (async () => {
    if (message.type === 'get-capture-sites') {
      if (!sender.tab?.id) throw new Error('Capture settings are available only to an open page.');
      return { captureSites: resolveCaptureSites(await settings()) };
    }
    if (message.type === 'open-settings') { await chrome.runtime.openOptionsPage(); return {}; }
    if (message.type === 'widget-export') {
      if (!sender.tab?.id || !['download', 'kb'].includes(message.destination)) throw new Error('Capture must be started from the page widget.');
      if (!message.conversation || !Array.isArray(message.conversation.messages)) throw new Error('No conversation is ready to save.');
      const conversation = message.conversation;
      if (JSON.stringify(conversation).length > 24_000_000) throw new Error('Conversation and inline media exceed the 24 MB capture limit.');
      const filteredConversation = await permissionFilteredMedia(conversation);
      if (message.destination === 'kb') {
        const saved = await sendToKB(filteredConversation, message.format);
        return { name: saved.name, appUrl: saved.appUrl };
      }
      const file = await render(filteredConversation, message.format, true);
      await chrome.downloads.download({ url: file.url, filename: file.name, saveAs: true });
      return { name: file.name };
    }
    if (message.type === 'capture') {
      const tabId = sender.tab?.id || (fromExtension ? message.tabId : null);
      if (!tabId) throw new Error('Capture must be started from an open page.');
      return { conversation: await capture(tabId, message.mode || 'preview') };
    }
    if (message.type === 'export') {
      if (!fromExtension) throw new Error('Use the on-page capture widget to export.');
      if (message.destination === 'kb') return sendToKB(message.conversation, message.format);
      const file = await render(await permissionFilteredMedia(message.conversation), message.format, true);
      await chrome.downloads.download({ url: file.url, filename: file.name, saveAs: true });
      return { name: file.name };
    }
    if (message.type === 'settings') { if (!fromExtension) throw new Error('Settings can only be changed from the extension.'); await alarm(); return {}; }
    if (message.type === 'poll') { if (!fromExtension) throw new Error('Queue polling can only be started from the extension.'); void poll(); return {}; }
    throw new Error('Unknown request.');
  })().then(result => respond({ ok: true, ...result }), error => respond({ ok: false, error: error.message }));
  return true;
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes.settings) return;
  void (async () => {
    let captureSites;
    try { captureSites = resolveCaptureSites(changes.settings.newValue || defaults); }
    catch { captureSites = []; }
    const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
    await Promise.all(tabs.map(tab => chrome.tabs.sendMessage(tab.id, { type: 'capture-sites-updated', captureSites }).catch(() => {})));
  })();
});
