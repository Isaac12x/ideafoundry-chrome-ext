export const defaults = {
  appUrl: 'https://ideas.local:8443', source: 0, directory: '',
  queueUrl: 'https://ideas.local:8443/api/v1/capture', queueToken: '', remoteEnabled: false,
  allowedOrigins: ['https://chatgpt.com/*', 'https://claude.ai/*'],
};
// Upgrade the previous bundled default; preserve all custom service addresses.
export function withDefaults(settings = {}) {
  const value = { ...defaults, ...settings };
  if (value.appUrl === 'http://localhost:3000') value.appUrl = defaults.appUrl;
  // Old bundled standalone-queue default; keep it when remote capture is actively configured.
  if (value.queueUrl === 'http://localhost:4318' && (!value.remoteEnabled || !value.queueToken)) value.queueUrl = defaults.queueUrl;
  return value;
}
export function formatCaptureSite(pattern) {
  if (pattern.subpathsOnly) return `${pattern.origin}/*`;
  if (pattern.exactPath) return `${pattern.origin}${pattern.exactPath.startsWith('/') ? pattern.exactPath : `/${pattern.exactPath}`}`;
  return pattern.origin;
}
export function parseCaptureSitePattern(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed) return null;
  const subpathsOnly = trimmed.endsWith('/*');
  const base = subpathsOnly ? trimmed.slice(0, -2) : trimmed;
  const url = httpUrl(base);
  if (subpathsOnly) {
    if (url.pathname !== '/' || url.search || url.hash) throw new Error(`Use an origin plus /* for subpaths: ${trimmed}`);
    return { origin: url.origin, subpathsOnly: true };
  }
  if (url.search || url.hash) throw new Error(`Remove query and hash from capture URL: ${trimmed}`);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (path === '/') return { origin: url.origin, homepageOnly: true };
  return { origin: url.origin, exactPath: path };
}
const chatGptOrigins = new Set(['https://chatgpt.com', 'https://chat.openai.com']);
function normalizedCaptureOrigin(origin) {
  try {
    const url = new URL(origin);
    const host = url.hostname.replace(/^www\./i, '');
    return `${url.protocol}//${host}${url.port ? `:${url.port}` : ''}`;
  } catch { return origin; }
}
function captureOriginsMatch(siteOrigin, pageOrigin) {
  if (normalizedCaptureOrigin(siteOrigin) === normalizedCaptureOrigin(pageOrigin)) return true;
  return chatGptOrigins.has(siteOrigin) && chatGptOrigins.has(pageOrigin);
}
export function resolveCaptureSites(settings = {}) {
  const value = withDefaults(settings);
  const lines = [...new Set((Array.isArray(value.allowedOrigins) ? value.allowedOrigins : String(value.allowedOrigins || '').split('\n')).map(x => String(x).trim()).filter(Boolean))];
  return lines.map(parseCaptureSitePattern);
}
export function urlMatchesCaptureSites(href, patterns) {
  if (!patterns?.length) return false;
  let page;
  try { page = httpUrl(href); } catch { return false; }
  const pagePath = page.pathname.replace(/\/+$/, '') || '/';
  for (const site of patterns) {
    if (!captureOriginsMatch(site.origin, page.origin)) continue;
    if (site.subpathsOnly) {
      if (pagePath !== '/') return true;
      continue;
    }
    if (site.homepageOnly) {
      if (pagePath === '/') return true;
      continue;
    }
    if (site.exactPath && pagePath === site.exactPath) return true;
  }
  return false;
}
export function httpUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use an HTTP(S) URL without embedded credentials.');
  return url;
}
function secureService(url) {
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Remote services must use HTTPS. HTTP is allowed on localhost only.');
}
export function serviceOrigin(value) {
  const url = httpUrl(value);
  if (url.pathname !== '/' || url.search || url.hash) throw new Error('Enter a service origin without a path, query, or fragment.');
  secureService(url);
  return url.origin;
}
// Queue base: origin plus optional path (e.g. https://app/api/v1/capture), no trailing slash.
export function serviceBase(value) {
  const url = httpUrl(value);
  if (url.search || url.hash) throw new Error('Enter a service address without a query or fragment.');
  secureService(url);
  return url.origin + url.pathname.replace(/\/+$/, '');
}
export function kbSource(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new Error('KB source must be a non-negative integer.');
  return n;
}
export function kbDirectory(value) {
  if (typeof value !== 'string' || value.length > 500) throw new Error('Use a relative KB folder without .. segments.');
  const dir = value.trim();
  if (dir.startsWith('/') || dir.split(/[\\/]/).includes('..')) throw new Error('Use a relative KB folder without .. segments.');
  return dir;
}
export function validateSettings(input) {
  const value = withDefaults(input);
  value.appUrl = serviceOrigin(value.appUrl);
  value.queueUrl = serviceBase(value.queueUrl);
  value.source = kbSource(value.source);
  value.directory = kbDirectory(value.directory);
  value.captureSites = resolveCaptureSites(value);
  value.allowedOrigins = value.captureSites.map(formatCaptureSite);
  value.queueToken = value.queueToken.trim();
  if (value.remoteEnabled && value.queueToken.length < 32) throw new Error('Remote capture requires a queue token of at least 32 characters.');
  if (value.remoteEnabled && !value.captureSites.length) throw new Error('Allow at least one conversation URL for remote capture.');
  return value;
}
export function validateJob(job, captureSites) {
  if (!job || typeof job.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(job.id)) throw new Error('Invalid job ID.');
  const url = httpUrl(job.url);
  if (!urlMatchesCaptureSites(url.href, captureSites)) throw new Error('This conversation URL is not allowed for remote capture.');
  if (!['md', 'pdf'].includes(job.format)) throw new Error('Format must be md or pdf.');
  const out = { id: job.id, url: url.href, format: job.format };
  if (job.source != null) out.source = kbSource(job.source);
  if (job.directory != null) out.directory = kbDirectory(job.directory);
  return out;
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
