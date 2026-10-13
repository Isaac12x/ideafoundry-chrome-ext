import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { extractConversation } from '../src/extract.js';
import { markdown, validateSettings, validateJob, filename } from '../src/shared.js';
const extract = (html, url = 'https://chatgpt.com/c/123') => extractConversation(new JSDOM(`<title>Research - ChatGPT</title>${html}`).window.document, url);
test('ChatGPT preserves roles, code, tables, links and strips controls', () => {
  const result = extract('<main><div data-message-author-role="user"><p>A question</p><button>Copy</button></div><div data-message-author-role="assistant"><h2>Answer</h2><pre><code class="language-js">const x = `a`;</code></pre><a href="/ref">Source</a><table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table></div></main>');
  assert.equal(result.title, 'Research'); assert.equal(result.messages.length, 2);
  assert.equal(result.messages[0].role, 'User');
  assert.match(result.messages[1].markdown, /```js\nconst x/);
  assert.match(result.messages[1].markdown, /https:\/\/chatgpt.com\/ref/);
  assert.match(result.messages[1].markdown, /\| A \| B \|/);
  assert.doesNotMatch(markdown(result), /Copy/);
  assert.match(markdown(result), /Source: <https:\/\/chatgpt.com\/c\/123>/);
});
test('Claude keeps message order and removes nested duplicate wrappers', () => {
  const result = extract('<div data-testid="user-message">Hello</div><div data-is-streaming="false"><div class="font-claude-response">Hi</div></div>', 'https://claude.ai/chat/123');
  assert.deepEqual(result.messages.map(m => m.role), ['User', 'Assistant']);
});
test('Gemini and generic pages have explicit provider behavior', () => {
  assert.equal(extract('<user-query>Hello</user-query><model-response>Hi</model-response>', 'https://gemini.google.com/app/123').messages.length, 2);
  const result = extract('<main><h1>Page</h1><p>Content</p><script>secret</script><a href="javascript:bad()">Link</a></main>', 'https://example.com/chat');
  assert.equal(result.messages[0].role, 'Page content'); assert.match(result.warning, /Generic/);
  assert.doesNotMatch(result.messages[0].markdown, /secret|javascript:/);
});
test('known provider login pages fail instead of capturing unrelated content', () => {
  assert.throws(() => extract('<main>Sign in</main>'), /No conversation/);
});
test('nested fenced code is exported without breaking markdown', () => {
  assert.match(extract('<div data-message-author-role="assistant"><pre><code>```js\nhello\n```</code></pre></div>').messages[0].markdown, /^````/);
});
test('settings and remote jobs restrict origins and unsafe destinations', () => {
  assert.throws(() => validateSettings({ appUrl: 'http://example.com' }), /HTTPS/);
  assert.throws(() => validateSettings({ directory: '../escape' }), /relative/);
  assert.throws(() => validateSettings({ source: -1 }), /source/);
  assert.throws(() => validateSettings({ remoteEnabled: true }), /token/);
  assert.throws(() => validateJob({ id: '1', url: 'https://evil.com', format: 'md' }, ['https://claude.ai']), /not allowed/);
  assert.throws(() => validateJob({ id: '../x', url: 'https://claude.ai', format: 'md' }, ['https://claude.ai']), /ID/);
  assert.equal(validateSettings({}).appUrl, 'http://localhost:3000');
  assert.doesNotMatch(filename('../bad/name:thing', 'md'), /[/:]/);
});
