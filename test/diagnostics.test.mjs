import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { collectDiagnostics } from '../src/diagnostics.js';

test('diagnostics report bounded structure and visible/hidden roots without page text or media URLs', () => {
  const dom = new JSDOM(`<!doctype html><main id="hidden-root" hidden><p>Secret hidden copy</p></main><main id="page"><section id="thread">
    <div class="user-message-bubble"><div class="whitespace-pre-wrap">UNIQUE_TRANSCRIPT_SENTINEL</div></div>
    <div class="assistant-turn" data-message-id="answer-1"><div class="markdown prose">Assistant private answer</div><img src="https://private.example/private-image.png"></div>
  </section></main>`, { url: 'https://chatgpt.com/g/g-p-private-title/c/private-conversation-id' });
  const result = collectDiagnostics(dom.window.document, dom.window.location.href);
  const serialized = JSON.stringify(result);
  assert.equal(result.version, '0.3.1');
  assert.equal(result.provider, 'ChatGPT');
  assert.deepEqual(result.routeShape, ['g', '…', 'c', '…']);
  assert.equal(result.rootCandidates.find(root => root.id === 'hidden-root').visibility, 'hidden');
  assert.equal(result.rootCandidates.find(root => root.id === 'thread').selected, true);
  assert.equal(result.selectorCounts.chatGptUserBubble, 1);
  assert.equal(result.selectorCounts.chatGptAssistantText, 1);
  assert.ok(result.samples.length <= 10);
  assert.ok(result.samples.some(sample => sample.ancestry.some(item => item.class?.includes('user-message-bubble'))));
  for (const secret of ['UNIQUE_TRANSCRIPT_SENTINEL', 'Assistant private answer', 'private-image.png', 'private-conversation-id', 'g-p-private-title']) {
    assert.doesNotMatch(serialized, new RegExp(secret));
  }
  dom.window.close();
});

test('diagnostics cap root candidates and keep non-ChatGPT provider identification', () => {
  const dom = new JSDOM(`<main><p>Unknown markup secret</p><textarea>Draft secret</textarea></main>${`<main></main>`.repeat(11)}`, { url: 'https://claude.ai/chat/private-id' });
  const result = collectDiagnostics(dom.window.document, dom.window.location.href);
  assert.equal(result.provider, 'Claude');
  assert.equal(result.rootCandidateCount, 12);
  assert.equal(result.rootCandidates.length, 10);
  assert.ok(result.rootCandidates.every(root => root.visibility === 'visible'));
  assert.equal(result.samples[0].kind, 'fallbackStructure');
  assert.doesNotMatch(JSON.stringify(result), /Unknown markup secret|Draft secret|private-id/);
  dom.window.close();
});
