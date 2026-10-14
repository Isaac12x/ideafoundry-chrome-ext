import { markdown } from './shared.js';
import { mediaOrigins } from './media.js';
const $ = id => document.getElementById(id);
let conversation;
let tabId;
async function request(message) {
  const result = await chrome.runtime.sendMessage(message);
  if (!result?.ok) throw new Error(result?.error || 'Extension did not respond.');
  return result;
}
async function read() {
  $('status').textContent = 'Reading the current page…';
  $('retry').hidden = true;
  $('capture').hidden = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab.id;
    ({ conversation } = await request({ type: 'capture', tabId }));
    $('title').textContent = conversation.title;
    const selectedCount = conversation.sections.filter(section => section.selected).length;
    $('count').textContent = `${selectedCount} of ${conversation.sections.length} sections · ${conversation.messages.length} messages · ${conversation.provider}`;
    $('selection').textContent = 'Choose sections with the checkboxes beside each user turn on the conversation page. Collapsed sections remain included when selected.';
    $('warning').textContent = conversation.warning;
    $('preview').textContent = markdown(conversation);
    $('capture').hidden = false;
    $('status').textContent = 'Ready to save';
  } catch (error) { $('status').textContent = error.message; $('retry').hidden = false; }
}
async function save(destination) {
  $('send').disabled = $('download').disabled = true;
  $('status').textContent = destination === 'kb' ? 'Sending to your knowledge base…' : 'Preparing your file…';
  try {
    // Start optional host access while the export click still carries its user gesture.
    const knownHosts = mediaOrigins(conversation);
    const knownAccess = knownHosts.length ? chrome.permissions.request({ origins: knownHosts }) : Promise.resolve(true);
    const format = document.querySelector('[name="format"]:checked').value;
    ({ conversation } = await request({ type: 'capture', tabId, mode: 'export' }));
    const mediaHosts = mediaOrigins(conversation);
    await knownAccess;
    const missingHosts = [];
    for (const origin of mediaHosts) if (!(await chrome.permissions.contains({ origins: [origin] }))) missingHosts.push(origin);
    const newlyDiscovered = missingHosts.filter(origin => !knownHosts.includes(origin));
    if (newlyDiscovered.length) {
      $('status').textContent = `Requesting access to ${newlyDiscovered.length} newly discovered media site${newlyDiscovered.length === 1 ? '' : 's'}…`;
      await chrome.permissions.request({ origins: newlyDiscovered });
    }
    const result = await request({ type: 'export', conversation, format, destination });
    $('status').textContent = destination === 'kb' ? `Saved to KB: ${result.name}` : 'File is ready. Complete the download in Chrome.';
  } catch (error) { $('status').textContent = error.message; }
  finally { $('send').disabled = $('download').disabled = false; }
}
$('settings').onclick = () => chrome.runtime.openOptionsPage();
$('retry').onclick = read;
$('send').onclick = () => save('kb');
$('download').onclick = () => save('download');
void read();
