import { build } from 'esbuild';
import { mkdir, copyFile, rm } from 'node:fs/promises';
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await build({ entryPoints: ['src/background.js', 'src/options.js', 'src/offscreen.js', 'src/print.js'], bundle: true, outdir: 'dist', format: 'esm', target: 'chrome120' });
await build({ entryPoints: ['src/content.js'], bundle: true, outfile: 'dist/content.js', format: 'iife', target: 'chrome120' });
for (const name of ['manifest.json', 'options.html', 'offscreen.html', 'print.html', 'style.css']) await copyFile(name === 'manifest.json' ? name : `src/${name}`, `dist/${name}`);
console.log('Built dist/ — load this directory as an unpacked extension.');
