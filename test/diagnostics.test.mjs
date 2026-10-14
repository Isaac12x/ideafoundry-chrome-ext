import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { collectDiagnostics } from '../src/diagnostics.js';

test('diagnostics report bounded structure and visible/hidden roots without page text or media URLs', () => {
  const dom = new JSDOM(`<!doctype html><main id="hidden-root" hidden><p>Secret hidden copy</p></main><main id="page"><section id="thread">
    <div class="user-message-bubble"><div class="whitespace-pre-wrap">UNIQUE_TRANSCRIPT_SENTINEL</div></div>
    <div class="assistant-turn" data-message-id="answer-1"><div class="markdown prose"><p>Assistant private answer</p><img src="https://private.example/private-image.png"></div></div>
  </section></main>`, { url: 'https://chatgpt.com/g/g-p-private-title/c/private-conversation-id' });
  const result = collectDiagnostics(dom.window.document, dom.window.location.href);
  const serialized = JSON.stringify(result);
  assert.equal(result.version, '0.3.2');
  assert.equal(result.provider, 'ChatGPT');
  assert.equal(result.diagnosticsVersion, 2);
  assert.deepEqual(result.routeShape, ['g', '…', 'c', '…']);
  assert.equal(result.rootCandidates.find(root => root.id === 'hidden-root').visibility, 'hidden');
  assert.equal(result.rootCandidates.find(root => root.id === 'thread').selected, true);
  assert.equal(result.selectorCounts.chatGptUserBubble, 1);
  assert.equal(result.selectorCounts.chatGptAssistantText, 1);
  assert.ok(result.samples.length <= result.limits.sampleLimit);
  assert.ok(result.samples.some(sample => sample.ancestry.some(item => item.class?.includes('user-message-bubble'))));
  assert.ok(result.samples.some(sample => sample.kind === 'contentParagraph'), 'structural response paragraphs remain sampled when known selectors match');
  assert.ok(result.samples.some(sample => sample.kind === 'contentMedia'), 'response media remains sampled when known selectors match');
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
  assert.ok(result.samples.some(sample => sample.kind === 'contentParagraph'));
  assert.doesNotMatch(JSON.stringify(result), /Unknown markup secret|Draft secret|private-id/);
  dom.window.close();
});

test('diagnostics sample reported ChatGPT bubbles and balanced neutral content structure without private copy or URLs', () => {
  const dom = new JSDOM(`<!doctype html><main><div id="thread">
    <div class="turn-branch"><div class="relative w-full min-w-0 text-size-chat leading-relaxed"><div class="flex flex-col items-end gap-1"><div class="bg-user-message text-user-message min-w-0 max-w-(--user-chat-width) overflow-hidden break-words"><div><div class="whitespace-pre-wrap">PRIVATE_PROMPT</div></div></div></div></div>
      <div class="relative w-full min-w-0"><p>PRIVATE_REPLY</p><table><tr><td>PRIVATE_TABLE</td></tr></table><div class="gallery"><figure><img src="https://private.example/private-image.png" alt="PRIVATE_ALT"></figure></div></div>
    </div>
  </div><div class="composer"><textarea>PRIVATE_DRAFT</textarea></div></main>`, { url: 'https://chatgpt.com/c/private-conversation' });
  const result = collectDiagnostics(dom.window.document, dom.window.location.href);
  const serialized = JSON.stringify(result);
  assert.equal(result.selectorCounts.chatGptReportedUserBubble, 1);
  assert.ok(result.rootCandidates.some(root => root.descendantCounts.reportedUserBubbles === 1));
  assert.ok(result.samples.some(sample => sample.kind === 'knownUserBubble' && sample.ancestry.some(item => item.class?.includes('bg-user-message'))));
  assert.ok(result.samples.some(sample => sample.kind === 'contentParagraph' && sample.ancestry.some(item => item.tag === 'p')));
  assert.ok(result.samples.some(sample => sample.kind === 'contentMedia' && sample.ancestry.some(item => item.tag === 'img')));
  assert.ok(result.topBranchStructure.some(branch => branch.descendantCounts.paragraphs > 0 && branch.descendantCounts.media > 0));
  assert.ok(result.limits.sampleLimit >= result.samples.length);
  for (const secret of ['PRIVATE_PROMPT', 'PRIVATE_REPLY', 'PRIVATE_TABLE', 'PRIVATE_DRAFT', 'private-image.png', 'PRIVATE_ALT', 'private-conversation']) {
    assert.doesNotMatch(serialized, new RegExp(secret));
  }
  dom.window.close();
});
