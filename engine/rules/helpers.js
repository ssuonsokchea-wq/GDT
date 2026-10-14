// Shared helpers for rule modules.

import { POS } from '../lexicon.js';
import { wordKey } from '../normalize.js';

export function posOf(ctx, t) { return t ? ctx.lexicon.pos(t.key) : 0; }
export const has = (p, bit) => (p & bit) !== 0;
export function isPron(ctx, t) { return has(posOf(ctx, t), POS.PRON); }
export function isVerbish(ctx, t) { const p = posOf(ctx, t); return has(p, POS.V) || has(p, POS.ADJ); }
export function isVerbOnly(ctx, t) { const p = posOf(ctx, t); return has(p, POS.V) && !has(p, POS.N) && !has(p, POS.PRON); }
export function isNounOnly(ctx, t) { const p = posOf(ctx, t); return has(p, POS.N) && !has(p, POS.V) && !has(p, POS.ADJ) && !has(p, POS.PRON) && !has(p, POS.PREP); }

/** True when no visible space separates two tokens. */
export function touching(ctx, a, b) {
  return !ctx.text.slice(a.end, b.start).replace(/\u200B/gu, '');
}

/**
 * Find a phrase (given as text) in a sentence, aligned to word-token boundaries.
 * Spaces and ZWSP between the words are allowed. Returns [{i, j, start, end}] where
 * i..j are indexes into sentence.words.
 */
export function findPhrase(sentence, phrase) {
  const target = wordKey(phrase);
  const out = [];
  const w = sentence.words;
  for (let i = 0; i < w.length; i++) {
    let acc = '';
    for (let j = i; j < w.length && acc.length < target.length; j++) {
      acc += w[j].key;
      if (acc === target) { out.push({ i, j, start: w[i].start, end: w[j].end }); break; }
      if (!target.startsWith(acc)) break;
    }
  }
  return out;
}

export function sentenceKey(sentence) { return sentence.words.map(w => w.key).join(''); }

export const MODES = ['general', 'academic', 'government', 'administrative', 'legal'];
export const FORMAL_MODES = new Set(['academic', 'government', 'administrative', 'legal']);
