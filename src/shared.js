export const defaults = {
  appUrl: 'https://ideas.local:8443', source: 0, directory: '',
  queueUrl: 'http://localhost:4318', queueToken: '', remoteEnabled: false,
  allowedOrigins: ['https://chatgpt.com', 'https://claude.ai'],
};
// Upgrade the previous bundled default; preserve all custom service addresses.
export function withDefaults(settings = {}) {
  const value = { ...defaults, ...settings };
  if (value.appUrl === 'http://localhost:3000') value.appUrl = defaults.appUrl;
  return value;
}
export function httpUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use an HTTP(S) URL without embedded credentials.');
  return url;
}
export function serviceOrigin(value) {
  const url = httpUrl(value);
  if (url.pathname !== '/' || url.search || url.hash) throw new Error('Enter a service origin without a path, query, or fragment.');
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Remote services must use HTTPS. HTTP is allowed on localhost only.');
  return url.origin;
}
export function validateSettings(input) {
  const value = withDefaults(input);
  value.appUrl = serviceOrigin(value.appUrl);
  value.queueUrl = serviceOrigin(value.queueUrl);
  value.source = Number(value.source);
  if (!Number.isInteger(value.source) || value.source < 0) throw new Error('KB source must be a non-negative integer.');
  value.directory = value.directory.trim();
  if (value.directory.startsWith('/') || value.directory.split(/[\\/]/).includes('..')) throw new Error('Use a relative KB folder without .. segments.');
  value.allowedOrigins = [...new Set(value.allowedOrigins.filter(Boolean).map(x => httpUrl(x.trim()).origin))];
  value.queueToken = value.queueToken.trim();
  if (value.remoteEnabled && value.queueToken.length < 32) throw new Error('Remote capture requires a queue token of at least 32 characters.');
  if (value.remoteEnabled && !value.allowedOrigins.length) throw new Error('Allow at least one conversation site for remote capture.');
  return value;
}
export function validateJob(job, allowedOrigins) {
  if (!job || typeof job.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(job.id)) throw new Error('Invalid job ID.');
  const url = httpUrl(job.url);
  if (!allowedOrigins.includes(url.origin)) throw new Error('This conversation origin is not allowed for remote capture.');
  if (!['md', 'pdf'].includes(job.format)) throw new Error('Format must be md or pdf.');
  return { id: job.id, url: url.href, format: job.format };
}
export function filename(title, format, date = new Date()) {
  const stem = title.normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').replace(/^[. ]+|[. ]+$/g, '').slice(0, 100) || 'Conversation';
  return `${stem} - ${date.toISOString().replace(/[:.]/g, '-')}.${format}`;
}
export function markdown(conversation) {
  const media = new Map((conversation.media || []).map(item => [item.id, item]));
  const messages = conversation.messages.map(message => ({
    ...message,
    markdown: message.markdown.replace(/\{\{idea-media:([a-zA-Z0-9_-]{1,100})\}\}/g, (_placeholder, id) => {
      const item = media.get(id);
      if (!item) return `[Media reference ${id} unavailable]`;
      const label = String(item.alt || item.title || item.filename || 'Referenced media').replace(/[\[\]<>\r\n]/g, ' ');
      const target = String(item.url || conversation.url).replace(/[<>\r\n]/g, '');
      return item.kind === 'image' ? `![${label}](${target})` : `[${label}](${target})`;
    }),
  }));
  return `# ${conversation.title.replace(/[\r\n]/g, ' ')}\n\nSource: <${conversation.url.replace(/[<>\r\n]/g, '')}>\n\nProvider: ${conversation.provider}\n\nCaptured: ${conversation.capturedAt}\n\n${conversation.warning ? `> ${conversation.warning}\n\n` : ''}---\n\n` + messages.map(m => `## ${m.role}\n\n${m.markdown.trim()}\n`).join('\n---\n\n');
}
export function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
