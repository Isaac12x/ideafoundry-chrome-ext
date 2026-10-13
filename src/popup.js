import { markdown } from './shared.js';
const $ = id => document.getElementById(id);
let conversation;
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
    ({ conversation } = await request({ type: 'capture', tabId: tab.id }));
    $('title').textContent = conversation.title;
    $('count').textContent = `${conversation.messages.length} messages · ${conversation.provider}`;
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
    const format = document.querySelector('[name="format"]:checked').value;
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
