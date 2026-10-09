#!/usr/bin/env node
// Measures KhmerProof against the gold corpus and the held-out Chuon Nath examples.
//
//   node tests/evaluate.mjs            print a summary and write docs/EVALUATION.md
//   node tests/evaluate.mjs --verbose  also list every miss and false alarm
//
// Definitions
//   expected issue   an entry in an item's "expect" list
//   true positive    a finding that overlaps the expected span with an allowed category
//   false negative   an expected issue that no finding matches
//   false positive   a finding with severity error/warning/suggestion that matches no
//                    expected issue ("info" findings, e.g. "word not in dictionary",
//                    are counted separately as notes)
//   correction       the expected suggestion is the first (top-1) or any offered suggestion

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLexicon, analyze } from '../engine/node.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const verbose = process.argv.includes('--verbose');
const lexicon = loadLexicon();

function nthIndex(text, needle, n) { let at = -1; for (let k = 0; k < n; k++) { at = text.indexOf(needle, at + 1); if (at === -1) break; } return at; }

const items = fs.readFileSync(path.join(ROOT, 'tests/corpus/gold.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

const totals = { expected: 0, tp: 0, fn: 0, fp: 0, notes: 0, top1: 0, anySug: 0, withSug: 0 };
const byGroup = {}, byCategory = {}, byRuleFp = {};
let cleanItems = 0, cleanFlagged = 0, words = 0, ms = 0;
const misses = [], falseAlarms = [];

for (const item of items) {
  const r = analyze(item.text, lexicon, { mode: item.mode || 'general' });
  words += r.stats.words; ms += r.stats.ms;
  const g = byGroup[item.group] ||= { items: 0, expected: 0, tp: 0, fp: 0, fn: 0 };
  g.items++;
  const used = new Set();
  for (const exp of item.expect) {
    totals.expected++; g.expected++;
    const cats = exp.category.split('|');
    const c = byCategory[cats[0]] ||= { expected: 0, tp: 0, fp: 0 };
    c.expected++;
    const s = nthIndex(item.text, exp.original, exp.occurrence || 1), e = s + exp.original.length;
    const match = r.findings.find((f, i) => !used.has(i) && f.start < e && f.end > s && cats.includes(f.category));
    if (match) {
      used.add(r.findings.indexOf(match));
      totals.tp++; g.tp++; c.tp++;
      if (exp.suggestion) {
        totals.withSug++;
        if (match.suggestions[0] === exp.suggestion) totals.top1++;
        if (match.suggestions.includes(exp.suggestion)) totals.anySug++;
        else misses.push({ id: item.id, text: item.text, expected: exp, got: `suggestions ${JSON.stringify(match.suggestions)}`, kind: 'wrong-suggestion' });
      }
    } else {
      totals.fn++; g.fn++;
      misses.push({ id: item.id, text: item.text, expected: exp, got: r.findings.map(f => `${f.ruleId}:${f.original}`).join(', ') || 'nothing', kind: 'missed' });
    }
  }
  // Findings that overlap an expected span but were not the matched one are not counted as
  // false positives when they share its category family; everything else is.
  r.findings.forEach((f, i) => {
    if (used.has(i)) return;
    const overlapsExpected = item.expect.some(exp => { const s = nthIndex(item.text, exp.original, exp.occurrence || 1); return f.start < s + exp.original.length && f.end > s; });
    if (overlapsExpected) return;
    if (f.severity === 'info') { totals.notes++; return; }
    totals.fp++; g.fp++;
    (byCategory[f.category] ||= { expected: 0, tp: 0, fp: 0 }).fp++;
    byRuleFp[f.ruleId] = (byRuleFp[f.ruleId] || 0) + 1;
    falseAlarms.push({ id: item.id, text: item.text, rule: f.ruleId, original: f.original, suggestions: f.suggestions });
  });
  if (item.expect.length === 0) {
    cleanItems++;
    if (r.findings.some(f => f.severity !== 'info')) cleanFlagged++;
  }
}

// Held-out human-written text from Chuon Nath examples (not used to build the frequency model).
const holdout = fs.readFileSync(path.join(ROOT, 'tests/corpus/chuon-nath-holdout.txt'), 'utf8').split('\n').filter(l => l && !l.startsWith('#'));
let hoWords = 0, hoFlags = 0, hoNotes = 0, hoLines = 0;
const hoRules = {};
for (const line of holdout) {
  const r = analyze(line, lexicon, { mode: 'general' });
  hoWords += r.stats.words; hoLines++;
  for (const f of r.findings) {
    if (f.ruleId === 'punct.missing-final-khan') continue; // fragments, not paragraphs
    if (f.severity === 'info') hoNotes++;
    else { hoFlags++; hoRules[f.ruleId] = (hoRules[f.ruleId] || 0) + 1; }
  }
}

// Synthetic errors injected into the held-out human-written phrases (seeded, reproducible).
// Error types follow common Khmer typing mistakes. Words whose corrupted form is itself a
// dictionary word are skipped: a dictionary cannot detect real-word errors, and the
// "real-word" type below measures that limit separately with និង/នឹង and ដែល/ដែរ swaps.
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rand = rng(20261009);
const SWAPS = [['ិ', 'ី'], ['ី', 'ិ'], ['ុ', 'ូ'], ['ូ', 'ុ'], ['េ', 'ែ'], ['ែ', 'េ'], ['ោ', 'ៅ'], ['់', '័'], ['ឹ', 'ឺ'], ['ឺ', 'ឹ'], ['ព', 'ភ'], ['ត', 'ថ'], ['ទ', 'ធ'], ['ស', 'ឝ'], ['ន', 'ណ'], ['ល', 'ឡ'], ['ក', 'គ'], ['ច', 'ជ']];
const injectors = {
  'confusable letter': w => { const opts = SWAPS.filter(([a]) => w.includes(a)); if (!opts.length) return null; const [a, b] = opts[Math.floor(rand() * opts.length)]; const i = w.indexOf(a); return w.slice(0, i) + b + w.slice(i + 1); },
  'missing subscript': w => { const m = [...w.matchAll(/\u17D2[\u1780-\u17A2]/gu)]; if (!m.length) return null; const x = m[Math.floor(rand() * m.length)]; return w.slice(0, x.index) + w.slice(x.index + 2); },
  'missing or wrong mark': w => { const m = [...w.matchAll(/[\u17CB\u17D0\u17CD]/gu)]; if (!m.length) return null; const x = m[0]; return w.slice(0, x.index) + w.slice(x.index + 1); },
  'disordered Unicode': w => w.includes('\u17BB\u17C6') ? w.replace('\u17BB\u17C6', '\u17C6\u17BB') : null,
};
const synth = {};
const synthFalse = { lines: 0, extra: 0 };
for (const [type, inject] of Object.entries(injectors)) {
  const st = synth[type] = { trials: 0, detected: 0, corrected: 0 };
  for (const line of holdout) {
    const base = analyze(line, lexicon, { mode: 'general' });
    const baseSpans = new Set(base.findings.map(f => `${f.start}:${f.end}`));
    const tokens = [...line.matchAll(/[\u1780-\u17D3\u17DD]+/gu)];
    const candidates = type === 'disordered Unicode'
      ? tokens.filter(m => m[0].includes('\u17BB\u17C6'))
      : tokens.filter(m => lexicon.isAuthoritative(m[0]) && [...m[0]].length >= 4);
    // up to three trials per phrase, each in a different dictionary word
    for (const m of candidates.sort(() => rand() - 0.5).slice(0, 3)) {
    const word = m[0];
    const bad = inject(word);
    if (!bad || bad === word || (type !== 'disordered Unicode' && lexicon.has(bad))) continue;
    const text = line.slice(0, m.index) + bad + line.slice(m.index + word.length);
    const r = analyze(text, lexicon, { mode: 'general' });
    const s = m.index, e = m.index + bad.length;
    st.trials++;
    const hit = r.findings.find(f => f.start < e && f.end > s && ['spelling', 'unicode', 'unverified'].includes(f.category));
    if (hit && hit.category !== 'unverified') st.detected++;
    // corrected = applying one of the suggestions restores the original phrase exactly
    if (hit && hit.suggestions.some(sg => text.slice(0, hit.start) + sg + text.slice(hit.end) === line)) st.corrected++;
    else if (process.argv.includes('--synthetic-errors')) console.log('  not corrected:', type, word, '→', bad, '|', hit ? `${hit.ruleId} «${hit.original}» ${JSON.stringify(hit.suggestions)}` : 'not detected');
    synthFalse.lines++;
    synthFalse.extra += r.findings.filter(f => !(f.start < e && f.end > s) && f.severity !== 'info' && !baseSpans.has(`${f.start}:${f.end}`)).length;
    }
  }
}
// Real-word errors: swap និង↔នឹង and ដែល↔ដែរ in held-out lines that contain them
{
  const st = synth['real-word swap (និង/នឹង, ដែល/ដែរ)'] = { trials: 0, detected: 0, corrected: 0 };
  const pairs = [['និង', 'នឹង'], ['នឹង', 'និង'], ['ដែល', 'ដែរ'], ['ដែរ', 'ដែល']];
  for (const line of holdout) for (const [a, b] of pairs) {
    const i = line.indexOf(a);
    if (i === -1) continue;
    const text = line.slice(0, i) + b + line.slice(i + a.length);
    const r = analyze(text, lexicon, { mode: 'general' });
    st.trials++;
    const hit = r.findings.find(f => f.start <= i && f.end >= i + b.length && f.category === 'grammar');
    if (hit) { st.detected++; if (hit.suggestions.includes(a)) st.corrected++; }
  }
}

// Throughput on a longer document
const doc = items.filter(i => i.expect.length === 0).map(i => i.text).join(' ').repeat(8);
const t0 = Date.now();
const big = analyze(doc, lexicon, { mode: 'general' });
const docMs = Date.now() - t0;

const pct = (a, b) => b ? (100 * a / b).toFixed(1) + '%' : 'n/a';
const precision = totals.tp / (totals.tp + totals.fp);
const recall = totals.tp / totals.expected;
const result = {
  date: new Date().toISOString().slice(0, 10),
  lexicon: lexicon.meta,
  corpus: { items: items.length, expectedIssues: totals.expected, cleanItems, words },
  totals,
  precision: +precision.toFixed(3), recall: +recall.toFixed(3),
  f1: +(2 * precision * recall / (precision + recall)).toFixed(3),
  cleanSentenceFalseAlarmRate: +(cleanFlagged / cleanItems).toFixed(3),
  suggestionTop1: +(totals.top1 / totals.withSug).toFixed(3),
  suggestionAny: +(totals.anySug / totals.withSug).toFixed(3),
  byGroup, byCategory, falsePositivesByRule: byRuleFp,
  holdout: { lines: hoLines, words: hoWords, flags: hoFlags, flagsPer1000Words: +(1000 * hoFlags / hoWords).toFixed(1), notes: hoNotes, notesPer1000Words: +(1000 * hoNotes / hoWords).toFixed(1), byRule: hoRules },
  synthetic: { byType: synth, newFalseAlarmsPerLine: +(synthFalse.extra / Math.max(1, synthFalse.lines)).toFixed(3) },
  speed: { corpusMs: ms, documentWords: big.stats.words, documentMs: docMs },
  misses, falseAlarms,
};
fs.mkdirSync(path.join(ROOT, 'tests/results'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'tests/results/evaluation.json'), JSON.stringify(result, null, 2));

console.log(`Gold corpus: ${items.length} items, ${totals.expected} expected issues, ${cleanItems} clean items`);
console.log(`  precision ${pct(totals.tp, totals.tp + totals.fp)}  recall ${pct(totals.tp, totals.expected)}  F1 ${result.f1}`);
console.log(`  TP ${totals.tp}  FP ${totals.fp}  FN ${totals.fn}  info notes ${totals.notes}`);
console.log(`  clean items with any non-info finding: ${cleanFlagged}/${cleanItems} (${pct(cleanFlagged, cleanItems)})`);
console.log(`  correction top-1 ${pct(totals.top1, totals.withSug)}  any ${pct(totals.anySug, totals.withSug)}`);
console.log(`Chuon Nath hold-out: ${hoLines} lines, ${hoWords} words → ${hoFlags} flags (${result.holdout.flagsPer1000Words}/1000 words), ${hoNotes} "not in dictionary" notes`);
console.log(`  by rule: ${JSON.stringify(hoRules)}`);
console.log('Synthetic errors in held-out text:');
for (const [k, v] of Object.entries(synth)) console.log(`  ${k.padEnd(36)} trials ${v.trials}  detected ${pct(v.detected, v.trials)}  corrected ${pct(v.corrected, v.trials)}`);
console.log(`  new false alarms per corrupted line: ${result.synthetic.newFalseAlarmsPerLine}`);
console.log(`Speed: ${big.stats.words}-word document in ${docMs} ms`);
for (const [k, v] of Object.entries(byGroup)) console.log(`  ${k.padEnd(20)} items ${v.items}  expected ${v.expected}  TP ${v.tp}  FN ${v.fn}  FP ${v.fp}`);
if (verbose || process.argv.includes('--errors')) {
  console.log('\nMisses:'); for (const m of misses) console.log(' ', m.id, m.kind, JSON.stringify(m.expected), '→', m.got);
  console.log('\nFalse alarms:'); for (const f of falseAlarms) console.log(' ', f.id, f.rule, JSON.stringify(f.original), JSON.stringify(f.suggestions));
}

// Markdown report
const md = [];
md.push('# KhmerProof evaluation results', '');
md.push(`Generated by \`npm run evaluate\` on ${result.date}. Lexicon: ${lexicon.meta.entries.toLocaleString('en')} entries (Chuon Nath commit ${lexicon.meta.sources.chuonNath.commit.slice(0, 7)}).`, '');
md.push('## What these numbers measure', '');
md.push('The gold corpus (`tests/corpus/gold.jsonl`) was written for this project by its developer, not drawn from an independent benchmark, and the rules were tuned while it was being written. Its scores therefore show that the listed behaviours work; they do not estimate accuracy on unseen Khmer writing. A native-speaker review of the corpus and a held-out test set written by someone else are needed before any general accuracy claim.', '');
md.push('The Chuon Nath hold-out set is different: 1 in 20 dictionary entries was excluded from the frequency model, and their example phrases (human-written Khmer from 1967) are checked here. Every flag on them is presumed to be a false alarm, so this figure is an upper bound on false alarms for formal, older-style Khmer.', '');
md.push('## Gold corpus', '');
md.push('| Measure | Value |', '|---|---|');
md.push(`| Items / expected issues / clean items | ${items.length} / ${totals.expected} / ${cleanItems} |`);
md.push(`| Precision | ${pct(totals.tp, totals.tp + totals.fp)} (${totals.tp} of ${totals.tp + totals.fp}) |`);
md.push(`| Recall | ${pct(totals.tp, totals.expected)} (${totals.tp} of ${totals.expected}) |`);
md.push(`| Clean items with at least one false alarm | ${pct(cleanFlagged, cleanItems)} (${cleanFlagged} of ${cleanItems}) |`);
md.push(`| Correct suggestion ranked first | ${pct(totals.top1, totals.withSug)} (${totals.top1} of ${totals.withSug}) |`);
md.push(`| Correct suggestion offered at all | ${pct(totals.anySug, totals.withSug)} |`);
md.push(`| "Not in dictionary" notes (not counted as errors) | ${totals.notes} |`, '');
md.push('| Group | Items | Expected | Found | Missed | False alarms |', '|---|---|---|---|---|---|');
for (const [k, v] of Object.entries(byGroup)) md.push(`| ${k} | ${v.items} | ${v.expected} | ${v.tp} | ${v.fn} | ${v.fp} |`);
md.push('', '## Chuon Nath hold-out (false-alarm test)', '');
md.push(`${hoLines} phrases, ${hoWords} words: **${hoFlags} flags (${result.holdout.flagsPer1000Words} per 1,000 words)** and ${hoNotes} "not in dictionary" notes (${result.holdout.notesPer1000Words} per 1,000 words).`, '');
md.push('Flags by rule: ' + (Object.entries(hoRules).sort((a, b) => b[1] - a[1]).map(([k, v]) => `\`${k}\` ${v}`).join(', ') || 'none') + '.', '');
md.push('## Synthetic errors in held-out text', '');
md.push('One error is injected into a dictionary word of each held-out phrase (seed 20261009). Corruptions that produce another dictionary word are skipped for the first four types, because no dictionary check can see them; the last row measures that limit with real-word swaps.', '');
md.push('| Error type | Trials | Detected | Correct word offered |', '|---|---|---|---|');
for (const [k, v] of Object.entries(synth)) md.push(`| ${k} | ${v.trials} | ${pct(v.detected, v.trials)} | ${pct(v.corrected, v.trials)} |`);
md.push('', `New false alarms elsewhere in a corrupted phrase: ${result.synthetic.newFalseAlarmsPerLine} per phrase.`, '');
md.push('## Remaining misses and false alarms', '');
if (!misses.length && !falseAlarms.length) md.push('None on the gold corpus.');
for (const m of misses) md.push(`- **${m.id}** ${m.kind}: expected ${m.expected.category} at «${m.expected.original}»${m.expected.suggestion ? ` → «${m.expected.suggestion}»` : ''}; got ${m.got}`);
for (const f of falseAlarms) md.push(`- **${f.id}** false alarm \`${f.rule}\` on «${f.original}»`);
md.push('', '## Speed', '', `A ${big.stats.words}-word document is analysed in ${docMs} ms on the build machine (Node.js ${process.version}).`, '');
fs.writeFileSync(path.join(ROOT, 'docs/EVALUATION.md'), md.join('\n'));
