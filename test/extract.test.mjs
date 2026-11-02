import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import MarkdownIt from 'markdown-it';
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
test('math renderer markup exports its source once as readable inline and display math', () => {
  const result = extract(`<main><article data-message-author-role="assistant">
    <p>Inline <span class="katex"><span class="katex-mathml"><math><semantics><mrow><mi>x</mi><mo>=</mo><mn>2</mn></mrow><annotation encoding="application/x-tex">x=2</annotation></semantics></math></span><span class="katex-html" aria-hidden="true">x = 2</span></span> continues.</p>
    <div class="katex-display"><span class="katex"><span class="katex-mathml"><math><semantics><mrow><mi>a</mi><mo>+</mo><mi>b</mi></mrow><annotation encoding="application/x-tex">a+b</annotation></semantics></math></span><span class="katex-html" aria-hidden="true">a + b</span></span></div>
  </article></main>`);
  const output = result.messages[0].markdown;
  assert.match(output, /Inline \$x=2\$ continues/);
  assert.match(output, /\$\$\na\+b\n\$\$/);
  assert.doesNotMatch(output, /x = 2|a \+ b/);
});
test('hidden MathML source is retained when math renderers hide source and visual branches', () => {
  const result = extract(`<main><article data-message-author-role="assistant"><p>Result
    <span class="katex"><span class="katex-mathml" style="display:none" aria-hidden="true"><math><semantics><msup><mi>x</mi><mn>2</mn></msup><annotation encoding="application/x-tex">x^2</annotation></semantics></math></span><span class="katex-html" aria-hidden="true">x²</span></span>
  </p></article></main>`);
  assert.equal(result.messages[0].markdown.includes('$x^2$'), true);
  assert.doesNotMatch(result.messages[0].markdown, /x²/);
});
test('MathJax display containers use display delimiters', () => {
  const result = extract('<main><article data-message-author-role="assistant"><mjx-container display="true" aria-label="x^2"><math><semantics><msup><mi>x</mi><mn>2</mn></msup><annotation encoding="application/x-tex">x^2</annotation></semantics></math></mjx-container></article></main>');
  assert.match(result.messages[0].markdown, /\$\$\nx\^2\n\$\$/);
});
test('Markdown retains pre-wrapped prompt lines and whitespace', () => {
  const result = extract('<main><div data-message-author-role="user"><div style="white-space:pre-wrap">first line\nsecond line\n\n  indented</div></div></main>');
  assert.match(result.messages[0].markdown, /first line\s+second line\s+\s+indented/);
  assert.match(result.messages[0].markdown, /second line/);
  assert.match(result.messages[0].markdown, /indented/);
});
test('Markdown table cells keep multiline and pipe content within their original columns', () => {
  const result = extract('<main><article data-message-author-role="assistant"><table><thead><tr><th>First</th><th>Second</th></tr></thead><tbody><tr><td>one<br>two</td><td>a | b</td></tr></tbody></table></article></main>');
  const output = result.messages[0].markdown;
  assert.match(output, /one<br>two/);
  assert.match(output, /a \\\| b/);
  const rendered = new MarkdownIt({ html: true }).render(output);
  const table = new JSDOM(rendered).window.document.querySelector('table');
  assert.equal(table.rows.length, 2);
  assert.equal(table.rows[1].cells.length, 2);
  assert.equal(table.rows[1].cells[0].innerHTML, 'one<br>two');
  assert.equal(table.rows[1].cells[1].textContent, 'a | b');
});
test('Markdown tables retain literal backslashes and paragraph breaks inside cells', () => {
  const result = extract('<main><article data-message-author-role="assistant"><table><thead><tr><th>Value</th></tr></thead><tbody><tr><td>slash \\| pipe<p>one</p><p>two</p></td></tr></tbody></table></article></main>');
  const rendered = new JSDOM(new MarkdownIt({ html: true }).render(result.messages[0].markdown)).window.document;
  const cell = rendered.querySelector('table tbody td');
  assert.equal(cell.textContent, 'slash \\| pipeonetwo');
  assert.equal(cell.querySelectorAll('br').length >= 2, true);
});
test('Markdown table rendering preserves literal emphasis, backslashes, and code spans', () => {
  const cases = [
    '*literal*',
    'C:\\tmp',
    '<code>C:\\tmp</code>',
    '\\|',
    '<code>a|b</code>',
    '<code>a`b|c</code>',
  ];
  for (const cell of cases) {
    const dom = new JSDOM(`<main><div data-message-author-role="assistant"><table><tr><th>A</th></tr><tr><td>${cell}</td></tr></table></div></main>`, { url: 'https://chatgpt.com/c/x' });
    const result = extractConversation(dom.window.document, dom.window.location.href);
    const rendered = new MarkdownIt({ html: true }).render(result.messages[0].markdown);
    const actual = new JSDOM(rendered).window.document.querySelector('td').textContent;
    const sourceText = new JSDOM(`<table><tr><td>${cell}</td></tr></table>`).window.document.querySelector('td').textContent;
    assert.equal(actual, sourceText, `cell ${cell}`);
  }
});
test('preformatted code in Markdown table cells remains code after rendering', () => {
  const result = extract('<main><div data-message-author-role="assistant"><table><tr><th>Code</th></tr><tr><td><pre><code>const value = "a|b";\nnext();</code></pre></td></tr></table></div></main>', 'https://chatgpt.com/c/x');
  const rendered = new JSDOM(new MarkdownIt({ html: true }).render(result.messages[0].markdown)).window.document;
  const code = rendered.querySelector('table td pre code');
  assert.ok(code);
  assert.equal(code.textContent, 'const value = "a|b";\nnext();');
});
test('preformatted table fallback preserves safe links and removes unsafe URLs and script content', () => {
  const result = extract('<main><div data-message-author-role="assistant"><table><tr><td><pre><code>x</code></pre><a href="https://example.com">Source</a><a href="javascript:alert(1)">bad</a><script>secret()</script></td></tr></table></div></main>');
  const rendered = new JSDOM(new MarkdownIt({ html: true }).render(result.messages[0].markdown)).window.document;
  const cell = rendered.querySelector('td');
  assert.equal(cell.querySelector('a[href="https://example.com/"]')?.textContent, 'Source');
  assert.equal(cell.querySelector('a[href^="javascript:"]'), null);
  assert.equal(cell.textContent.includes('secret()'), false);
});
test('ordered list numbering honors li value resets', () => {
  const result = extract('<main><article data-message-author-role="assistant"><ol start="3"><li>Third</li><li value="8">Eighth</li><li>Ninth</li></ol></article></main>');
  const rendered = new JSDOM(new MarkdownIt({ html: true }).render(result.messages[0].markdown)).window.document;
  const list = rendered.querySelector('ol');
  assert.equal(list.getAttribute('start'), '3');
  assert.deepEqual([...list.querySelectorAll(':scope > li')].map(item => item.getAttribute('value')), [null, '8', null]);
  assert.deepEqual([...list.querySelectorAll(':scope > li')].map(item => item.textContent.trim()), ['Third', 'Eighth', 'Ninth']);
});
test('explicit ordered-list item value zero survives HTML fallback', () => {
  const result = extract('<main><article data-message-author-role="assistant"><ol><li value="0">Zero</li><li>One</li></ol></article></main>');
  const list = new JSDOM(new MarkdownIt({ html: true }).render(result.messages[0].markdown).trim()).window.document.querySelector('ol');
  assert.equal(list.querySelector('li').getAttribute('value'), '0');
});
test('explicit ordered-list HTML fallback serializes br as a void element once', () => {
  const result = extract('<main><article data-message-author-role="assistant"><ol><li value="4">First<br>Second</li></ol></article></main>');
  const markdown = result.messages[0].markdown;
  assert.doesNotMatch(markdown, /<br\s*>\s*<\/br>/i);
  const list = new JSDOM(new MarkdownIt({ html: true }).render(markdown)).window.document.querySelector('ol');
  assert.equal(list.querySelectorAll('li br').length, 1);
  assert.equal(list.querySelector('li').textContent, 'FirstSecond');
});
test('custom ordered numbering leaves nested unordered lists intact', () => {
  const result = extract('<main><article data-message-author-role="assistant"><ol><li>First<ul><li>Nested A</li><li>Nested B</li></ul></li><li>Second</li></ol></article></main>');
  assert.match(result.messages[0].markdown, /-\s+Nested A/);
  assert.match(result.messages[0].markdown, /-\s+Nested B/);
  const rendered = new JSDOM(new MarkdownIt({ html: true }).render(result.messages[0].markdown)).window.document;
  assert.equal(rendered.querySelectorAll('ul').length, 1);
  assert.deepEqual([...rendered.querySelectorAll('ul li')].map(item => item.textContent.trim()), ['Nested A', 'Nested B']);
});
test('pre-wrap and table Markdown normalization does not rewrite layout HTML', () => {
  const dom = new JSDOM('<main><article data-message-author-role="user"><div style="white-space:pre-wrap">first\nsecond</div><table><tr><td>a | b</td></tr></table></article></main>', { url: 'https://chatgpt.com/c/123' });
  const result = extractConversation(dom.window.document, dom.window.location.href, { includeLayout: true });
  assert.match(result.messages[0].markdown, /first\s+second/);
  assert.match(result.messages[0].html, /first(?:\n|<br>)second/);
  assert.match(result.messages[0].html, /a \| b/);
  dom.window.close();
});
test('hidden conversation branches are skipped while extension-collapsed selected turns remain capturable', () => {
  const dom = new JSDOM(`<style>.idea-capture-section-collapsed{display:none}.provider-hidden{display:none}</style><main>
    <div data-message-author-role="user" class="idea-capture-section-collapsed"><p>Selected collapsed prompt</p><img src="https://cdn.example/selected.png"></div>
    <div data-message-author-role="assistant" class="provider-hidden"><p>Hidden stale answer</p><img src="https://cdn.example/stale.png"></div>
    <div data-message-author-role="assistant"><p>Visible answer</p><img class="provider-hidden" src="https://cdn.example/hidden.png"></div>
  </main>`, { url: 'https://chatgpt.com/c/123' });
  const result = extractConversation(dom.window.document, dom.window.location.href);
  assert.match(result.messages[0].markdown, /Selected collapsed prompt/);
  assert.match(result.messages[1].markdown, /Visible answer/);
  assert.deepEqual(result.media.map(item => item.url), ['https://cdn.example/selected.png']);
});
test('hidden inferred ChatGPT candidate roots and hidden descendants are excluded', () => {
  const dom = new JSDOM(`<style>.provider-hidden{display:none}</style><main id="thread">
    <div class="bg-user-message">Visible question</div>
    <div class="provider-hidden"><img src="https://cdn.example/hidden-root.png" alt="Hidden"></div>
    <div><p>Visible answer</p><img class="provider-hidden" src="https://cdn.example/hidden-child.png"></div>
  </main>`, { url: 'https://chatgpt.com/c/123' });
  const result = extractConversation(dom.window.document, dom.window.location.href);
  assert.deepEqual(result.messages.map(message => message.markdown.match(/Visible question|Visible answer/)?.[0]), ['Visible question', 'Visible answer']);
  assert.deepEqual(result.media, []);
  dom.window.close();
});
test('canvas extraction keeps the original canvas paired after hidden clone branches are pruned', () => {
  const dom = new JSDOM(`<style>.provider-hidden{display:none}</style><main>
    <div data-message-author-role="assistant"><canvas class="provider-hidden"></canvas><canvas></canvas></div>
  </main>`, { url: 'https://chatgpt.com/c/123' });
  const canvases = dom.window.document.querySelectorAll('canvas');
  canvases[0].toDataURL = () => 'data:image/png;base64,hidden';
  canvases[1].toDataURL = () => 'data:image/png;base64,visible';
  const result = extractConversation(dom.window.document, dom.window.location.href);
  assert.equal(result.media.length, 1);
  assert.equal(result.media[0].url, 'data:image/png;base64,visible');
  dom.window.close();
});
test('ChatGPT exports the full assistant turn when its prose and table are split across siblings', () => {
  const result = extract(`<main><div class="user-message-bubble"><p>Compare these</p></div>
    <div class="assistant-turn"><div class="markdown"><p>First paragraph.</p></div><table><tr><th>Item</th><th>Value</th></tr><tr><td>Alpha</td><td>3</td></tr></table><div class="prose"><p>Second paragraph.</p></div><button>Copy</button></div>
  </main>`);
  const answers = result.messages.filter(message => message.role === 'Assistant');
  assert.equal(answers.length, 1);
  assert.match(answers[0].markdown, /First paragraph/);
  assert.match(answers[0].markdown, /\| Item \| Value \|/);
  assert.match(answers[0].markdown, /Second paragraph/);
  assert.doesNotMatch(answers[0].markdown, /Copy/);
});
test('ChatGPT keeps separate roles inside one article instead of merging the turn', () => {
  const result = extract('<article data-testid="conversation-turn-1"><div data-message-author-role="user"><p>Question</p></div><div data-message-author-role="assistant"><p>Answer</p></div></article>');
  assert.deepEqual(result.messages.map(message => message.role), ['User', 'Assistant']);
  assert.match(result.messages[0].markdown, /Question/);
  assert.doesNotMatch(result.messages[0].markdown, /Answer/);
  assert.match(result.messages[1].markdown, /Answer/);
  assert.doesNotMatch(result.messages[1].markdown, /Question/);
});
test('ChatGPT discovers role-free turn articles on GPT project conversation routes and ignores sidebar cards', () => {
  const dom = new JSDOM(`<!doctype html><title>Project thread - ChatGPT</title><aside><article data-testid="conversation-turn-99"><h2>You said:</h2><p>Sidebar copy</p></article></aside><main>
    <article data-testid="conversation-turn-0"><h5 class="sr-only">You said:</h5><div><p>What is the plan?</p></div></article>
    <article data-testid="conversation-turn-1"><h6 class="sr-only">ChatGPT said:</h6><div><p>First answer.</p></div></article>
    <article data-testid="conversation-turn-2"><h5 class="sr-only">You said:</h5><div><p>Follow up?</p></div></article>
  </main>`, { url: 'https://chatgpt.com/g/g-p-demo/c/123' });
  const result = extractConversation(dom.window.document, dom.window.location.href);
  assert.deepEqual(result.messages.map(message => message.role), ['User', 'Assistant', 'User']);
  assert.deepEqual(result.sections.map(section => section.label), ['What is the plan?', 'Follow up?']);
  assert.doesNotMatch(result.messages.map(message => message.markdown).join('\n'), /Sidebar copy/);
  dom.window.close();
});
test('ChatGPT role-free conversation articles remain ordered when some turns omit labels', () => {
  const dom = new JSDOM(`<main>
    <article data-testid="conversation-turn-0"><h5>You said:</h5><p>Question</p></article>
    <article data-testid="conversation-turn-1"><p>Unlabeled streamed answer</p></article>
    <article data-testid="conversation-turn-2"><h6>ChatGPT said:</h6><p>Answer continued</p></article>
  </main>`, { url: 'https://chatgpt.com/c/123' });
  const result = extractConversation(dom.window.document, dom.window.location.href);
  assert.deepEqual(result.messages.map(message => message.role), ['User', 'Message', 'Assistant']);
  assert.match(result.warning, /speaker label/);
  assert.deepEqual(result.messages.map(message => message.markdown.match(/Question|Unlabeled streamed answer|Answer continued/)?.[0]), ['Question', 'Unlabeled streamed answer', 'Answer continued']);
  dom.window.close();
});
test('ChatGPT keeps distinct unlabeled provider turns separate even when both are neutral messages', () => {
  const dom = new JSDOM(`<main><article data-testid="conversation-turn-0"><h5 class="sr-only">You said:</h5><p>Question</p></article>
    <article data-testid="conversation-turn-1"><p>First neutral turn</p></article>
    <article data-testid="conversation-turn-2"><p>Second neutral turn</p></article></main>`, { url: 'https://chatgpt.com/c/123' });
  const result = extractConversation(dom.window.document, dom.window.location.href);
  assert.deepEqual(result.messages.map(message => message.role), ['User', 'Message', 'Message']);
  assert.deepEqual(result.messages.map(message => message.markdown), ['Question', 'First neutral turn', 'Second neutral turn']);
  dom.window.close();
});
test('ChatGPT captures media-only turns, including button-wrapped images and srcset images', () => {
  const dom = new JSDOM(`<main>
    <article><h5>You said:</h5><button aria-label="Open image"><img src="https://cdn.example/chart.png" alt="chart"></button></article>
    <article><h6>ChatGPT said:</h6><img srcset="https://cdn.example/answer.webp 2x" alt="answer"></article>
  </main>`, { url: 'https://chatgpt.com/c/123' });
  const result = extractConversation(dom.window.document, dom.window.location.href);
  assert.deepEqual(result.messages.map(message => message.role), ['User', 'Assistant']);
  assert.equal(result.media.length, 2);
  assert.deepEqual(result.media.map(item => item.url), ['https://cdn.example/chart.png', 'https://cdn.example/answer.webp']);
  assert.match(result.messages[0].markdown, /\{\{idea-media:media-0-0\}\}/);
  dom.window.close();
});
test('ChatGPT retains a labeled standalone SVG image and ignores an icon-only SVG button', () => {
  const dom = new JSDOM(`<main>
    <article><h5 class="sr-only">You said:</h5><svg aria-label="Chart"><circle cx="2" cy="2" r="1"></circle></svg></article>
    <article><h6 class="sr-only">ChatGPT said:</h6><button aria-label="Copy"><svg aria-label="Copy"><path d="M0 0"></path></svg></button></article>
  </main>`, { url: 'https://chatgpt.com/c/123' });
  const result = extractConversation(dom.window.document, dom.window.location.href);
  assert.equal(result.messages.length, 1);
  assert.equal(result.media.length, 1);
  assert.equal(result.media[0].mime, 'image/svg+xml');
  dom.window.close();
});
test('ChatGPT discovers heading-labeled plain articles inside main and ignores unlabeled articles and sidebar copies', () => {
  const dom = new JSDOM(`<aside><article><h5>You said:</h5><p>sidebar</p></article></aside><main>
    <article><h5>You said:</h5><p>Question one</p></article>
    <article><h6>ChatGPT said:</h6><p>Answer one</p></article>
    <article><p>Unrelated article</p></article>
    <article><h5>You said:</h5><p>Question two</p></article>
  </main>`, { url: 'https://chatgpt.com/c/123' });
  const result = extractConversation(dom.window.document, dom.window.location.href);
  assert.deepEqual(result.messages.map(message => message.role), ['User', 'Assistant', 'User']);
  assert.match(result.messages[0].markdown, /Question one/);
  assert.doesNotMatch(result.messages.map(message => message.markdown).join('\n'), /sidebar|Unrelated article/);
  dom.window.close();
});
test('ChatGPT detects user bubbles and assistant prose in the current thread layout and retains its gallery', () => {
  const dom = new JSDOM(`<!doctype html><main><div>Unrelated page content</div><section id="thread">
    <div class="conversation-row"><div class="user-message-bubble"><div class="whitespace-pre-wrap">Please analyze this image.</div></div></div>
    <div class="assistant-turn" data-message-id="answer-1"><div class="markdown prose"><p>Here is the analysis.</p></div><div class="image-gallery"><img src="https://cdn.example/gallery.png" alt="Generated chart"></div></div>
  </section></main><aside><div class="user-message-bubble">Sidebar copy</div></aside>`, { url: 'https://chatgpt.com/g/g-p-formulations/c/123' });
  const result = extractConversation(dom.window.document, dom.window.location.href);
  assert.deepEqual(result.messages.map(message => message.role), ['User', 'Assistant']);
  assert.deepEqual(result.sections.map(section => section.label), ['Please analyze this image.']);
  assert.match(result.messages[0].markdown, /Please analyze this image/);
  assert.match(result.messages[1].markdown, /Here is the analysis/);
  assert.doesNotMatch(result.messages.map(message => message.markdown).join('\n'), /Sidebar copy|Unrelated page content/);
  assert.equal(result.media.length, 1);
  assert.equal(result.media[0].url, 'https://cdn.example/gallery.png');
  dom.window.close();
});
test('ChatGPT bounds inferred replies to reported user ancestry and excludes page chrome and composer', () => {
  const markup = `<main><div class="bg-user-message">Q1</div><div><p>A1</p></div><div class="bg-user-message">Q2</div><div><p>A2</p></div><footer>Disclaimer</footer><form class="composer"><div contenteditable="true">Draft only</div></form></main><aside>Outside private navigation</aside>`;
  const dom = new JSDOM(markup, { url: 'https://chatgpt.com/c/123' });
  const result = extractConversation(dom.window.document, dom.window.location.href);
  assert.deepEqual(result.messages.map(message => message.role), ['User', 'Message', 'User', 'Message']);
  assert.deepEqual(result.messages.map(message => message.markdown), ['Q1', 'A1', 'Q2', 'A2']);
  assert.doesNotMatch(result.messages.map(message => message.markdown).join('\n'), /Disclaimer|Draft only|Outside private navigation/);
  // Discovery stays stable after the extension marks a prompt group collapsed.
  dom.window.document.querySelector('.bg-user-message').classList.add('idea-capture-section-collapsed');
  const rediscovered = extractConversation(dom.window.document, dom.window.location.href);
  assert.deepEqual(rediscovered.messages.map(message => message.markdown), ['Q1', 'A1', 'Q2', 'A2']);
  dom.window.close();
});
test('ChatGPT inferred reply shell preserves text around a nested prose candidate in order', () => {
  const result = extract('<main id="thread"><div class="bg-user-message">Prompt</div><div>before<div class="markdown">middle</div>after</div></main>');
  const replies = result.messages.filter(message => message.role !== 'User');
  assert.equal(replies.length, 1);
  assert.match(replies[0].markdown, /before[\s\S]*middle[\s\S]*after/);
  assert.equal((replies[0].markdown.match(/middle/g) || []).length, 1);
});
test('ChatGPT collapses UI-only sibling rows within a prompt interval without reaching the next section or page chrome', () => {
  const dom = new JSDOM(`<main id="thread">
    <div class="bg-user-message">Q</div>
    <div><p>A</p></div>
    <div id="actions" class="action-row"><button>Copy</button><button>+1</button></div>
    <div id="orphan-gallery" class="gallery-shell" aria-hidden="true"><div class="gallery"><figure>Empty image card</figure></div></div>
    <div id="orphan-references" class="reference-row" aria-hidden="true"><span>Sources</span><span>+1</span></div>
    <div class="bg-user-message">Q2</div>
    <div><p>A2</p></div>
    <div id="actions-2"><button>Copy</button></div>
    <header>Page header</header><footer>Page footer</footer><form class="composer"><textarea>Draft</textarea></form>
  </main>`, { url: 'https://chatgpt.com/c/123' });
  const doc = dom.window.document;
  const result = extractConversation(doc, dom.window.location.href, { includeNodes: true });
  const firstNodes = result.sections[0].collapseNodes;
  const secondNodes = result.sections[1].collapseNodes;
  assert.ok(firstNodes.some(node => node === doc.querySelector('#actions') || node.contains(doc.querySelector('#actions'))));
  assert.ok(firstNodes.some(node => node === doc.querySelector('#orphan-gallery') || node.contains(doc.querySelector('#orphan-gallery'))));
  assert.ok(firstNodes.some(node => node === doc.querySelector('#orphan-references') || node.contains(doc.querySelector('#orphan-references'))));
  assert.equal(firstNodes.some(node => node.contains(doc.querySelectorAll('.bg-user-message')[1])), false);
  assert.ok(secondNodes.some(node => node === doc.querySelector('#actions-2') || node.contains(doc.querySelector('#actions-2'))));
  assert.equal(result.sections.flatMap(section => section.collapseNodes).some(node => node.matches('header,footer,form') || node.closest('header,footer,form')), false);
  dom.window.close();
});
test('ChatGPT collapses a read-only code textbox while leaving the next prompt and composer untouched', () => {
  const dom = new JSDOM(`<style>.idea-capture-section-collapsed{display:none}</style><main id="thread">
    <div class="bg-user-message">Explain SQL</div>
    <div class="markdown"><p>Example</p><pre id="code" role="textbox" aria-readonly="true"><code>SELECT * FROM orders;</code></pre></div>
    <div class="bg-user-message">Next</div><div class="markdown">Next answer</div>
    <form><textarea aria-label="Message composer"></textarea></form>
  </main>`, { url: 'https://chatgpt.com/c/123' });
  const doc = dom.window.document;
  const result = extractConversation(doc, dom.window.location.href, { includeNodes: true });
  const code = doc.querySelector('#code');
  assert.ok(result.sections[0].collapseNodes.some(node => node === code || node.contains(code)));
  assert.doesNotMatch(result.messages.map(message => message.markdown).join('\n'), /aria-readonly|Message composer/);
  result.sections[0].collapseNodes.forEach(node => node.classList.add('idea-capture-section-collapsed'));
  assert.ok(code.closest('.idea-capture-section-collapsed'));
  assert.equal(doc.querySelectorAll('.bg-user-message')[1].classList.contains('idea-capture-section-collapsed'), false);
  assert.equal(doc.querySelector('form').classList.contains('idea-capture-section-collapsed'), false);
  dom.window.close();
});
test('ChatGPT discovers, exports and collapses detached reply siblings beside reported prose', () => {
  const dom = new JSDOM(`<style>.idea-capture-section-collapsed{display:none}</style><main id="thread">
    <div class="bg-user-message">Write a Python example</div>
    <div class="reply-shell"><p class="reply-intro">Introductory explanation.</p><div class="markdown"><p>Here are two examples.</p></div>
      <div class="generated-code-panel"><pre><code>print("first")</code></pre></div>
      <div class="generated-code-panel"><pre><code>print("second")</code></pre></div>
      <p class="streamed-follow-up">Use these examples in order.</p><p>Final note.</p>
    </div>
    <div class="bg-user-message">Next question</div><div class="markdown">Next answer</div>
  </main>`, { url: 'https://chatgpt.com/c/123' });
  const doc = dom.window.document;
  const result = extractConversation(doc, dom.window.location.href, { includeNodes: true });
  const codePanels = [...doc.querySelectorAll('.generated-code-panel')];
  const firstCollapseNodes = result.sections[0].collapseNodes;
  assert.deepEqual(result.messages.map(message => message.role), ['User', 'Message', 'Assistant', 'Message', 'User', 'Assistant']);
  assert.match(result.messages.map(message => message.markdown).join('\n'), /print\("first"\)/);
  assert.match(result.messages.map(message => message.markdown).join('\n'), /print\("second"\)/);
  assert.match(result.messages.map(message => message.markdown).join('\n'), /Use these examples in order/);
  assert.match(result.messages.map(message => message.markdown).join('\n'), /Introductory explanation/);
  assert.match(result.messages.map(message => message.markdown).join('\n'), /Final note/);
  assert.equal(codePanels.every(panel => firstCollapseNodes.some(node => node === panel || node.contains(panel))), true);
  firstCollapseNodes.forEach(node => node.classList.add('idea-capture-section-collapsed'));
  assert.equal(codePanels.every(panel => panel.closest('.idea-capture-section-collapsed')), true);
  assert.equal(doc.querySelectorAll('.bg-user-message')[1].classList.contains('idea-capture-section-collapsed'), false);
  dom.window.close();
});
test('ChatGPT inference keeps grouped neutral replies disjoint and splits composer branches safely', () => {
  const dom = new JSDOM(`<main id="thread">
    <div class="turn"><div class="bg-user-message">Grouped question</div><div><p>Grouped reply</p></div></div>
    <div class="turn"><div class="bg-user-message">Mixed question</div></div>
    <div><p>Mixed reply</p><div class="composer"><textarea>Private draft</textarea></div></div>
    <div><img src="https://cdn.example/direct.png" alt="Direct image"></div>
    <footer>Footer text</footer>
  </main><aside>Sidebar text</aside>`, { url: 'https://chatgpt.com/c/123' });
  const result = extractConversation(dom.window.document, dom.window.location.href, { includeNodes: true });
  assert.deepEqual(result.messages.map(message => message.role), ['User', 'Message', 'User', 'Message']);
  assert.match(result.messages[1].markdown, /Grouped reply/);
  assert.match(result.messages[3].markdown, /Mixed reply/);
  assert.doesNotMatch(result.messages[3].markdown, /Private draft/);
  assert.match(result.messages[3].markdown, /\{\{idea-media:media-3-0\}\}/);
  assert.equal(result.media[0].url, 'https://cdn.example/direct.png');
  assert.equal(result.sections.flatMap(section => section.nodes).some(node => node.matches?.('.composer') || node.closest?.('.composer')), false);
  assert.equal(result.sections.flatMap(section => section.collapseNodes).some(node => node.matches?.('.composer') || node.closest?.('.composer')), false);
  assert.doesNotMatch(result.messages.map(message => message.markdown).join('\n'), /Footer text|Sidebar text/);
  dom.window.close();
});
test('ChatGPT groups reported reply fragments, preserves references and media, and rediscovers collapsed structure', () => {
  const dom = new JSDOM(`<main id="thread">
    <div class="turn-branch"><div class="prompt"><div class="bg-user-message">Compare these findings.</div></div>
      <div class="reply"><div><p>Interviews explain local context.</p><p>Surveys show how common each pattern is. <a href="https://research.example/source">Source 1</a></p>
        <div class="gallery"><figure><img src="https://cdn.example/field.png" alt="Field notes"></figure><figure><button aria-label="Open empty result">Open result</button></figure></div>
        <div class="actions"><button aria-label="Copy">Copy</button><button aria-label="Good response">Good response</button><span class="sr-only">Actions</span></div></div></div>
    </div>
    <div class="turn-branch"><div class="prompt"><div class="bg-user-message">What should we test?</div></div><div class="reply"><p>Test the interview guide first.</p><a href="https://research.example/guide">Guide</a></div></div>
    <form class="composer"><textarea>PRIVATE_DRAFT</textarea></form><nav>PRIVATE_NAV</nav>
  </main>`, { url: 'https://chatgpt.com/c/123' });
  const doc = dom.window.document;
  const first = extractConversation(doc, dom.window.location.href, { includeNodes: true });
  assert.deepEqual(first.messages.map(message => message.role), ['User', 'Message', 'User', 'Message']);
  assert.equal(first.sections[0].messageCount, 2);
  assert.match(first.messages[1].markdown, /Source 1/);
  assert.match(first.messages[1].markdown, /https:\/\/research\.example\/source/);
  assert.match(first.messages[1].markdown, /\{\{idea-media:media-1-0\}\}/);
  assert.doesNotMatch(first.messages.map(message => message.markdown).join('\n'), /Copy|Good response|Open result|Actions|PRIVATE_DRAFT|PRIVATE_NAV/);
  assert.ok(first.sections[0].collapseNodes.some(node => node.contains(doc.querySelector('.bg-user-message'))));
  assert.equal(first.sections.flatMap(section => section.collapseNodes).some(node => node.matches('form,nav') || node.closest('form,nav')), false);
  for (const node of first.sections[0].collapseNodes) node.classList.add('idea-capture-section-collapsed');
  const rediscovered = extractConversation(doc, dom.window.location.href, { includeNodes: true });
  assert.deepEqual(rediscovered.messages.map(message => message.role), ['User', 'Message', 'User', 'Message']);
  assert.deepEqual(rediscovered.sections.map(section => section.messageCount), [2, 2]);
  assert.match(rediscovered.messages[1].markdown, /Source 1/);
  assert.equal(rediscovered.media[0].url, 'https://cdn.example/field.png');
  dom.window.close();
});
test('ChatGPT excludes sidebar landmarks from root scoring and message candidates', () => {
  const dom = new JSDOM(`<body class="sidebar-open"><main><section aria-label="History sidebar"><article data-testid="conversation-turn-99"><h2>You said:</h2><p>Sidebar prompt</p></article><div class="markdown">Sidebar answer</div></section><section id="thread"><article data-testid="conversation-turn-1"><h2>You said:</h2><p>Actual prompt</p></article><article data-testid="conversation-turn-2"><h2>ChatGPT said:</h2><p>Actual answer</p></article></section></main><main id="sidebar" aria-label="Sidebar"><div class="markdown">Wrong root</div></main></body>`, { url: 'https://chatgpt.com/c/123' });
  const result = extractConversation(dom.window.document, dom.window.location.href);
  assert.deepEqual(result.messages.map(message => message.role), ['User', 'Assistant']);
  assert.doesNotMatch(result.messages.map(message => message.markdown).join('\n'), /Sidebar prompt|Sidebar answer|Wrong root/);
  dom.window.close();
});
test('ChatGPT does not reinterpret prose nested inside a user bubble as an assistant reply', () => {
  const dom = new JSDOM(`<main><section id="thread"><div class="user-message-bubble"><div class="prose">User prompt</div></div></section></main>`, { url: 'https://chatgpt.com/c/123' });
  const result = extractConversation(dom.window.document, dom.window.location.href);
  assert.deepEqual(result.messages.map(message => message.role), ['User']);
  assert.deepEqual(result.sections.map(section => section.label), ['User prompt']);
  dom.window.close();
});
test('assistant styling wrappers containing a labeled user message do not duplicate its content', () => {
  const result = extract('<main><div class="assistant-turn"><div data-message-author-role="user">Prompt inside wrapper</div></div></main>');
  assert.deepEqual(result.messages.map(message => message.role), ['User']);
  assert.match(result.messages[0].markdown, /Prompt inside wrapper/);
});
test('ChatGPT uses labeled article roles before nested generic markdown classes', () => {
  const dom = new JSDOM(`<main><article><h2 class="sr-only">You said:</h2><div class="markdown">User prompt</div></article><article><h2 class="sr-only">ChatGPT said:</h2><div class="markdown">Assistant reply</div></article></main>`, { url: 'https://chatgpt.com/g/g-p-demo/c/123' });
  const result = extractConversation(dom.window.document, dom.window.location.href);
  assert.deepEqual(result.messages.map(message => message.role), ['User', 'Assistant']);
  assert.deepEqual(result.sections.map(section => section.label), ['User prompt']);
  assert.match(result.messages[0].markdown, /User prompt/);
  assert.match(result.messages[1].markdown, /Assistant reply/);
  dom.window.close();
});
test('nested same-role provider wrappers do not duplicate messages and Gemini boundaries remain distinct', () => {
  const chatgpt = extract('<article><div data-message-author-role="assistant"><div data-message-author-role="assistant">One answer</div></div></article>');
  assert.equal(chatgpt.messages.length, 1);
  assert.match(chatgpt.messages[0].markdown, /One answer/);
  const gemini = extract('<div><user-query>Question</user-query><model-response>Answer</model-response></div>', 'https://gemini.google.com/app/123');
  assert.deepEqual(gemini.messages.map(message => message.role), ['User', 'Assistant']);
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
test('generic empty pages and extension controls do not become page-content captures', () => {
  const empty = new JSDOM('<main><div data-idea-capture-control="true">Include section</div></main>');
  assert.throws(() => extractConversation(empty.window.document, 'https://example.com/chat'), /No conversation/);
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
  assert.equal(validateSettings({}).appUrl, 'https://ideas.local:8443');
  assert.doesNotMatch(filename('../bad/name:thing', 'md'), /[/:]/);
});
