#!/usr/bin/env node
// Builds data/lexicon.json from:
//   1. Chuon Nath Khmer Dictionary (Buddhist Institute, 1967), digitised by Open Institute
//      (SPICE programme), LGPL-2.1, via github.com/interscript/khmer-dict-spice @ pinned commit.
//   2. SBBIC Khmer word list from the same repository.
//   3. Project-curated lists in data/curated/*.tsv (and NCKL terms, when supplied).
//
// Usage: node scripts/build-lexicon.mjs [--source DIR]
//   --source DIR  use a local checkout of khmer-dict-spice instead of downloading.
//
// Every 20th Chuon Nath entry is held out of the corpus statistics and its example text
// written to tests/corpus/chuon-nath-holdout.txt, so the false-positive test uses human-
// written Khmer that the frequency model has not seen.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { wordKey } from '../engine/normalize.js';
import { SRC, POS } from '../engine/lexicon.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COMMIT = '85f37da6d79e9cc8f45a1fe308fc518fa24eddb4';
const RAW = `https://raw.githubusercontent.com/interscript/khmer-dict-spice/${COMMIT}/`;
const CACHE = path.join(ROOT, 'data', 'sources', 'cache');

async function getSource(name, localDir) {
  if (localDir) return fs.readFileSync(path.join(localDir, name), 'utf8');
  const cached = path.join(CACHE, name);
  if (fs.existsSync(cached)) return fs.readFileSync(cached, 'utf8');
  console.log(`Downloading ${name} …`);
  const res = await fetch(RAW + name);
  if (!res.ok) throw new Error(`Download failed for ${name}: HTTP ${res.status}`);
  const text = await res.text();
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(cached, text);
  return text;
}

/** Minimal RFC 4180 CSV parser (handles quoted fields with commas, quotes and newlines). */
function parseCsv(text) {
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function readTsv(name) {
  const file = path.join(ROOT, 'data', 'curated', name);
  return fs.readFileSync(file, 'utf8').split(/\r?\n/)
    .filter(l => l.trim() && !l.startsWith('#'))
    .map(l => l.split('\t').map(s => s.trim()));
}

const KHMER_WORD = /^[\u1780-\u17D3\u17DD]+$/u;
// Single consonant headwords in Chuon Nath are mostly entries for the *letter*. Keep only
// those that are also ordinary words, so that garbage cannot be segmented into letters.
const SINGLE_LETTER_WORDS = new Set(['ក', 'គ', 'ឬ', 'ឮ', 'ឯ', 'ឱ', 'ឲ', 'ឪ', 'ឳ', 'ឥ', 'ឦ', 'ឧ', 'ឩ', 'ឫ', 'ឭ', 'ឰ', 'ស', 'ល', 'ម', 'ព', 'ន', 'ផ']);
// ...but ស/ល/ម/ព/ន/ផ alone are abbreviations in definitions, not words; drop them.
for (const ch of ['ស', 'ល', 'ម', 'ព', 'ន', 'ផ']) SINGLE_LETTER_WORDS.delete(ch);

const POS_TAGS = { 'ន': POS.N, 'កិ': POS.V, 'គុ': POS.ADJ, 'កិ.វិ': POS.ADV, 'គុ.កិ': POS.ADV, 'បុ': POS.PRON, 'សព្វ': POS.PRON, 'និ': POS.PART, 'ឧ': POS.INTJ, 'សំខ្យា': POS.NUM };
const POS_NAMES = { N: POS.N, V: POS.V, ADJ: POS.ADJ, ADV: POS.ADV, PRON: POS.PRON, PART: POS.PART, NUM: POS.NUM, CLF: POS.CLF, PREP: POS.PREP, CONJ: POS.CONJ, INTJ: POS.INTJ };

async function main() {
  const args = process.argv.slice(2);
  const localDir = args.includes('--source') ? args[args.indexOf('--source') + 1] : null;
  const entries = new Map(); // key -> {f, n, p}
  const put = (w, flag, pos = 0) => {
    const key = wordKey(w);
    if (!KHMER_WORD.test(key)) return false;
    if ([...key].length === 1 && !SINGLE_LETTER_WORDS.has(key) && flag !== SRC.FUNC) return false;
    const e = entries.get(key) || { f: 0, n: 0, p: 0 };
    e.f |= flag; e.p |= pos; entries.set(key, e);
    return true;
  };

  // 1. Chuon Nath headwords
  const headCsv = await getSource('kh_dictionary_words.csv', localDir);
  let headCount = 0;
  for (const line of headCsv.split(/\r?\n/)) {
    const w = line.trim().replace(/^"|"$/g, '').replace(/[\s,!?]+$/u, '');
    if (w && put(w, SRC.CN_HEAD)) headCount++;
  }

  // 2. Chuon Nath definitions: part of speech + attested words + frequencies
  const defCsv = await getSource('kh_dictionary.csv', localDir);
  const rows = parseCsv(defCsv);
  const header = rows.shift();
  const iWord = header.indexOf('word'), iDef = header.indexOf('definition'), iId = header.indexOf('_id');
  const freq = new Map(), bigram = new Map(), abbrev = new Map();
  const holdout = [];
  let corpusTokens = 0;
  for (const r of rows) {
    if (r.length <= iDef) continue;
    const head = wordKey(r[iWord].trim().replace(/[\s,!?]+$/u, ''));
    const def = r[iDef].replace(/<"*\d+"*>/g, '').replace(/\/a/g, '').replace(/\\n/g, '\n');
    // part-of-speech tags such as (ន.) (កិ.) (គុ.) at the start of each sense
    let pos = 0;
    for (const m of def.matchAll(/\(([\u1780-\u17FF.\s]{1,12})\)/gu)) {
      for (const tag of m[1].split(/\s+/)) { const t = tag.replace(/\.$/, ''); if (POS_TAGS[t]) pos |= POS_TAGS[t]; }
    }
    if (pos && entries.has(head)) entries.get(head).p |= pos;
    const id = Number(r[iId]);
    if (id % 20 === 0) {
      // examples follow a colon in Chuon Nath definitions
      for (const m of def.matchAll(/:\s*([^:;()\n]{12,200}?)\s*(?:\u17D4|;|\n|$)/gu)) {
        const ex = m[1].replace(/\u200B/g, '').replace(/\s+/g, ' ').trim();
        if (/^[\u1780-\u17FF\s,]+$/u.test(ex) && /[\u1780-\u17FF]{4}/u.test(ex)) holdout.push(ex);
      }
      continue;
    }
    // tokens are already separated by spaces or ZWSP in the digitised definitions
    for (const seg of def.split(/[^\u1780-\u17D3\u17DD\u200B .]+/u)) {
      const toks = seg.split(/[\s\u200B]+/u).filter(Boolean);
      let prev = null;
      for (let t of toks) {
        const isAbbrev = t.endsWith('.');
        t = wordKey(t.replace(/\.+$/, ''));
        if (!KHMER_WORD.test(t)) { prev = null; continue; }
        if (isAbbrev) { abbrev.set(t, (abbrev.get(t) || 0) + 1); prev = null; continue; }
        freq.set(t, (freq.get(t) || 0) + 1); corpusTokens++;
        if (prev) { const k = prev + ' ' + t; bigram.set(k, (bigram.get(k) || 0) + 1); }
        prev = t;
      }
    }
  }
  let attested = 0;
  for (const [w, n] of freq) {
    if (entries.has(w)) entries.get(w).n = n;
    // A token counts as an attested word if it occurs often enough and is not mainly an abbreviation.
    if (n >= 5 && (abbrev.get(w) || 0) < n && [...w].length >= 2) {
      if (!entries.has(w)) { put(w, SRC.CN_ATTESTED); attested++; }
      else entries.get(w).f |= SRC.CN_ATTESTED;
      entries.get(w) && (entries.get(w).n = n);
    }
  }

  // 3. SBBIC list
  const sbbic = await getSource('SBBICkm_KH.txt', localDir);
  let sbCount = 0;
  for (const line of sbbic.split(/\r?\n/)) {
    for (const w of line.replace(/^\uFEFF/, '').split(/[\s,!?]+/u)) if (w && put(w, SRC.SBBIC)) sbCount++;
  }

  // 4. Curated lists
  const curatedCounts = {};
  const addList = (file, flag, posFn = () => 0) => {
    let n = 0;
    for (const row of readTsv(file)) if (put(row[0], flag, posFn(row))) n++;
    curatedCounts[file] = n;
  };
  addList('function-words.tsv', SRC.FUNC, row => (row[1] || '').split(',').reduce((m, t) => m | (POS_NAMES[t.trim()] || 0), 0));
  // the last column of these lists is a part-of-speech tag (N or V)
  const lastPos = row => POS_NAMES[row[row.length - 1]] || 0;
  addList('modern.tsv', SRC.MODERN, lastPos);
  addList('legal.tsv', SRC.LEGAL, lastPos);
  addList('names.tsv', SRC.NAME, lastPos);
  addList('nckl.tsv', SRC.NCKL);

  const curated = {
    misspellings: readTsv('misspellings.tsv').map(([wrong, correct, confidence, explanation]) => ({ wrong, correct, confidence, explanation })),
    register: readTsv('register.tsv').map(([informal, formal, modes, explanation, compound]) => ({ informal, formal: formal.split('|'), modes: modes.split(','), explanation, insideCompounds: compound === 'yes' })),
    style: readTsv('style.tsv').map(([pattern, replacement, category, modes, confidence, explanation]) => ({ pattern, replacement, category, modes: modes.split(','), confidence, explanation })),
    nominalizers: readTsv('nominalizers.tsv').map(([wrong, correct, confidence, explanation]) => ({ wrong, correct, confidence, explanation })),
    nckl: readTsv('nckl.tsv').map(([word, en, fr, domain, ref]) => ({ word, en, fr, domain, ref })),
    // Only rules a named person checked against the page image, with a pattern to match.
    textbook: readTsv('textbook-rules.tsv').filter(r => r[0] !== 'rule_id').map(r => Object.fromEntries(
      ['ruleId', 'pdfPage', 'printedPage', 'section', 'ruleText', 'exampleCorrect', 'exampleIncorrect', 'wrong', 'right', 'category', 'machineCheckable', 'verifiedBy', 'verifiedOn', 'notes'].map((k, i) => [k, r[i] || ''])))
      .filter(r => r.verifiedBy && r.pdfPage && r.wrong && r.machineCheckable === 'yes'),
  };
  // Integrity: every curated correction must be a word the lexicon accepts on authority.
  const authoritative = SRC.CN_HEAD | SRC.MODERN | SRC.LEGAL | SRC.NAME | SRC.FUNC | SRC.NCKL;
  const problems = [];
  for (const m of curated.misspellings) {
    const e = entries.get(wordKey(m.correct));
    if (!e) problems.push(`correction not in lexicon: ${m.correct}`);
    else if (!(e.f & authoritative)) problems.push(`correction only attested in SBBIC/corpus: ${m.correct}`);
  }
  // Nominalizer corrections are phrases: ការ / សេចក្ដី + a word the lexicon knows.
  for (const m of curated.nominalizers) {
    const rest = wordKey(m.correct).replace(/^(\u1780\u17B6\u179A|\u179F\u17C1\u1785\u1780\u17D2\u178A\u17B8)/u, '');
    if (!entries.has(rest)) problems.push(`nominalizer stem not in lexicon: ${rest}`);
  }
  if (problems.length) { console.error(problems.join('\n')); process.exitCode = 1; }
  // Misspellings must not be accepted as words: remove them from the lexicon.
  for (const m of curated.misspellings) entries.delete(wordKey(m.wrong));
  for (const m of curated.nominalizers) entries.delete(wordKey(m.wrong));

  const lines = [];
  for (const [w, e] of [...entries].sort((a, b) => a[0] < b[0] ? -1 : 1)) lines.push(`${w}\t${e.f}\t${e.n}\t${e.p}`);
  const bigramLines = [...bigram].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}\t${n}`);

  const lexicon = {
    meta: {
      builtAt: new Date().toISOString().slice(0, 10),
      sources: {
        chuonNath: { repo: 'https://github.com/interscript/khmer-dict-spice', commit: COMMIT, licence: 'LGPL-2.1', headwords: headCount, attestedWords: attested },
        sbbic: { repo: 'https://github.com/interscript/khmer-dict-spice', file: 'SBBICkm_KH.txt', commit: COMMIT, words: sbCount },
        curated: curatedCounts,
      },
      corpusTokens,
      entries: entries.size,
      bigrams: bigramLines.length,
    },
    entries: lines.join('\n'),
    bigrams: bigramLines.join('\n'),
    curated,
  };
  fs.writeFileSync(path.join(ROOT, 'data', 'lexicon.json'), JSON.stringify(lexicon));
  fs.mkdirSync(path.join(ROOT, 'tests', 'corpus'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'tests', 'corpus', 'chuon-nath-holdout.txt'),
    '# Example phrases from held-out Chuon Nath entries (every 20th _id). Human-written Khmer, 1967.\n' + [...new Set(holdout)].join('\n') + '\n');
  console.log(JSON.stringify(lexicon.meta, null, 2));
  console.log(`hold-out examples: ${new Set(holdout).size}`);
  const size = fs.statSync(path.join(ROOT, 'data', 'lexicon.json')).size;
  console.log(`lexicon.json: ${(size / 1e6).toFixed(2)} MB`);
}

main().catch(e => { console.error(e); process.exit(1); });
