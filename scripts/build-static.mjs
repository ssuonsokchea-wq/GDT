#!/usr/bin/env node
// Assembles dist/ — a static copy of KhmerProof for GitHub Pages, Cloudflare Pages or any
// static host. Spelling, grammar, uploads (TXT, DOCX, PDF via pdf.js) and HTML/CSV/DOCX
// reports work in static mode; server PDF reports, server PDF extraction and the AI
// review need the Node server (npm start or Docker).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
fs.rmSync(DIST, { recursive: true, force: true });
const copy = (from, to) => fs.cpSync(path.join(ROOT, from), path.join(DIST, to), { recursive: true });
if (!fs.existsSync(path.join(ROOT, 'public', 'vendor'))) { console.error('public/vendor missing: run npm install first'); process.exit(1); }
copy('public', '.');
copy('engine', 'engine');
fs.mkdirSync(path.join(DIST, 'data'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'data', 'lexicon.json'), path.join(DIST, 'data', 'lexicon.json'));
fs.copyFileSync(path.join(ROOT, 'data', 'LICENSES', 'LGPL-2.1.txt'), path.join(DIST, 'data', 'LICENSE-LGPL-2.1.txt'));
// Tell the app that no server features exist (avoids a 404 on static hosts)
fs.mkdirSync(path.join(DIST, 'api'), { recursive: true });
fs.writeFileSync(path.join(DIST, 'api', 'status'), JSON.stringify({ static: true, pdf: false, pdfText: false, ai: false }));
// GitHub Pages: do not run Jekyll over the files
fs.writeFileSync(path.join(DIST, '.nojekyll'), '');
// Cloudflare Pages / Netlify: security headers
fs.writeFileSync(path.join(DIST, '_headers'), `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  X-Frame-Options: DENY
  Permissions-Policy: camera=(), microphone=(), geolocation=()
`);
let files = 0;
(function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p) : files++; } })(DIST);
console.log(`dist/ ready: ${files} files`);
