#!/usr/bin/env node
// KhmerProof web server.
//
// Text is checked in the browser; this server only serves the app and, on request,
//   POST /api/report/pdf   renders a report the browser built into a PDF (Chromium)
//   POST /api/ai-review    optional contextual review (off unless configured)
//   GET  /api/status       which optional services are available
// Request bodies are processed in memory and never written to disk or logged.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { reportHtml } from '../engine/report.js';
import { ENGINE_VERSION } from '../engine/analyzer.js';
import { htmlToPdf, embeddedFontCss, pdfAvailable } from './pdf.mjs';
import { aiEnabled, aiReview, aiRephrase, AI_MODEL } from './ai-review.mjs';
import { loadLexicon } from '../engine/node.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '127.0.0.1';
const MAX_BODY = 8 * 1024 * 1024;

// Static files: URL prefix → directory. Nothing outside these directories is served.
const STATIC = [
  ['/engine/', path.join(ROOT, 'engine')],
  ['/data/', path.join(ROOT, 'data')],
  ['/vendor/', path.join(ROOT, 'public', 'vendor')],
  ['/', path.join(ROOT, 'public')],
];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const DATA_ALLOW = new Set(['lexicon.json']);

// The only inline script is the import map in index.html; allow exactly that by hash.
function importMapHash() {
  try {
    const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
    const m = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
    return m ? ` 'sha256-${crypto.createHash('sha256').update(m[1]).digest('base64')}'` : '';
  } catch { return ''; }
}
const SECURITY_HEADERS = {
  'Content-Security-Policy': `default-src 'self'; script-src 'self'${importMapHash()}; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
};

// Simple per-IP rate limiting (fixed one-minute windows).
const buckets = new Map();
function rateLimited(ip, key, perMinute) {
  const now = Date.now(), k = `${key}|${ip}`;
  const b = buckets.get(k);
  if (!b || now - b.t > 60000) { buckets.set(k, { t: now, n: 1 }); return false; }
  return ++b.n > perMinute;
}
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (now - b.t > 120000) buckets.delete(k); }, 60000).unref();

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}
const json = (res, status, obj) => send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });

function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('File too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// PDF text extraction with Poppler's pdftotext, which honours the ActualText markers that
// carry correct Khmer in many PDFs (pdf.js ignores them). The file lives in a private
// temporary directory only while pdftotext runs.
const PDFTOTEXT = process.env.PDFTOTEXT_PATH || 'pdftotext';
let pdftotextOk = null;
function pdftotextAvailable() {
  if (pdftotextOk !== null) return Promise.resolve(pdftotextOk);
  return new Promise(resolve => execFile(PDFTOTEXT, ['-v'], err => resolve(pdftotextOk = !err || err.code !== 'ENOENT')));
}
async function extractPdf(bytes) {
  if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') throw Object.assign(new Error('Not a PDF file'), { status: 400 });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'khmerproof-'));
  const file = path.join(dir, 'in.pdf');
  try {
    fs.writeFileSync(file, bytes, { mode: 0o600 });
    const text = await new Promise((resolve, reject) => execFile(PDFTOTEXT, ['-enc', 'UTF-8', '-l', '300', file, '-'], { maxBuffer: 20 * 1024 * 1024, timeout: 60000 },
      (err, stdout) => err ? reject(Object.assign(new Error('Could not read this PDF'), { status: 422 })) : resolve(stdout)));
    const clean = text.replace(/\f/g, '\n\n').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    const warnings = [];
    if (!clean) warnings.push('PDF នេះគ្មានស្រទាប់អត្ថបទ (ប្រហែលជាឯកសារស្កេន)។ សូមធ្វើ OCR ជាមុនសិន។');
    else if (!/[\u1780-\u17FF]/u.test(clean)) warnings.push('PDF នេះមិនមានអក្សរខ្មែរយូនីកូដទេ។ វាអាចប្រើពុម្ពអក្សរចាស់ (Limon/ABC)។');
    if (clean) warnings.push('ការដកអត្ថបទពី PDF មិនរក្សាប្លង់ ឬទ្រង់ទ្រាយដើមទេ។');
    return { text: clean.slice(0, 300000), warnings };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('Request too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

/** Keep only the fields the report renderer uses, with safe types. */
function sanitizeModel(m) {
  if (!m || typeof m !== 'object' || !Array.isArray(m.rows) || m.rows.length > 5000) throw Object.assign(new Error('Invalid report'), { status: 400 });
  const str = (v, max = 5000) => String(v ?? '').slice(0, max);
  const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const rows = m.rows.map((r, i) => ({
    no: i + 1, status: ['open', 'accepted', 'rejected'].includes(r.status) ? r.status : 'open',
    original: str(r.original, 2000), context: str(r.context, 5000), contextOffset: num(r.contextOffset),
    category: str(r.category, 40), severity: str(r.severity, 20), explanation: str(r.explanation, 3000), legalNote: r.legalNote ? str(r.legalNote, 1000) : null,
    suggestions: Array.isArray(r.suggestions) ? r.suggestions.slice(0, 10).map(s => str(s, 2000)) : [], chosen: r.chosen == null ? null : str(r.chosen, 2000),
    confidence: Math.min(1, Math.max(0, num(r.confidence))), confidenceLevel: ['high', 'medium', 'low'].includes(r.confidenceLevel) ? r.confidenceLevel : 'low',
    source: r.source ? { km: str(r.source.km, 1000), en: str(r.source.en, 1000), url: /^https:\/\//.test(r.source.url || '') ? str(r.source.url, 300) : null, detail: r.source.detail ? str(r.source.detail, 500) : null } : null,
    location: r.location ? { paragraph: num(r.location.paragraph), line: num(r.location.line), column: num(r.location.column) } : null,
    start: num(r.start), end: num(r.end), ruleId: str(r.ruleId, 80), humanReview: !!r.humanReview,
  }));
  const t = m.totals || {};
  return {
    title: str(m.title, 200), generatedAt: !Number.isNaN(Date.parse(m.generatedAt)) ? new Date(m.generatedAt).toISOString() : new Date().toISOString(),
    documentHash: /^[0-9a-f]{64}$/.test(m.documentHash || '') ? m.documentHash : null, documentName: m.documentName ? str(m.documentName, 200) : null,
    settings: { engineVersion: ENGINE_VERSION, mode: str(m.settings?.mode, 20), profile: str(m.settings?.profile, 20), lexiconEntries: num(m.settings?.lexiconEntries) },
    totals: { all: rows.length, open: num(t.open), accepted: num(t.accepted), rejected: num(t.rejected), byCategory: Object.fromEntries(Object.entries(t.byCategory || {}).slice(0, 30).map(([k, v]) => [str(k, 40), num(v)])) },
    rows, fullText: typeof m.fullText === 'string' ? m.fullText.slice(0, 300000) : null,
  };
}

const gzCache = new Map();
function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  for (const [prefix, dir] of STATIC) {
    if (!pathname.startsWith(prefix)) continue;
    const rel = pathname.slice(prefix.length);
    if (prefix === '/data/' && !DATA_ALLOW.has(rel)) break;
    const file = path.resolve(dir, '.' + path.sep + rel);
    if (!file.startsWith(dir + path.sep)) break;
    let stat;
    try { stat = fs.statSync(file); } catch { continue; }
    if (!stat.isFile()) continue;
    const ext = path.extname(file).toLowerCase();
    const type = TYPES[ext];
    if (!type) break;
    const headers = { 'Content-Type': type, 'Cache-Control': 'no-cache' };
    const big = stat.size > 20000 && /json|javascript|css|svg|html/.test(type);
    if (big && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
      const key = `${file}|${stat.mtimeMs}`;
      if (!gzCache.has(key)) gzCache.set(key, zlib.gzipSync(fs.readFileSync(file), { level: 9 }));
      return send(res, 200, req.method === 'HEAD' ? null : gzCache.get(key), { ...headers, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' });
    }
    return send(res, 200, req.method === 'HEAD' ? null : fs.readFileSync(file), headers);
  }
  send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const started = Date.now();
    const url = new URL(req.url, 'http://localhost');
    const ip = req.socket.remoteAddress || '';
    try {
      if (url.pathname === '/api/status' && req.method === 'GET') {
        return json(res, 200, { version: ENGINE_VERSION, pdf: await pdfAvailable(), pdfText: await pdftotextAvailable(), ai: aiEnabled(), aiModel: aiEnabled() ? AI_MODEL : null });
      }
      if (url.pathname === '/api/extract/pdf' && req.method === 'POST') {
        if (rateLimited(ip, 'extract', 20)) return json(res, 429, { error: 'Too many requests' });
        if (!await pdftotextAvailable()) return json(res, 501, { error: 'pdftotext is not installed on this server' });
        return json(res, 200, await extractPdf(await readRaw(req, 25 * 1024 * 1024)));
      }
      if (url.pathname === '/api/report/pdf' && req.method === 'POST') {
        if (rateLimited(ip, 'pdf', 20)) return json(res, 429, { error: 'Too many requests' });
        const body = await readBody(req);
        const model = sanitizeModel(body.model);
        const pdf = await htmlToPdf(reportHtml(model, { fontCss: embeddedFontCss(), forPrint: true }));
        return send(res, 200, pdf, { 'Content-Type': 'application/pdf', 'Cache-Control': 'no-store', 'Content-Disposition': 'attachment; filename="KhmerProof-report.pdf"' });
      }
      if (url.pathname === '/api/ai-review' && req.method === 'POST') {
        if (!aiEnabled()) return json(res, 503, { error: 'AI review is not enabled on this server' });
        if (rateLimited(ip, 'ai', 10)) return json(res, 429, { error: 'Too many requests' });
        const body = await readBody(req);
        const mode = ['general', 'academic', 'government', 'administrative', 'legal'].includes(body.mode) ? body.mode : 'general';
        return json(res, 200, await aiReview(String(body.text || ''), mode, loadLexicon()));
      }
      if (url.pathname === '/api/rephrase' && req.method === 'POST') {
        if (!aiEnabled()) return json(res, 503, { error: 'AI review is not enabled on this server' });
        if (rateLimited(ip, 'ai', 10)) return json(res, 429, { error: 'Too many requests' });
        const body = await readBody(req);
        const mode = ['general', 'academic', 'government', 'administrative', 'legal'].includes(body.mode) ? body.mode : 'general';
        return json(res, 200, await aiRephrase(String(body.text || ''), mode, loadLexicon()));
      }
      if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Not found' });
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
      return serveStatic(req, res, url);
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) console.error(`[${new Date().toISOString()}] ${req.method} ${url.pathname} failed: ${e.message}`);
      if (!res.headersSent) json(res, status, { error: status >= 500 ? 'Server error' : e.message });
    } finally {
      // Access log without bodies, queries or client addresses.
      if (process.env.KHMERPROOF_LOG !== 'off') res.on('finish', () => console.log(`${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - started}ms`));
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!fs.existsSync(path.join(ROOT, 'public', 'vendor'))) console.warn('public/vendor is missing: run `npm install` (it copies browser libraries into public/vendor).');
  createServer().listen(PORT, HOST, () => {
    console.log(`KhmerProof ${ENGINE_VERSION} running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/`);
    console.log(`AI review: ${aiEnabled() ? 'enabled (' + AI_MODEL + ')' : 'off'}`);
  });
}
