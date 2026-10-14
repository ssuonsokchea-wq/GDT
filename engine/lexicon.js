// Layer 3: dictionary lookup and terminology management.
//
// The lexicon merges several sources, each recorded as a bit flag so that every
// decision can say *which* source accepted or proposed a word. Source precedence for
// spelling suggestions (highest first):
//   NCKL-approved terms (imported) > Chuon Nath headwords > project-curated legal /
//   modern / proper-name lists > words attested in Chuon Nath definitions > SBBIC list.
// A curated misspelling rule always outranks list membership, because the SBBIC list
// contains a few common misspellings (e.g. អោយ, អនុញ្ញាតិ).

import { COENG, isBase } from './chars.js';
import { wordKey, foldKey } from './normalize.js';

export const SRC = Object.freeze({
  CN_HEAD: 1, CN_ATTESTED: 2, SBBIC: 4, MODERN: 8, LEGAL: 16, NAME: 32, NCKL: 64, FUNC: 128, USER: 256,
  MISSPELL: 512, // a curated misspelling: recognised as a unit by the segmenter, never accepted
  COLLOQ: 1024, // a real but colloquial word (curated register list)
});
export const SRC_LABEL_KM = {
  [SRC.CN_HEAD]: 'វចនានុក្រមសម្ដេចព្រះសង្ឃរាជ ជួន ណាត (ពាក្យគោល)',
  [SRC.CN_ATTESTED]: 'ពាក្យដែលមានក្នុងនិយមន័យវចនានុក្រម ជួន ណាត',
  [SRC.SBBIC]: 'បញ្ជីពាក្យ SBBIC (អក្ខរាវិរុទ្ធកុំព្យូទ័រ)',
  [SRC.MODERN]: 'បញ្ជីពាក្យទំនើបដែលគម្រោងរៀបចំ',
  [SRC.LEGAL]: 'បញ្ជីពាក្យច្បាប់ដែលគម្រោងរៀបចំ',
  [SRC.NAME]: 'បញ្ជីនាមករណ៍ (ឈ្មោះខេត្ត ក្រុង ស្ថាប័ន)',
  [SRC.NCKL]: 'ពាក្យបច្ចេកទេសដែលក្រុមប្រឹក្សាជាតិភាសាខ្មែរ អនុម័ត (នាំចូល)',
  [SRC.FUNC]: 'បញ្ជីពាក្យមុខងារវេយ្យាករណ៍ដែលគម្រោងរៀបចំ',
  [SRC.USER]: 'សទ្ទានុក្រមផ្ទាល់ខ្លួនរបស់អ្នកប្រើ',
  [SRC.COLLOQ]: 'ពាក្យភាសានិយាយ (បញ្ជីរបស់គម្រោង)',
};
export const SRC_LABEL_EN = {
  [SRC.CN_HEAD]: 'Chuon Nath Khmer Dictionary (1967), headword',
  [SRC.CN_ATTESTED]: 'Attested in Chuon Nath definitions',
  [SRC.SBBIC]: 'SBBIC Khmer spelling word list',
  [SRC.MODERN]: 'Project-curated modern vocabulary',
  [SRC.LEGAL]: 'Project-curated legal terminology',
  [SRC.NAME]: 'Project-curated proper names',
  [SRC.NCKL]: 'National Council of Khmer Language (imported)',
  [SRC.FUNC]: 'Project-curated function words',
  [SRC.USER]: 'User glossary',
  [SRC.COLLOQ]: 'Colloquial word (project list)',
};
const PRECEDENCE = [SRC.NCKL, SRC.USER, SRC.CN_HEAD, SRC.LEGAL, SRC.MODERN, SRC.NAME, SRC.FUNC, SRC.CN_ATTESTED, SRC.COLLOQ, SRC.SBBIC];
// Sources that make a spelling *authoritative* rather than merely attested.
export const AUTHORITATIVE = SRC.CN_HEAD | SRC.NCKL | SRC.LEGAL | SRC.MODERN | SRC.NAME | SRC.FUNC | SRC.USER | SRC.COLLOQ;

export const POS = Object.freeze({
  N: 1, V: 2, ADJ: 4, ADV: 8, PRON: 16, PART: 32, NUM: 64, CLF: 128, PREP: 256, CONJ: 512, INTJ: 1024,
});

/** Split a word into editing units: a coeng plus its consonant counts as one unit. */
export function units(word) {
  const out = [];
  const chars = [...word];
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] === COENG && chars[i + 1] && isBase(chars[i + 1])) { out.push(COENG + chars[i + 1]); i++; }
    else out.push(chars[i]);
  }
  return out;
}

// Substitution costs for characters Khmer writers commonly confuse.
// Cost 0.2: render identically or are recognised variants; 0.5: same sound or same
// mark position; 0.6: homophone consonants in different series.
const CONFUSION_GROUPS = [
  [0.2, ['្ត', '្ដ']], // ្ត ្ដ
  [0.2, ['ឲ', 'ឱ']],
  [0.5, ['ិ', 'ី']], [0.5, ['ឹ', 'ឺ']], [0.5, ['ុ', 'ូ']], [0.5, ['ួ', 'ូ']],
  [0.5, ['េ', 'ែ']], [0.5, ['ែ', 'ៃ']], [0.5, ['ោ', 'ៅ']], [0.5, ['ៀ', 'ឿ']], [0.5, ['ើ', 'ឿ']],
  [0.5, ['់', '័', '៍', '៏', '៌', '៎']], [0.5, ['៉', '៊']], [0.5, ['ះ', 'ៈ']],
  [0.6, ['ក', 'គ']], [0.6, ['ខ', 'ឃ']], [0.6, ['ច', 'ជ']], [0.6, ['ឆ', 'ឈ']], [0.6, ['ដ', 'ឌ']],
  [0.6, ['ថ', 'ធ', 'ឋ', 'ឍ']], [0.6, ['ណ', 'ន']], [0.6, ['ត', 'ទ']], [0.6, ['ប', 'ព']], [0.6, ['ផ', 'ភ']],
  [0.6, ['ល', 'ឡ']], [0.6, ['ស', 'ឝ', 'ឞ']], [0.6, ['ញ', 'ង']], [0.6, ['អ', 'ឣ']],
];
const SUB_COST = new Map();
for (const [cost, group] of CONFUSION_GROUPS) {
  for (const a of group) for (const b of group) if (a !== b) {
    SUB_COST.set(a + '|' + b, cost);
    // the same confusion applies to the subscript forms of consonants
    if (a.length === 1 && b.length === 1 && isBase(a) && isBase(b)) SUB_COST.set(COENG + a + '|' + COENG + b, cost);
  }
}
const SMALL_MARKS = new Set(['់', '័', '៍', '៏', '៌', '៎', '៉', '៊', 'ំ', 'ះ', '៑']);
function subCost(a, b) {
  if (a === b) return 0;
  const c = SUB_COST.get(a + '|' + b);
  if (c !== undefined) return c;
  // base consonant ↔ its own subscript form
  if (a.length === 2 && a[1] === b) return 0.8;
  if (b.length === 2 && b[1] === a) return 0.8;
  return 1;
}
// A dropped or extra subscript is a frequent typing error, so it costs a little less.
function indelCost(u) { return SMALL_MARKS.has(u) ? 0.7 : u.length === 2 ? 0.8 : 1; }

/** Weighted Damerau–Levenshtein distance over editing units, with early cut-off. */
export function weightedDistance(a, b, max = Infinity) {
  const n = a.length, m = b.length;
  if (Math.abs(n - m) > max + 1) return Infinity;
  let prev2 = new Array(m + 1), prev = new Array(m + 1), cur = new Array(m + 1);
  prev[0] = 0;
  for (let j = 1; j <= m; j++) prev[j] = prev[j - 1] + indelCost(b[j - 1]);
  for (let i = 1; i <= n; i++) {
    const ai = a[i - 1];
    cur[0] = prev[0] + indelCost(ai);
    let rowMin = cur[0];
    for (let j = 1; j <= m; j++) {
      const bj = b[j - 1];
      let v = prev[j - 1] + (ai === bj ? 0 : subCost(ai, bj));
      const del = prev[j] + indelCost(ai), ins = cur[j - 1] + indelCost(bj);
      if (del < v) v = del;
      if (ins < v) v = ins;
      if (i > 1 && j > 1 && ai === b[j - 2] && a[i - 2] === bj && prev2[j - 2] + 0.5 < v) v = prev2[j - 2] + 0.5;
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return Infinity;
    const t = prev2; prev2 = prev; prev = cur; cur = t;
  }
  return prev[m];
}

// Bucket words by the sound class of their first base character so candidate search
// scans a few thousand words instead of 90,000.
const FIRST_CLASS = new Map();
CONFUSION_GROUPS.forEach(([, group], gi) => { for (const ch of group) if (ch.length === 1 && isBase(ch) && !FIRST_CLASS.has(ch)) FIRST_CLASS.set(ch, 'g' + gi); });
// 32-bit signature of the sound/shape classes in a word. Confusable units share a bit,
// so a differing bit always needs an edit costing at least 0.5; a signature difference of
// k bits therefore means a distance of at least ceil(k/2) × 0.5. Used to skip most words.
const UNIT_CLASS = new Map();
CONFUSION_GROUPS.forEach(([, group], gi) => { for (const ch of group) UNIT_CLASS.set(ch, 'g' + gi); });
function unitBit(u) {
  const base = u.length === 2 && u[0] === COENG ? u[1] : u;
  const cls = UNIT_CLASS.get(base) ?? base;
  let h = 0;
  for (let i = 0; i < cls.length; i++) h = (h * 31 + cls.charCodeAt(i)) >>> 0;
  return 1 << (h % 32);
}
export function signature(us) { let m = 0; for (const u of us) m |= unitBit(u); return m >>> 0; }
function popcount(x) { x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); return (((x + (x >>> 4)) & 0x0F0F0F0F) * 0x01010101) >>> 24; }

function bucketOf(firstUnit) { const ch = firstUnit[0] === COENG ? firstUnit[1] : firstUnit[0]; return FIRST_CLASS.get(ch) ?? ch; }

export class Lexicon {
  /** @param {object} data parsed lexicon.json */
  constructor(data) {
    this.meta = data.meta || {};
    this.entries = new Map(); // key -> {f: flags, n: freq, p: pos}
    this.fold = new Map(); // foldKey -> Set(keys)
    this.buckets = new Map();
    this.maxUnits = 0;
    this.bigrams = new Map();
    this.curated = data.curated || {};
    const rows = (data.entries || '').split('\n');
    for (const row of rows) {
      if (!row) continue;
      const [w, f, n, p] = row.split('\t');
      this._put(w, Number(f) || 0, Number(n) || 0, Number(p) || 0);
    }
    for (const row of (data.bigrams || '').split('\n')) {
      if (!row) continue;
      const [pair, n] = row.split('\t');
      this.bigrams.set(pair, Number(n));
    }
    this.totalFreq = Number(this.meta.corpusTokens) || 1;
    this.misspellings = new Map();
    for (const m of this.curated.misspellings || []) {
      const key = wordKey(m.wrong);
      this.misspellings.set(key, m);
      const e = this.entries.get(key);
      if (e) e.f |= SRC.MISSPELL; else this._put(m.wrong, SRC.MISSPELL);
    }
    for (const r of this.curated.register || []) this._put(r.informal, SRC.COLLOQ);
  }

  _put(word, flags, freq = 0, pos = 0) {
    const key = wordKey(word);
    if (!key) return;
    const e = this.entries.get(key);
    if (e) { e.f |= flags; e.n = Math.max(e.n, freq); e.p |= pos; return; }
    this.entries.set(key, { f: flags, n: freq, p: pos });
    const fk = foldKey(key);
    if (!this.fold.has(fk)) this.fold.set(fk, new Set());
    this.fold.get(fk).add(key);
    const u = units(key);
    if (u.length > this.maxUnits) this.maxUnits = u.length;
    const b = bucketOf(u[0]);
    if (!this.buckets.has(b)) this.buckets.set(b, []);
    const byLen = this.buckets.get(b);
    (byLen[u.length] || (byLen[u.length] = [])).push({ key, u, sig: signature(u) });
    this.candidateCache?.clear();
  }

  /** Add words from a glossary at runtime (user list, NCKL import). */
  addWords(words, flag, pos = 0) {
    let added = 0;
    for (const w of words) {
      for (const part of String(w).split(/[\s\u200B]+/u)) {
        if (/^[\u1780-\u17D3\u17DD]+$/u.test(part)) { this._put(part, flag, 0, pos); added++; }
      }
    }
    return added;
  }

  get size() { return this.entries.size; }
  get(word) { return this.entries.get(wordKey(word)); }
  has(word) { return ((this.entries.get(wordKey(word))?.f ?? 0) & ~SRC.MISSPELL) !== 0; }
  /** Attested only in a broad word list, never in Chuon Nath text or a curated list. */
  isWeak(word) { const e = this.get(word); return !!e && !(e.f & AUTHORITATIVE) && e.n < 3; }
  flags(word) { return this.get(word)?.f ?? 0; }
  /**
   * Part of speech. Compounds missing from Chuon Nath inherit the part of speech of their
   * first dictionary component (Khmer compounds are mostly head-first: សាលារៀន → សាលា N).
   */
  pos(word) {
    const e = this.get(word);
    if (!e) return 0;
    if (e.p || e.pi !== undefined) return e.p || e.pi;
    e.pi = 0;
    const key = wordKey(word);
    for (let n = key.length - 1; n >= 2; n--) {
      const head = this.entries.get(key.slice(0, n));
      if (head && head.p && (head.f & AUTHORITATIVE) && this.entries.has(key.slice(n))) { e.pi = head.p; break; }
    }
    return e.pi;
  }
  freq(word) { return this.get(word)?.n ?? 0; }
  isPos(word, posBit) { return (this.pos(word) & posBit) !== 0; }
  isAuthoritative(word) { return (this.flags(word) & AUTHORITATIVE) !== 0; }
  bigram(a, b) { return this.bigrams.get(wordKey(a) + ' ' + wordKey(b)) || 0; }

  /** Best-ranked source of a word, for citations. */
  primarySource(word) {
    const f = this.flags(word);
    for (const s of PRECEDENCE) if (f & s) return s;
    return 0;
  }
  sourceRank(word) {
    const s = this.primarySource(word);
    const i = PRECEDENCE.indexOf(s);
    return i < 0 ? PRECEDENCE.length : i;
  }

  /**
   * Groups of spellings that differ only in ្ដ/្ត or ឲ/ឱ, where at least one form is
   * authoritative. Used to detect a document mixing the two forms of one word.
   */
  variantGroups() {
    if (this._variantGroups) return this._variantGroups;
    const groups = [];
    for (const [, keys] of this.fold) {
      if (keys.size < 2) continue;
      const list = [...keys].filter(k => !(this.entries.get(k).f & SRC.MISSPELL));
      if (list.length >= 2 && list.some(k => this.entries.get(k).f & AUTHORITATIVE) && units(list[0]).length >= 3) groups.push(list);
    }
    return (this._variantGroups = groups);
  }

  /** Other spellings of the same word that differ only in ្ដ/្ត or ឲ/ឱ. */
  variants(word) {
    const key = wordKey(word);
    return [...(this.fold.get(foldKey(key)) || [])].filter(k => k !== key && !(this.entries.get(k).f & SRC.MISSPELL));
  }

  /**
   * Ranked spelling candidates for an unknown string.
   * @returns {{word:string, distance:number, source:number}[]}
   */
  candidates(word, { maxDistance, limit = 5, authoritativeOnly = false, wide = true } = {}) {
    const key = wordKey(word);
    const qu = units(key);
    if (!qu.length) return [];
    const max = maxDistance ?? (qu.length <= 2 ? 0.6 : qu.length <= 4 ? 1.0 : qu.length <= 7 ? 1.5 : 2.0);
    const cacheKey = `${key}|${max}|${limit}|${authoritativeOnly}|${wide}`;
    if (!this.candidateCache) this.candidateCache = new Map();
    if (this.candidateCache.has(cacheKey)) return this.candidateCache.get(cacheKey);
    const out = [];
    const span = Math.ceil(max / 0.7); // the cheapest insertion or deletion costs 0.7
    const qsig = signature(qu);
    const scan = byLen => {
      if (!byLen) return;
      for (let L = Math.max(1, qu.length - span); L <= qu.length + span; L++) {
        for (const { key: cand, u, sig } of byLen[L] || []) {
          if (Math.ceil(popcount((sig ^ qsig) >>> 0) / 2) * 0.5 > max) continue;
          const f = this.entries.get(cand).f;
          if (f & SRC.MISSPELL) continue;
          if (authoritativeOnly && !(f & AUTHORITATIVE)) continue;
          const d = weightedDistance(qu, u, max);
          if (d <= max && d > 0) out.push({ word: cand, distance: Math.round(d * 100) / 100, source: this.primarySource(cand), freq: this.entries.get(cand).n });
        }
      }
    };
    const home = bucketOf(qu[0]);
    scan(this.buckets.get(home));
    // A typo in the first letter: scan the other buckets, only for longer words and when asked.
    if (wide && qu.length >= 4 && out.length === 0) for (const [b, byLen] of this.buckets) if (b !== home) scan(byLen);
    out.sort((a, b) => a.distance - b.distance || this.sourceRank(a.word) - this.sourceRank(b.word) || b.freq - a.freq || b.word.length - a.word.length);
    const result = out.slice(0, limit);
    if (this.candidateCache.size > 5000) this.candidateCache.clear();
    this.candidateCache.set(cacheKey, result);
    return result;
  }
}
