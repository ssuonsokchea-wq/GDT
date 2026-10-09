#!/usr/bin/env node
// Copies the browser builds of third-party libraries into public/vendor so the app can
// be served without a CDN (no third-party requests, works offline and on static hosts).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NM = path.join(ROOT, 'node_modules');
const OUT = path.join(ROOT, 'public', 'vendor');
const copies = [
  ['fflate/esm/browser.js', 'fflate/browser.js'],
  ['fflate/LICENSE', 'fflate/LICENSE'],
  ['pdfjs-dist/legacy/build/pdf.min.mjs', 'pdfjs/pdf.min.mjs'],
  ['pdfjs-dist/legacy/build/pdf.worker.min.mjs', 'pdfjs/pdf.worker.min.mjs'],
  ['pdfjs-dist/LICENSE', 'pdfjs/LICENSE'],
  ['@fontsource/noto-sans-khmer/files/noto-sans-khmer-khmer-400-normal.woff2', 'fonts/noto-sans-khmer-khmer-400.woff2'],
  ['@fontsource/noto-sans-khmer/files/noto-sans-khmer-khmer-700-normal.woff2', 'fonts/noto-sans-khmer-khmer-700.woff2'],
  ['@fontsource/noto-sans-khmer/files/noto-sans-khmer-latin-400-normal.woff2', 'fonts/noto-sans-khmer-latin-400.woff2'],
  ['@fontsource/noto-sans-khmer/files/noto-sans-khmer-latin-700-normal.woff2', 'fonts/noto-sans-khmer-latin-700.woff2'],
  ['@fontsource/noto-sans-khmer/LICENSE', 'fonts/LICENSE-OFL.txt'],
];
let n = 0;
for (const [from, to] of copies) {
  const src = path.join(NM, from);
  if (!fs.existsSync(src)) { console.warn(`copy-vendor: missing ${from} (run npm install)`); continue; }
  fs.mkdirSync(path.dirname(path.join(OUT, to)), { recursive: true });
  fs.copyFileSync(src, path.join(OUT, to));
  n++;
}
console.log(`copy-vendor: ${n} files copied to public/vendor`);
