#!/usr/bin/env node
// KhmerProof command line: check a TXT, DOCX or PDF file and write reports.
//
//   node bin/khmerproof.mjs check <file> [--mode legal] [--profile chuon-nath]
//                                       [--report html,csv,docx,pdf] [--out DIR] [--full-text]
//   node bin/khmerproof.mjs segment "<Khmer text>"
//
// Exit code: 0 when no error-severity findings, 1 when there are, 2 on usage errors.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { loadLexicon, analyze, segment } from '../engine/node.js';
import { buildReportModel, reportHtml, reportCsv } from '../engine/report.js';
import { readDocx, writeReportDocx } from '../engine/docx.js';
import { CATEGORIES, SEVERITIES } from '../engine/finding.js';

function usage(msg) {
  if (msg) console.error(msg);
  console.error('Usage: khmerproof check <file.txt|file.docx|file.pdf> [--mode general|academic|government|administrative|legal] [--profile standard|chuon-nath] [--report html,csv,docx,pdf] [--out DIR] [--full-text]\n       khmerproof segment "<text>"');
  process.exit(2);
}

async function readInput(file) {
  const ext = path.extname(file).toLowerCase();
  const bytes = fs.readFileSync(file);
  if (ext === '.docx') return readDocx(new Uint8Array(bytes)).text;
  if (ext === '.pdf') {
    try { return execFileSync(process.env.PDFTOTEXT_PATH || 'pdftotext', ['-enc', 'UTF-8', file, '-'], { maxBuffer: 50e6 }).toString('utf8').replace(/\f/g, '\n\n').trim(); }
    catch {
      console.error('pdftotext not found; falling back to pdf.js (Khmer text from PDFs may be damaged).');
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const { extractPdfText } = await import('../engine/pdftext.js');
      return (await extractPdfText(pdfjs, new Uint8Array(bytes))).text;
    }
  }
  return bytes.toString('utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const opt = (name, def) => { const i = rest.indexOf('--' + name); return i >= 0 ? rest[i + 1] : def; };
  if (cmd === 'segment') { console.log(segment(rest.join(' '), loadLexicon()).join(' | ')); return; }
  if (cmd !== 'check') usage();
  const file = rest.find(a => !a.startsWith('--') && !['--mode', '--profile', '--report', '--out'].includes(rest[rest.indexOf(a) - 1]));
  if (!file || !fs.existsSync(file)) usage('File not found');
  const text = await readInput(file);
  const lexicon = loadLexicon();
  const r = analyze(text, lexicon, { mode: opt('mode', 'general'), profile: opt('profile', 'standard') });
  for (const f of r.findings) {
    console.log(`${f.location.line}:${f.location.column}\t${SEVERITIES[f.severity].en}\t${CATEGORIES[f.category].en}\t«${f.original}»${f.suggestions.length ? ' → «' + f.suggestions[0] + '»' : ''}\t${Math.round(f.confidence * 100)}%\t${f.ruleId}`);
  }
  console.error(`${r.findings.length} findings in ${r.stats.words} words (${r.stats.ms} ms).`);
  const kinds = (opt('report', '') || '').split(',').filter(Boolean);
  if (kinds.length) {
    const out = opt('out', path.dirname(file));
    fs.mkdirSync(out, { recursive: true });
    const model = buildReportModel({ title: path.basename(file), documentName: path.basename(file), text, open: r.findings, decisions: [], settings: r.settings,
      documentHash: crypto.createHash('sha256').update(text).digest('hex'), includeFullText: rest.includes('--full-text') });
    const stem = path.join(out, path.basename(file).replace(/\.[^.]+$/, '') + '_KhmerProof');
    for (const k of kinds) {
      if (k === 'html') fs.writeFileSync(stem + '.html', reportHtml(model));
      else if (k === 'csv') fs.writeFileSync(stem + '.csv', reportCsv(model));
      else if (k === 'docx') fs.writeFileSync(stem + '.docx', writeReportDocx(model));
      else if (k === 'pdf') {
        const { htmlToPdf, embeddedFontCss, closeBrowser } = await import('../server/pdf.mjs');
        fs.writeFileSync(stem + '.pdf', await htmlToPdf(reportHtml(model, { fontCss: embeddedFontCss(), forPrint: true })));
        await closeBrowser();
      } else usage(`Unknown report format: ${k}`);
      console.error(`Wrote ${stem}.${k}`);
    }
  }
  process.exitCode = r.findings.some(f => f.severity === 'error') ? 1 : 0;
}
main().catch(e => { console.error(e.message); process.exit(2); });
