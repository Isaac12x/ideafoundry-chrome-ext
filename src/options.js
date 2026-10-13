import { defaults, validateSettings } from './shared.js';
const $ = id => document.getElementById(id);
const keys = ['appUrl', 'source', 'directory', 'queueUrl', 'queueToken'];
const { settings = defaults } = await chrome.storage.local.get('settings');
const config = { ...defaults, ...settings };
for (const key of keys) $(key).value = config[key];
$('remoteEnabled').checked = config.remoteEnabled;
$('allowedOrigins').value = config.allowedOrigins.join('\n');
$('form').onsubmit = async event => {
  event.preventDefault();
  try {
    const value = validateSettings({ ...Object.fromEntries(keys.map(key => [key, $(key).value])), remoteEnabled: $('remoteEnabled').checked, allowedOrigins: $('allowedOrigins').value.split('\n') });
    const origins = [`${value.appUrl}/*`, ...(value.remoteEnabled ? [`${value.queueUrl}/*`, ...value.allowedOrigins.map(o => `${o}/*`)] : [])];
    // Must be requested directly from this user gesture.
    if (!(await chrome.permissions.request({ origins: [...new Set(origins)] }))) throw new Error('Site access was not granted. Settings were not saved.');
    await chrome.storage.local.set({ settings: value });
    const response = await chrome.runtime.sendMessage({ type: 'settings' });
    if (!response?.ok) throw new Error(response?.error || 'Could not update the remote timer.');
    $('status').textContent = 'Connections saved.';
  } catch (error) { $('status').textContent = error.message; }
};
$('poll').onclick = async () => {
  await chrome.runtime.sendMessage({ type: 'poll' });
  $('status').textContent = 'Queue check requested. Remote capture must be enabled and saved first.';
};
function showRemote(value) { $('remoteStatus').textContent = value ? `Last queue activity: ${value.state}${value.error ? ` — ${value.error}` : ''} · ${value.updatedAt}` : 'No remote requests yet.'; }
showRemote((await chrome.storage.local.get('remoteStatus')).remoteStatus);
chrome.storage.onChanged.addListener(changes => { if (changes.remoteStatus) showRemote(changes.remoteStatus.newValue); });
