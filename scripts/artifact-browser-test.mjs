import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { inflateSync } from 'node:zlib';
import { mkdir } from 'node:fs/promises';
import { artifactHtml } from '../src/artifact-export.js';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('');
globalThis.DOMParser = dom.window.DOMParser;

const runtimeBuild = await build({
  stdin: {
    contents: `import './src/artifact-react-runtime.js';`,
    resolveDir: process.cwd(), sourcefile: 'artifact-react-runtime.js',
  }, bundle: true, format: 'iife', platform: 'browser', write: false,
});
const reactRuntime = runtimeBuild.outputFiles[0].text;
const style = `*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;font:16px/1.4 Arial,sans-serif;color:#17212b;background:#f5f7fa}#root{padding:24px;width:640px;height:480px}header{display:flex;align-items:center;gap:12px}button,input{font:inherit;padding:6px 10px;border:1px solid #8a99a8;border-radius:4px;background:white}nav{display:flex;gap:8px;margin:16px 0}ul{padding-left:22px}.chart{width:180px;height:90px;background:#fff;border:1px solid #ccd2d8}svg rect{fill:#436f9c}`;
const componentCode = `import React,{useState} from 'react';
import { Search } from 'lucide-react';
import { BarChart, Bar } from 'recharts';
export default function App(){
 const [count,setCount]=useState(0),[tab,setTab]=useState('Overview'),[query,setQuery]=useState('');
 const items=['Alpha','Beta','Gamma'];
 return <main><header><h1>Research board</h1><button id="increment" onClick={()=>setCount(count+1)}>Add {count}</button><button id="reset" onClick={()=>setCount(0)}>Reset</button></header>
 <nav><button onClick={()=>setTab('Overview')}>Overview</button><button onClick={()=>setTab('Details')}>Details</button></nav>
 <p id="tab-content">{tab === 'Overview' ? 'Overview panel' : 'Detailed panel'}</p>
 <label>Filter <input id="filter" value={query} onChange={event=>setQuery(event.target.value)}/></label>
 <ul>{items.filter(item=>item.toLowerCase().includes(query.toLowerCase())).map(item=><li key={item}>{item}</li>)}</ul>
 <Search aria-label="Search icon"/><svg className="chart" viewBox="0 0 180 90" aria-label="Activity chart"><rect id="bar" x="20" y={70-count*10} width="40" height={count*10+1}/></svg>
 <BarChart width={180} height={90} data={[{name:'Activity',value:count+1}]}><Bar dataKey="value" isAnimationActive={false}/></BarChart>
 </main>;
}`;

function decodeRgbaPng(buffer) {
  let width, height, bitDepth, colorType;
  const chunks = [];
  for (let offset = 8; offset < buffer.length;) {
    const size = buffer.readUInt32BE(offset); const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + size); offset += size + 12;
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
    if (type === 'IDAT') chunks.push(data);
    if (type === 'IEND') break;
  }
  assert.equal(bitDepth, 8); assert.ok(colorType === 2 || colorType === 6, 'Chromium screenshot uses RGB or RGBA PNG');
  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const packed = inflateSync(Buffer.concat(chunks)); const stride = width * bytesPerPixel; const pixels = Buffer.alloc(stride * height);
  let input = 0;
  for (let y = 0; y < height; y++) {
    const filter = packed[input++]; const row = y * stride;
    for (let x = 0; x < stride; x++) {
      const raw = packed[input++], left = x >= bytesPerPixel ? pixels[row + x - bytesPerPixel] : 0, up = y ? pixels[row - stride + x] : 0, upperLeft = y && x >= bytesPerPixel ? pixels[row - stride + x - bytesPerPixel] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = Math.floor((left + up) / 2);
      else if (filter === 4) { const p = left + up - upperLeft, a = Math.abs(p - left), b = Math.abs(p - up), c = Math.abs(p - upperLeft); predictor = a <= b && a <= c ? left : b <= c ? up : upperLeft; }
      else assert.equal(filter, 0, 'known PNG filter');
      pixels[row + x] = (raw + predictor) & 255;
    }
  }
  return { width, height, pixels };
}

test('standalone artifact packages source interactions and React behavior', async () => {
  const htmlArtifact = {
    kind: 'html', title: 'Source app', source: { html: `<!doctype html><html><head><style>button{color:rgb(12, 34, 56)}</style></head><body><button id="count">Count 0</button><script>let n=0;document.querySelector('#count').addEventListener('click',()=>document.querySelector('#count').textContent='Count '+(++n));</script></body></html>` },
  };
  const reactArtifact = {
    kind: 'react', title: 'React source', source: { language: 'jsx', css: ['button{font-size:18px}'], code: `import React, { useState } from 'react'; export default function App(){ const [count,setCount]=useState(0); return <button onClick={()=>setCount(count+1)}>React {count}</button>; }` },
  };
  const browser = await chromium.launch(process.env.IDEA_BROWSER_PATH
    ? { executablePath: process.env.IDEA_BROWSER_PATH }
    : { channel: process.env.IDEA_BROWSER_CHANNEL || 'chromium' });
  try {
    const page = await browser.newPage();
    for (const html of [artifactHtml(htmlArtifact), artifactHtml(reactArtifact, { reactRuntime })]) {
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      const button = page.locator('button');
      await button.waitFor();
      const initial = await button.textContent();
      await button.click();
      assert.notEqual(await button.textContent(), initial, 'packaged source behavior remains interactive');
      assert.match(await page.locator('style').last().textContent(), /button/);
      assert.match(await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content'), /connect-src 'none'/);
    }
  } finally {
    await browser.close();
  }
});

test('React artifact matches its original rendering and remains interactive in an opaque sandbox', async () => {
  const reactArtifact = { kind: 'react', title: 'React board', width: 640, height: 480, source: { language: 'jsx', css: [style], code: componentCode } };
  const packaged = artifactHtml(reactArtifact, { reactRuntime });
  const originalBuild = await build({
    stdin: {
      contents: `import {createRoot} from 'react-dom/client';\n${componentCode}\ncreateRoot(document.getElementById('root')).render(React.createElement(App));`,
      resolveDir: process.cwd(), sourcefile: 'original-react-fixture.jsx', loader: 'jsx',
    }, bundle: true, format: 'iife', platform: 'browser', write: false,
  });
  const original = `<!doctype html><html><head><style>${style}</style></head><body><div id="root"></div><script>${originalBuild.outputFiles[0].text}</script></body></html>`;
  const browser = await chromium.launch(process.env.IDEA_BROWSER_PATH
    ? { executablePath: process.env.IDEA_BROWSER_PATH }
    : { channel: process.env.IDEA_BROWSER_CHANNEL || 'chromium' });
  try {
    const page = await browser.newPage({ viewport: { width: 640, height: 480 }, deviceScaleFactor: 1 });
    await page.setContent(original, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Research board' }).waitFor();
    await mkdir('artifacts', { recursive: true });
    const originalPixels = decodeRgbaPng(await page.screenshot({ path: 'artifacts/react-artifact-original.png', fullPage: true }));

    await page.setContent(packaged, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Research board' }).waitFor();
    const packagedPixels = decodeRgbaPng(await page.screenshot({ path: 'artifacts/react-artifact-export.png', fullPage: true }));
    assert.equal(packagedPixels.width, originalPixels.width);
    assert.equal(packagedPixels.height, originalPixels.height);
    assert.deepEqual(packagedPixels.pixels, originalPixels.pixels, 'packaged app rendering matches the original React source pixel for pixel');

    await page.getByRole('button', { name: 'Details' }).click();
    await page.getByText('Detailed panel').waitFor();
    await page.getByLabel('Filter').fill('beta');
    assert.deepEqual(await page.locator('li').allTextContents(), ['Beta']);
    await page.getByRole('button', { name: 'Add 0' }).click();
    assert.equal(await page.locator('#bar').getAttribute('height'), '11');
    await page.getByRole('button', { name: 'Reset' }).click();
    assert.equal(await page.locator('#bar').getAttribute('height'), '1');

    const outbound = [];
    page.on('request', request => { if (request.url().startsWith('https://example.test/')) outbound.push(request.url()); });
    await page.setContent('<div id="private">parent secret</div><iframe id="artifact" sandbox="allow-scripts"></iframe>');
    const frame = page.frameLocator('#artifact');
    await page.locator('#artifact').evaluate((node, srcdoc) => { node.srcdoc = srcdoc; }, packaged.replace('</body>', `<script>try{window.__parentRead=parent.document.querySelector('#private')?.textContent||'missing'}catch{window.__parentRead='blocked'};fetch('https://example.test/leak').catch(()=>{});</script></body>`));
    await frame.getByRole('heading', { name: 'Research board' }).waitFor();
    const child = page.frames().find(item => item.parentFrame() === page.mainFrame());
    assert.equal(await child.evaluate(() => window.__parentRead), 'blocked', 'opaque sandbox prevents access to the embedding document');
    assert.equal(await frame.locator('meta[http-equiv="Content-Security-Policy"]').count(), 1);
    assert.equal(outbound.length, 0, 'the exported artifact CSP denies network requests');
  } finally {
    await browser.close();
  }
});

test('TSX artifact renders typed memo and forwardRef components', async () => {
  const source = `import React,{memo,forwardRef,useState} from 'react';
type Props={label?:string};
export default memo(forwardRef<HTMLButtonElement,Props>(function App({label='Count'}:Props,ref){
 const [count,setCount]=useState<number>(0);
 return <button ref={ref} onClick={()=>setCount(count+1)}>{label} {count}</button>;
}));`;
  const html = artifactHtml({ kind: 'react', title: 'Typed counter', source: { code: source, language: 'tsx' } }, { reactRuntime });
  const browser = await chromium.launch(process.env.IDEA_BROWSER_PATH
    ? { executablePath: process.env.IDEA_BROWSER_PATH }
    : { channel: process.env.IDEA_BROWSER_CHANNEL || 'chromium' });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    const counter = page.getByRole('button', { name: 'Count 0' });
    await counter.waitFor();
    await counter.click();
    await page.getByRole('button', { name: 'Count 1' }).waitFor();
  } finally {
    await browser.close();
  }
});

test('artifact packaging rejects static snapshots and missing resource source', () => {
  assert.match(artifactHtml({ kind: 'html', source: { html: '<html><body><button>Static</button></body></html>' } }), /<button>Static<\/button>/, 'source HTML retains native interactions without requiring script code');
  assert.throws(() => artifactHtml({ kind: 'html', source: { html: '<html><body><img src="https://example.test/image.png"><script>ok()</script></body></html>' } }), /resource was not captured/);
  assert.throws(() => artifactHtml({ kind: 'react', source: { language: 'jsx', code: 'export default () => <div />' } }), /requires the packaged React runtime/);
});
