// Layer 4: spelling.
//
// Three checks, in order of evidence strength:
//   1. curated misspellings (explicit, reviewed corrections);
//   2. unknown tokens: a word the segmenter could not find in any source is compared
//      with dictionary entries by Khmer-aware edit distance. A close match is reported
//      as a spelling error; no close match is reported only as "not in dictionary";
//   3. variant spellings (្ដ/្ត, ឲ/ឱ) under the strict Chuon Nath profile.

import { makeFinding } from './finding.js';
import { wordKey, foldKey } from './normalize.js';
import { SRC, AUTHORITATIVE, SRC_LABEL_KM, units } from './lexicon.js';

// Words that introduce a proper name; the following unknown word is treated as a name.
export const NAME_INTRODUCERS = new Set([
  'លោក', 'លោកស្រី', 'អ្នកស្រី', 'កញ្ញា', 'នាង', 'ឯកឧត្ដម', 'ឯកឧត្តម', 'លោកជំទាវ', 'សម្ដេច', 'ឈ្មោះ', 'នាម', 'ខេត្ត', 'ស្រុក', 'ឃុំ',
  'សង្កាត់', 'ភូមិ', 'ក្រុង', 'វត្ត', 'ផ្លូវ', 'ក្រុមហ៊ុន', 'ទីក្រុង', 'ប្រទេស', 'បណ្ឌិត', 'សាស្ត្រាចារ្យ', 'ព្រះតេជគុណ', 'ឧកញ៉ា', 'អ្នកឧកញ៉ា', 'ប្អូន', 'បង',
  'កូន', 'ព្រះនាម', 'នាមត្រកូល', 'គោត្តនាម', 'ឯកឧត្ដមបណ្ឌិត',
]);
// Letter combinations typical of transliterated foreign words and names.
const FOREIGN_MARKERS = /\u17A0\u17D2[\u1782\u179C\u179F\u17A1\u1787\u17A0\u1794]|[\u1780-\u17A2][\u17C9\u17CA]|\u17A2\u17CA|\u1792\u17D2\u1799|\u179F\u17D2\u1798\u17CA|\u17A0\u17D2\u179C|\u1783\u17D2\u1799/u;

function isWordish(t) { return t && (t.type === 'word' || t.type === 'unknown'); }

/** Find contiguous Khmer tokens around index u (no spaces in between). */
function contiguous(tokens, u, dir, max) {
  const out = [];
  let i = u;
  while (out.length < max) {
    const j = i + dir;
    const t = tokens[j];
    if (!isWordish(t)) break;
    if (dir < 0 ? t.end !== tokens[i].start : t.start !== tokens[i].end) break;
    out.push(j); i = j;
  }
  return out;
}

function prevWord(tokens, i) {
  for (let j = i - 1; j >= 0 && j >= i - 3; j--) {
    if (isWordish(tokens[j])) return tokens[j];
    if (!['space', 'zwsp'].includes(tokens[j].type)) return null;
  }
  return null;
}

function curatedMisspellings(ctx, findings, claimed) {
  const { text, tokens, lexicon } = ctx;
  const list = lexicon.curated.misspellings || [];
  if (!list.length) return;
  // Build normalised key strings for every contiguous Khmer stretch, mapping back to offsets.
  let i = 0;
  while (i < tokens.length) {
    if (!isWordish(tokens[i])) { i++; continue; }
    const group = [i, ...contiguous(tokens, i, 1, 200)];
    const bounds = []; // token-boundary offsets in key space
    let key = '';
    for (const g of group) { bounds.push({ k: key.length, off: tokens[g].start }); key += tokens[g].key; }
    bounds.push({ k: key.length, off: tokens[group[group.length - 1]].end });
    for (const m of list) {
      const wrong = wordKey(m.wrong);
      let at = key.indexOf(wrong);
      while (at !== -1) {
        // the match must begin and end on token boundaries, or inside unknown material
        const sb = bounds.find(b => b.k === at), eb = bounds.find(b => b.k === at + wrong.length);
        const startOff = sb ? sb.off : null, endOff = eb ? eb.off : null;
        if (startOff !== null && endOff !== null) {
          findings.push(makeFinding(text, {
            start: startOff, end: endOff, category: 'spelling', severity: 'error',
            confidence: m.confidence, ruleId: 'spelling.curated', layer: 'spelling',
            title: 'អក្ខរាវិរុទ្ធមិនត្រឹមត្រូវ',
            explanation: m.explanation,
            suggestions: [m.correct], source: 'curated-misspellings',
            sourceDetail: `«${m.wrong}» → «${m.correct}»`, autoFixSafe: true,
          }));
          claimed.push([startOff, endOff]);
        }
        at = key.indexOf(wrong, at + 1);
      }
    }
    i = group[group.length - 1] + 1;
  }
}

function overlapsClaimed(claimed, s, e) { return claimed.some(([a, b]) => s < b && e > a); }

function unknownWords(ctx, findings, claimed) {
  const { text, tokens, lexicon, options } = ctx;
  const cache = ctx.candidateCache || (ctx.candidateCache = new Map());
  // Only the bare unknown token may trigger the slow all-bucket scan.
  const getCands = (key, wide) => {
    const k = key + (wide ? '|w' : '');
    if (!cache.has(k)) cache.set(k, lexicon.candidates(key, { limit: 4, wide }));
    return cache.get(k);
  };
  for (let u = 0; u < tokens.length; u++) {
    const t = tokens[u];
    if (t.type !== 'unknown') continue;
    if (overlapsClaimed(claimed, t.start, t.end)) continue;
    if (options.ignoreWords?.has(t.key)) continue;
    const prev = prevWord(tokens, u);
    const nameContext = prev && NAME_INTRODUCERS.has(prev.key);
    const foreign = FOREIGN_MARKERS.test(t.text);

    // Candidate windows: the unknown token plus up to two contiguous tokens each side.
    const left = contiguous(tokens, u, -1, 2), right = contiguous(tokens, u, 1, 2);
    let best = null;
    const options2 = [];
    for (let a = 0; a <= left.length; a++) {
      for (let b = 0; b <= right.length; b++) {
        const startIdx = a ? left[a - 1] : u, endIdx = b ? right[b - 1] : u;
        const s = tokens[startIdx].start, e = tokens[endIdx].end;
        const windowText = text.slice(s, e);
        const absorbed = [];
        for (let k = startIdx; k <= endIdx; k++) if (k !== u && tokens[k].type === 'word') absorbed.push(tokens[k]);
        // never absorb a word that is a confirmed authoritative multi-cluster word unless it is short
        // Absorbing a one-cluster word costs nothing: a broken word often leaves such a
        // fragment behind (កណាប់ → ក + ណាប់). Absorbing a longer dictionary word costs more.
        const absorbPenalty = absorbed.reduce((p, w) => p + (w.clusters < 2 ? 0 : (lexicon.flags(w.key) & AUTHORITATIVE) ? 0.35 : 0.1), 0);
        for (const c of getCands(wordKey(windowText), a === 0 && b === 0)) {
          const before = tokens[startIdx - 1], after = tokens[endIdx + 1];
          let ctxBonus = 0;
          if (isWordish(before) && lexicon.bigram(before.key, c.word) > 0) ctxBonus += 0.15;
          if (isWordish(after) && lexicon.bigram(c.word, after.key) > 0) ctxBonus += 0.15;
          const score = c.distance + absorbPenalty - 0.04 * Math.log10(1 + c.freq) - ctxBonus - 0.02 * units(c.word).length;
          options2.push({ s, e, cand: c, score, absorbed: absorbed.length });
        }
      }
    }
    options2.sort((x, y) => x.score - y.score);
    best = options2[0];
    const lengthUnits = units(t.key).length;
    if (best && !(nameContext && best.cand.distance > 0.3) && !(foreign && best.cand.distance > 0.6)) {
      // ambiguity: a different correction scores almost as well
      const rival = options2.find(o => o.cand.word !== best.cand.word && o.score - best.score < 0.25);
      let confidence = best.cand.distance <= 0.25 ? 0.9 : best.cand.distance <= 0.6 ? 0.85 : best.cand.distance <= 1 ? 0.7 : best.cand.distance <= 1.5 ? 0.55 : 0.45;
      if (rival) confidence -= 0.15;
      if (lengthUnits <= 2) confidence -= 0.1;
      if (nameContext || foreign) confidence -= 0.2;
      // Reduplicated with ៗ: often an expressive word that dictionaries do not list.
      if (tokens[u + 1]?.type === 'repeat') confidence -= 0.15;
      const variantOnly = foldKey(best.cand.word) === foldKey(text.slice(best.s, best.e));
      const alts = options2.filter(o => o.s === best.s && o.e === best.e).map(o => o.cand.word);
      const srcLabel = SRC_LABEL_KM[best.cand.source] || '';
      const isCN = best.cand.source === SRC.CN_HEAD;
      findings.push(makeFinding(text, {
        start: best.s, end: best.e, category: 'spelling', severity: variantOnly ? 'suggestion' : confidence >= 0.6 ? 'error' : 'warning',
        confidence: variantOnly ? 0.6 : confidence, ruleId: variantOnly ? 'spelling.variant' : 'spelling.dictionary', layer: 'spelling',
        title: variantOnly ? 'ទម្រង់សរសេរខុសពីវចនានុក្រម' : 'ពាក្យនេះប្រហែលសរសេរខុស',
        explanation: variantOnly
          ? `«${text.slice(best.s, best.e)}» ខុសពីទម្រង់ក្នុងវចនានុក្រមត្រឹមតែជើង «ដ/ត» (្ដ ្ត) ឬ «ឲ/ឱ» ប៉ុណ្ណោះ។ វចនានុក្រមកត់ត្រា «${best.cand.word}»។`
          : `«${text.slice(best.s, best.e)}» មិនមានក្នុងវចនានុក្រម ឬបញ្ជីពាក្យដែលបានផ្ទុកទេ។ ពាក្យដែលជិតបំផុតគឺ «${best.cand.word}» (${srcLabel})។` +
          (rival ? ' មានពាក្យផ្សេងទៀតដែលអាចត្រូវ សូមជ្រើសរើសតាមន័យ។' : ''),
        suggestions: alts.slice(0, 4),
        source: isCN ? 'chuon-nath' : best.cand.source === SRC.NCKL ? 'nckl' : 'edit-distance',
        sourceDetail: isCN ? `ពាក្យគោល «${best.cand.word}»` : `«${best.cand.word}» — ${srcLabel}`,
        autoFixSafe: confidence >= 0.8 && !rival,
      }));
      claimed.push([best.s, best.e]);
    } else {
      if (nameContext) continue; // a probable proper name: say nothing
      findings.push(makeFinding(text, {
        start: t.start, end: t.end, category: 'unverified', severity: 'info', confidence: 0.3,
        ruleId: 'spelling.unknown', layer: 'spelling',
        title: 'ពាក្យមិនមានក្នុងវចនានុក្រម',
        explanation: `រកមិនឃើញ «${t.text}» ក្នុងវចនានុក្រម ជួន ណាត ឬបញ្ជីពាក្យផ្សេងទៀតទេ។ វាអាចជាឈ្មោះ ពាក្យថ្មី ពាក្យបរទេស ឬកំហុសអក្ខរាវិរុទ្ធ។ ` +
          'ការមិនមានក្នុងវចនានុក្រម មិនមែនជាភស្តុតាងថាសរសេរខុសទេ។ បើពាក្យត្រឹមត្រូវ អាចបន្ថែមវាទៅសទ្ទានុក្រមផ្ទាល់ខ្លួន។',
        suggestions: [], source: 'chuon-nath', sourceDetail: 'រកមិនឃើញ', autoFixSafe: false,
      }));
    }
  }
}

function variantSpellings(ctx, findings, claimed) {
  const { text, tokens, lexicon, options } = ctx;
  if (options.profile !== 'chuon-nath') return;
  for (const t of tokens) {
    if (t.type !== 'word' || overlapsClaimed(claimed, t.start, t.end)) continue;
    if (lexicon.flags(t.key) & SRC.CN_HEAD) continue;
    const cn = lexicon.variants(t.key).filter(v => lexicon.flags(v) & SRC.CN_HEAD);
    if (!cn.length) continue;
    findings.push(makeFinding(text, {
      start: t.start, end: t.end, category: 'spelling', severity: 'suggestion', confidence: 0.7,
      ruleId: 'spelling.variant', layer: 'spelling',
      title: 'ទម្រង់សរសេរខុសពីវចនានុក្រម ជួន ណាត',
      explanation: `«${t.text}» ជាទម្រង់ដែលគេប្រើ ប៉ុន្តែវចនានុក្រម ជួន ណាត កត់ត្រាទម្រង់ «${cn[0]}»។ ជើង «ដ» និង «ត» (្ដ ្ត) មើលទៅស្រដៀងគ្នា ប៉ុន្តែជាតួអក្សរខុសគ្នា។`,
      suggestions: cn, source: 'chuon-nath', sourceDetail: `ពាក្យគោល «${cn[0]}»`, autoFixSafe: true,
    }));
  }
}

// A misspelled word can split into pieces that each exist in the broad SBBIC list
// (e.g. សមត្តភាព → សមត្ត + ភាព). When a weakly attested piece joins its neighbours into
// a string one small edit away from an authoritative word, report the likely word.
function splitWords(ctx, findings, claimed) {
  const { text, tokens, lexicon } = ctx;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== 'word') continue;
    for (const len of [3, 2]) {
      const idx = [i, ...contiguous(tokens, i, 1, len - 1)];
      if (idx.length !== len) continue;
      const parts = idx.map(k => tokens[k]);
      if (parts.some(p => p.type !== 'word' || p.misspelled)) continue;
      if (!parts.some(p => lexicon.isWeak(p.key))) continue;
      const s = parts[0].start, e = parts[parts.length - 1].end;
      if (overlapsClaimed(claimed, s, e)) continue;
      const joined = wordKey(text.slice(s, e));
      if (lexicon.has(joined)) continue;
      const cands = lexicon.candidates(joined, { authoritativeOnly: true, maxDistance: 1.0, limit: 3 });
      const best = cands[0];
      if (!best || units(best.word).length < 4) continue;
      const confidence = best.distance <= 0.6 ? 0.65 : 0.55;
      findings.push(makeFinding(text, {
        start: s, end: e, category: 'spelling', severity: 'error', confidence, ruleId: 'spelling.split-word', layer: 'spelling',
        title: 'ពាក្យនេះប្រហែលសរសេរខុស',
        explanation: `«${text.slice(s, e)}» មិនមែនជាពាក្យក្នុងវចនានុក្រមទេ ប៉ុន្តែស្រដៀងនឹង «${best.word}» (${SRC_LABEL_KM[best.source]})។`,
        suggestions: cands.map(c => c.word), source: best.source === SRC.CN_HEAD ? 'chuon-nath' : 'edit-distance',
        sourceDetail: `«${best.word}» — ${SRC_LABEL_KM[best.source]}`, autoFixSafe: false,
      }));
      claimed.push([s, e]);
      i = idx[idx.length - 1];
      break;
    }
  }
}

export function checkSpelling(ctx) {
  const findings = [], claimed = [];
  curatedMisspellings(ctx, findings, claimed);
  unknownWords(ctx, findings, claimed);
  splitWords(ctx, findings, claimed);
  variantSpellings(ctx, findings, claimed);
  return findings;
}
