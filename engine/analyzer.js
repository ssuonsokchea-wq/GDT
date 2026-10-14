// KhmerProof analyzer: runs the layers in order and applies the writing-mode policy.
//
//   1 normalisation  → rules/unicode.js
//   2 segmentation   → tokenize.js
//   3 dictionary     → lexicon.js
//   4 spelling       → spelling.js
//   5 grammar        → rules/grammar.js
//   6 punctuation    → rules/punctuation.js
//   7 style/register → rules/style.js
//   8 terminology    → rules/consistency.js
//   9 legal guard    → this file (legal mode never offers a one-click change that
//                      alters negation, obligation, permission, and/or, numbers,
//                      quoted terms or cross-references)

import { tokenize, sentences as toSentences, locator } from './tokenize.js';
import { checkSpelling } from './spelling.js';
import { checkUnicode } from './rules/unicode.js';
import { checkGrammar } from './rules/grammar.js';
import { checkPunctuation } from './rules/punctuation.js';
import { checkStyle } from './rules/style.js';
import { checkConsistency } from './rules/consistency.js';
import { checkMeaning } from './rules/meaning.js';
import { wordKey } from './normalize.js';
import { CATEGORIES, SEVERITIES, makeFinding } from './finding.js';

export const ENGINE_VERSION = '1.3.0';
export const MAX_TEXT_LENGTH = 300000;

export const MODES = {
  general: { km: 'ទូទៅ', en: 'General' },
  academic: { km: 'សិក្សា/ស្រាវជ្រាវ', en: 'Academic' },
  government: { km: 'រដ្ឋាភិបាល', en: 'Government' },
  administrative: { km: 'រដ្ឋបាល', en: 'Administrative' },
  legal: { km: 'ច្បាប់', en: 'Legal' },
};
export const PROFILES = {
  standard: { km: 'ស្តង់ដារទំនើប (ជួន ណាត + ពាក្យទំនើប)', en: 'Modern standard (Chuon Nath + modern terms)' },
  'chuon-nath': { km: 'តាមវចនានុក្រម ជួន ណាត យ៉ាងតឹងរ៉ឹង', en: 'Strict Chuon Nath' },
};

// Words whose change alters legal meaning, grouped into meaning classes.
const MEANING_CLASS = new Map([
  ...['មិន', 'ពុំ', 'គ្មាន', 'កុំ', 'អត់', 'ទេ', 'ហាម', 'ហាមឃាត់', 'មិនអាច', 'មិនត្រូវ'].map(w => [w, 'NEG']),
  ...['ត្រូវ', 'ត្រូវតែ', 'ចាំបាច់', 'កាតព្វកិច្ច'].map(w => [w, 'OBLIGE']),
  ...['អាច', 'សិទ្ធិ', 'អនុញ្ញាត', 'គួរ'].map(w => [w, 'PERMIT']),
  ['និង', 'AND'], ['ព្រមទាំង', 'AND'], ['ឬ', 'OR'], ['ឬក៏', 'OR'], ['នឹង', 'FUTURE'], ['បាន', 'PAST'],
]);
const MEANING_RE = new RegExp([...MEANING_CLASS.keys()].sort((a, b) => b.length - a.length).join('|'), 'gu');

export function meaningSignature(s) {
  const parts = [];
  const k = wordKey(s);
  for (const m of k.matchAll(MEANING_RE)) parts.push(MEANING_CLASS.get(m[0]));
  for (const m of s.matchAll(/[0-9\u17E0-\u17E9]+/gu)) parts.push('#' + m[0].replace(/[\u17E0-\u17E9]/gu, d => String(d.codePointAt(0) - 0x17E0)));
  for (const m of s.matchAll(/\u00AB[^\u00BB]*\u00BB/gu)) parts.push('Q' + m[0]);
  return parts.sort().join(',');
}

/** Legal mode policy: preserve legal meaning. */
function applyLegalGuard(f) {
  const editsWording = ['wording', 'unnecessary', 'structure', 'clarity', 'repetition', 'missing'].includes(f.category);
  const changesMeaning = f.suggestions.some(s => meaningSignature(s) !== meaningSignature(f.original));
  if (changesMeaning || editsWording) {
    f.autoFixSafe = false;
    f.humanReview = true;
    f.legalNote = changesMeaning
      ? 'របៀបច្បាប់៖ ការកែនេះប៉ះពាល់ពាក្យដែលកំណត់ន័យច្បាប់ (ការបដិសេធ កាតព្វកិច្ច សិទ្ធិ «និង/ឬ» លេខ ឬពាក្យកំណត់និយមន័យ)។ សូមឱ្យអ្នកជំនាញច្បាប់ពិនិត្យ មុនទទួលយក។'
      : 'របៀបច្បាប់៖ នេះជាសំណើកែប្រែពាក្យពេចន៍។ KhmerProof មិនកែដោយស្វ័យប្រវត្តិទេ ដើម្បីរក្សាន័យច្បាប់ដើម។';
  }
  return f;
}

// Edits that may be combined into one rewritten sentence: cuts of wordy phrases, sentence
// splits, and corrections that are safe on their own.
const REWRITE_CATEGORIES = new Set(['unnecessary', 'clarity', 'repetition', 'spelling', 'punctuation', 'unicode']);
const REWRITE_TRIGGERS = new Set(['style.phrase', 'clarity.split-sentence']);

/**
 * When a sentence has two or more applicable edits, at least one of which shortens or
 * splits it, offer the whole sentence with every edit applied, so the writer can see
 * and accept the clearer version in one step. Each part is still listed separately.
 */
function sentenceRewrites(text, sentences, findings, opts, lexicon) {
  const out = [];
  for (const s of sentences) {
    const start = s.words[0].start, end = s.tokens[s.tokens.length - 1].end;
    const edits = findings
      .filter(f => f.start >= start && f.end <= end && f.suggestions.length && REWRITE_CATEGORIES.has(f.category))
      .filter(f => (f.category !== 'spelling' && f.category !== 'punctuation') || f.autoFixSafe || f.confidence >= 0.8)
      .sort((a, b) => a.start - b.start);
    const chosen = [];
    for (const f of edits) if (!chosen.length || f.start >= chosen[chosen.length - 1].end) chosen.push(f);
    if (chosen.length < 2 || !chosen.some(f => REWRITE_TRIGGERS.has(f.ruleId))) continue;
    let rewritten = '', pos = start;
    for (const f of chosen) { rewritten += text.slice(pos, f.start) + f.suggestions[0]; pos = f.end; }
    rewritten += text.slice(pos, end);
    // Offer the rewrite only if it reads as cleanly as each edit promised: re-check it, and
    // require that it keeps every meaning marker (negation, obligation, and/or, numbers,
    // quoted terms) of the original. A future marker removed by «ដើម្បីនឹង → ដើម្បី» is the
    // one listed exception, because នឹង adds nothing after ដើម្បី.
    const recheck = analyze(rewritten, lexicon, { ...opts, _recheck: true, showUnverified: false }).findings
      .filter(f => f.severity === 'error' || f.severity === 'warning');
    if (recheck.length) continue;
    const sigOf = t => meaningSignature(t.replace(/ដើម្បីនឹង/gu, 'ដើម្បី'));
    if (sigOf(text.slice(start, end)) !== sigOf(rewritten)) continue;
    const saved = [...text.slice(start, end)].length - [...rewritten].length;
    out.push(makeFinding(text, {
      start, end, category: 'clarity', severity: 'suggestion', confidence: Math.min(0.6, ...chosen.map(f => f.confidence)),
      ruleId: 'clarity.rewrite', layer: 'style', title: 'សំណើសរសេរល្បះឡើងវិញ ឱ្យខ្លី និងច្បាស់',
      explanation: `កែ ${chosen.length} កន្លែងក្នុងល្បះនេះក្នុងពេលតែមួយ${saved > 0 ? ` (ខ្លីជាងមុន ${saved} តួអក្សរ)` : ''} ដោយរក្សាន័យដើម៖ ` +
        chosen.map(f => `«${f.original.trim()}» → «${f.suggestions[0].trim()}»`).join('; ') + '។ ការកែនីមួយៗក៏មាននៅក្នុងបញ្ជីដាច់ដោយឡែកដែរ។',
      suggestions: [rewritten], source: 'project-style', autoFixSafe: false,
    }));
    out[out.length - 1].scope = 'sentence';
    if (opts.mode === 'legal') applyLegalGuard(out[out.length - 1]);
  }
  return out;
}

const LAYER_PRIORITY = { spelling: 0, normalization: 1, grammar: 2, punctuation: 3, style: 4, terminology: 5 };

/**
 * Analyse Khmer text.
 * @param {string} text
 * @param {import('./lexicon.js').Lexicon} lexicon
 * @param {{mode?:string, profile?:string, ignoreWords?:Set<string>, termRules?:Array, disabledRules?:Set<string>, showUnverified?:boolean}} options
 */
export function analyze(text, lexicon, options = {}) {
  const opts = { mode: 'general', profile: 'standard', showUnverified: true, ...options };
  if (!MODES[opts.mode]) throw new Error(`Unknown mode: ${opts.mode}`);
  if (text.length > MAX_TEXT_LENGTH) throw new Error(`Text exceeds ${MAX_TEXT_LENGTH} characters`);
  const t0 = Date.now();
  const tokens = tokenize(text, lexicon);
  const sentences = toSentences(tokens);
  const ctx = { text, tokens, sentences, lexicon, options: opts };

  let findings = [
    ...checkUnicode(ctx),
    ...checkSpelling(ctx),
    ...checkGrammar(ctx),
    ...checkPunctuation(ctx),
    ...checkStyle(ctx),
    ...checkConsistency(ctx),
    ...checkMeaning(ctx),
  ];
  if (opts.disabledRules?.size) findings = findings.filter(f => !opts.disabledRules.has(f.ruleId));
  if (!opts.showUnverified) findings = findings.filter(f => f.category !== 'unverified');
  if (opts.mode === 'legal') findings = findings.map(applyLegalGuard);

  // Remove exact duplicates; when two findings cover the same span, keep the stronger layer.
  const seen = new Map();
  for (const f of findings) {
    const k = `${f.start}:${f.end}`;
    const prev = seen.get(k);
    if (!prev) { seen.set(k, f); continue; }
    if (prev.ruleId === f.ruleId) continue;
    const better = (LAYER_PRIORITY[f.layer] ?? 9) < (LAYER_PRIORITY[prev.layer] ?? 9) || ((LAYER_PRIORITY[f.layer] ?? 9) === (LAYER_PRIORITY[prev.layer] ?? 9) && f.confidence > prev.confidence);
    if (better) { seen.set(k, f); f.alsoFlaggedBy = prev.ruleId; } else prev.alsoFlaggedBy = f.ruleId;
  }
  findings = [...seen.values()];
  if (!opts._recheck) findings.push(...sentenceRewrites(text, sentences, findings, opts, lexicon));
  findings.sort((a, b) => a.start - b.start || SEVERITIES[a.severity].rank - SEVERITIES[b.severity].rank || b.end - a.end);

  const loc = locator(text);
  findings.forEach((f, i) => {
    f.id = `F${String(i + 1).padStart(3, '0')}`;
    f.location = loc(f.start);
    const s = sentences.find(x => x.start <= f.start && x.end >= f.end) || sentences.find(x => x.start <= f.start && x.end > f.start);
    f.context = s ? text.slice(s.start, s.end) : text.slice(Math.max(0, f.start - 40), Math.min(text.length, f.end + 40));
    f.contextOffset = s ? f.start - s.start : f.start - Math.max(0, f.start - 40);
  });

  const words = tokens.filter(t => t.type === 'word' || t.type === 'unknown');
  const byCategory = Object.fromEntries(Object.keys(CATEGORIES).map(c => [c, 0]));
  for (const f of findings) byCategory[f.category]++;
  return {
    findings,
    stats: {
      characters: [...text].length,
      words: words.length,
      unknownWords: tokens.filter(t => t.type === 'unknown').length,
      sentences: sentences.length,
      byCategory,
      ms: Date.now() - t0,
    },
    settings: { mode: opts.mode, profile: opts.profile, engineVersion: ENGINE_VERSION, lexiconEntries: lexicon.size, lexiconBuilt: lexicon.meta.builtAt },
  };
}

/** Apply one suggestion to a text. Returns the new text, or null if the span changed. */
export function applySuggestion(text, finding, suggestion) {
  if (text.slice(finding.start, finding.end) !== finding.original) return null;
  return text.slice(0, finding.start) + suggestion + text.slice(finding.end);
}

/** Word segmentation as a list of strings (used by tests and the API). */
export function segment(text, lexicon) {
  return tokenize(text, lexicon).filter(t => t.type === 'word' || t.type === 'unknown').map(t => t.text);
}
