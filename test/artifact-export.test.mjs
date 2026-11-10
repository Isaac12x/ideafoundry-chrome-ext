import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { artifactHtml, compileReactArtifact } from '../src/artifact-export.js';

const dom = new JSDOM('');
globalThis.DOMParser = dom.window.DOMParser;

test('source HTML preserves its execution and cascade order while inlining captured dependencies', () => {
  const artifact = {
    kind: 'html', title: 'Captured source',
    source: {
      baseUrl: 'https://example.test/artifacts/demo.html',
      html: `<!doctype html><html><head><style>#target{color:red}</style><link rel="stylesheet" href="/assets/app.css"><style>#target{font-weight:bold}</style><script src="/assets/app.js"></script></head><body><p id="target" style="background-image:url(./pixel.png)">Source</p><script>window.inlineAfterExternal=window.externalAppLoaded;</script></body></html>`,
      assets: {
        'https://example.test/assets/app.css': { mime: 'text/css', text: '#target{color:blue}' },
        'https://example.test/assets/app.js': { mime: 'text/javascript', text: 'window.externalAppLoaded="loaded";' },
        'https://example.test/artifacts/pixel.png': { mime: 'image/png', data: 'aGVsbG8=' },
      },
    },
  };
  const output = artifactHtml(artifact);
  assert.ok(output.indexOf('#target{color:red}') < output.indexOf('#target{color:blue}'));
  assert.ok(output.indexOf('#target{color:blue}') < output.indexOf('#target{font-weight:bold}'));
  assert.ok(output.indexOf('window.externalAppLoaded="loaded"') < output.indexOf('window.inlineAfterExternal'));
  assert.match(output, /data:image\/png;base64,aGVsbG8=/);
  assert.doesNotMatch(output, /src="https:\/\/example\.test\/assets\/app\.js"|href="https:\/\/example\.test\/assets\/app\.css"/);
  assert.match(output, /connect-src 'none'/);
});

test('source HTML preserves native behavior and rejects unresolved or executable module dependencies', () => {
  assert.match(artifactHtml({ kind: 'html', source: { html: '<html><body><details><summary>More</summary>Body</details></body></html>' } }), /<details>/);
  assert.throws(() => artifactHtml({ kind: 'html', source: { baseUrl: 'https://example.test/', html: '<html><body><img src="/missing.png"></body></html>' } }), /resource was not captured/);
  assert.throws(() => artifactHtml({ kind: 'html', source: { html: '<html><body><script>import("./app.js")</script></body></html>' } }), /Unsupported inline script import/);
  assert.throws(() => artifactHtml({ kind: 'html', source: { html: '<html><body><script src="blob:https://example.test/app"></script></body></html>' } }), /script was not captured/);
});

test('React compiler supports packaged runtime imports and rejects unavailable modules and styles', () => {
  const code = `import React,{useState} from 'react'; import {Search} from 'lucide-react'; export default function App(){const [x]=useState(0);return <button className="button"><Search/>{x}</button>}`;
  const compiled = compileReactArtifact({ code, language: 'jsx', css: ['.button{color:red}'] });
  assert.match(compiled, /React\.createElement/);
  assert.match(compiled, /IdeaArtifactModules/);
  assert.throws(() => compileReactArtifact({ code: `import Chart from 'other-chart'; export default () => <Chart/>`, language: 'jsx' }), /Unsupported React artifact import: other-chart/);
  assert.throws(() => artifactHtml({ kind: 'react', source: { code, language: 'jsx' } }, { reactRuntime: 'runtime' }), /stylesheet source was not captured/);
  assert.throws(() => artifactHtml({ kind: 'react', source: { code: 'export default () => <div/>', language: 'jsx' } }), /requires the packaged React runtime/);
});

test('React compiler transforms typed TSX components including memo and forwardRef', () => {
  const code = `import React,{memo,forwardRef,useState} from 'react'; type Props={label:string}; export default memo(forwardRef<HTMLButtonElement,Props>(function App({label}:Props,ref){const [count,setCount]=useState<number>(0);return <button ref={ref} onClick={()=>setCount(count+1)}>{label} {count}</button>}));`;
  const compiled = compileReactArtifact({ code, language: 'tsx' });
  assert.match(compiled, /forwardRef/);
  assert.match(compiled, /React\.createElement/);
  assert.doesNotMatch(compiled, /type Props|useState<number>/);
});
