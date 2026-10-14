// Layer 2: orthographic clusters, word segmentation, sentences and paragraphs.
//
// Khmer is written without spaces between words. The segmenter never splits an
// orthographic cluster (a base letter with its subscripts, vowels and signs): it joins
// clusters into words with a dynamic-programming search that minimises a cost, where
// a dictionary word costs about 1 and an unknown cluster costs 2. Consecutive unknown
// clusters become one "unknown" token, which the spelling layer then examines.

import { CLUSTER_RE, normalizeCluster } from './normalize.js';
import { AUTHORITATIVE, SRC } from './lexicon.js';

const MAX_WORD_CLUSTERS = 16;

/**
 * @typedef {{type:string,start:number,end:number,text:string,key?:string,known?:boolean}} Token
 * types: word | unknown | space | zwsp | newline | punct | repeat | number | latin | other | orphan
 */

/** Split a text into coarse chunks: Khmer runs and everything else. */
function* chunks(text) {
  const re = /((?:[\u1780-\u17B3](?:\u17D2[\u1780-\u17B3]|[\u17B4-\u17D1\u17D3\u17DD\u200C\u200D]|\u17D2(?![\u1780-\u17B3]))*)+)|([\u17B4-\u17D3\u17DD]+)|(\u17D7)|(\u200B+)|(\r?\n)|([ \t\u00A0\u3000]+)|([\u17E0-\u17E9]+(?:[.,:/-][\u17E0-\u17E9]+)*|[0-9]+(?:[.,:/-][0-9]+)*)|([\u17D4-\u17DA\u17DC.,;:!?'"\u00AB\u00BB\u201C\u201D\u2018\u2019()\[\]{}<>\-\u2013\u2014/\\\u2026%]|\u17D8)|([A-Za-z\u00C0-\u024F]+)|([\s\S])/gu;
  let m;
  while ((m = re.exec(text))) {
    const [all, khmer, orphan, repeat, zwsp, nl, space, number, punct, latin] = m;
    const type = khmer ? 'khmer' : orphan ? 'orphan' : repeat ? 'repeat' : zwsp ? 'zwsp' : nl ? 'newline'
      : space ? 'space' : number ? 'number' : punct ? 'punct' : latin ? 'latin' : 'other';
    yield { type, start: m.index, end: m.index + all.length, text: all };
  }
}

/** Segment one Khmer run into word / unknown tokens. */
export function segmentRun(run, offset, lexicon) {
  const clusters = [];
  for (const m of run.matchAll(CLUSTER_RE)) clusters.push({ s: m.index, e: m.index + m[0].length, k: normalizeCluster(m[0]) });
  const n = clusters.length;
  const best = new Array(n + 1).fill(Infinity), back = new Array(n + 1).fill(-1), kind = new Array(n + 1).fill(null);
  best[0] = 0;
  for (let i = 0; i < n; i++) {
    if (best[i] === Infinity) continue;
    let key = '';
    for (let j = i; j < Math.min(n, i + MAX_WORD_CLUSTERS); j++) {
      key += clusters[j].k;
      const e = lexicon.entries.get(key);
      if (e) {
        let cost, k = 'word';
        if (e.f === SRC.MISSPELL) { cost = 0.9; k = 'misspelled'; }
        // weak: only in the SBBIC list, never in Chuon Nath text or a curated list
        else if (!(e.f & AUTHORITATIVE) && e.n < 3) cost = 1.5;
        else cost = 1 + ((e.f & AUTHORITATIVE) ? 0 : 0.1) - Math.min(0.3, 0.03 * Math.log(1 + e.n));
        cost += best[i];
        if (cost < best[j + 1]) { best[j + 1] = cost; back[j + 1] = i; kind[j + 1] = k; }
      }
    }
    const unk = best[i] + 2;
    if (unk < best[i + 1]) { best[i + 1] = unk; back[i + 1] = i; kind[i + 1] = 'unknown'; }
  }
  const pieces = [];
  for (let j = n; j > 0; j = back[j]) pieces.push({ i: back[j], j, kind: kind[j] });
  pieces.reverse();
  const tokens = [];
  for (const p of pieces) {
    const start = offset + clusters[p.i].s, end = offset + clusters[p.j - 1].e;
    const last = tokens[tokens.length - 1];
    if (p.kind === 'unknown' && last && last.type === 'unknown' && last.end === start) {
      last.end = end; last.clusters += p.j - p.i;
      continue;
    }
    tokens.push({ type: p.kind, start, end, clusters: p.j - p.i });
  }
  return tokens;
}

/** Tokenise text into a flat list with original UTF-16 offsets. */
export function tokenize(text, lexicon) {
  const tokens = [];
  for (const c of chunks(text)) {
    if (c.type === 'khmer') {
      for (const t of segmentRun(c.text, c.start, lexicon)) {
        t.text = text.slice(t.start, t.end);
        t.key = clusterKey(t.text);
        t.known = t.type === 'word';
        if (t.type === 'misspelled') { t.type = 'word'; t.misspelled = true; t.known = false; }
        tokens.push(t);
      }
    } else tokens.push(c);
  }
  tokens.forEach((t, i) => { t.index = i; });
  return tokens;
}

function clusterKey(s) {
  return s.replace(CLUSTER_RE, normalizeCluster).replace(/[\u200B-\u200D]/gu, '');
}

const SENTENCE_END = new Set(['។', '៕', '?', '!', '៖']);

/**
 * Group tokens into sentences. A sentence ends at ។ ៕ ? ! or a line break.
 * (៖ introduces a list and is treated as a soft boundary.)
 */
export function sentences(tokens) {
  const out = [];
  let cur = [];
  const flush = (terminator) => {
    const words = cur.filter(t => t.type === 'word' || t.type === 'unknown');
    if (words.length) out.push({ tokens: cur, words, start: cur[0].start, end: cur[cur.length - 1].end, terminator });
    cur = [];
  };
  for (const t of tokens) {
    if (t.type === 'newline') { flush(null); continue; }
    cur.push(t);
    if (t.type === 'punct' && SENTENCE_END.has(t.text)) flush(t.text);
  }
  flush(null);
  return out;
}

/** Paragraph index and line/column for an offset, for report locations. */
export function locator(text) {
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1);
  const paraOf = [];
  let para = 0, prevBlank = true;
  for (let l = 0; l < lineStarts.length; l++) {
    const line = text.slice(lineStarts[l], l + 1 < lineStarts.length ? lineStarts[l + 1] - 1 : text.length);
    const blank = !line.trim();
    if (!blank && prevBlank) para++;
    paraOf.push(blank ? null : para);
    prevBlank = blank;
  }
  return offset => {
    let lo = 0, hi = lineStarts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= offset) lo = mid; else hi = mid - 1; }
    return { line: lo + 1, column: offset - lineStarts[lo] + 1, paragraph: paraOf[lo] ?? para };
  };
}
