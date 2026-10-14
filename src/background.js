import { defaults, withDefaults, validateSettings, validateJob, httpUrl } from './shared.js';
import { uploadInApp } from './kb-upload.js';
import { mediaOrigins } from './media.js';
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
  throw new Error('Page loading timed out. Open it in Chrome and retry.');
}
async function permitted(origin) {
  if (!(await chrome.permissions.contains({ origins: [`${origin}/*`] }))) throw new Error(`Grant access to ${origin} in extension settings first.`);
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
      if (missingHosts.has(new URL(item.url).origin)) return { ...item, error: 'Access was not granted for this media site. Grant site access in extension settings and retry.' };
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
    await permitted(config.queueUrl);
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
      const job = validateJob(incoming, config.allowedOrigins);
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
      if (conversation.provider === 'Other' && conversation.messages[0]?.role === 'Page content') throw new Error('Remote capture requires identifiable messages. Use the popup to review generic pages.');
      conversation = await capture(tabId, 'all', true);
      // Honor disable/reconfiguration before exporting content.
      const latest = await settings();
      if (!latest.remoteEnabled || latest.queueUrl !== config.queueUrl || latest.appUrl !== config.appUrl || !latest.allowedOrigins.includes(httpUrl(job.url).origin)) throw new Error('Remote settings changed; capture cancelled.');
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
chrome.runtime.onInstalled.addListener(alarm);
chrome.runtime.onStartup.addListener(alarm);
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'remote-capture') void poll(); });
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL('')) || message.target === 'offscreen') return;
  (async () => {
    if (message.type === 'capture') return { conversation: await capture(message.tabId, message.mode || 'preview') };
    if (message.type === 'export') {
      if (message.destination === 'kb') return sendToKB(message.conversation, message.format);
      const file = await render(await permissionFilteredMedia(message.conversation), message.format, true);
      await chrome.downloads.download({ url: file.url, filename: file.name, saveAs: true });
      return { name: file.name };
    }
    if (message.type === 'settings') { await alarm(); return {}; }
    if (message.type === 'poll') { void poll(); return {}; }
    throw new Error('Unknown request.');
  })().then(result => respond({ ok: true, ...result }), error => respond({ ok: false, error: error.message }));
  return true;
});
