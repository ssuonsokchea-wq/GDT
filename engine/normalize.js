// Layer 1: Unicode normalisation for Khmer.
//
// Khmer text that looks identical on screen can be stored as different code-point
// sequences (e.g. ំ typed before ុ, or coeng-ro typed before another subscript).
// Such text fails dictionary lookup, search and sorting. This module puts every
// orthographic cluster into the storage order described in The Unicode Standard
// §16.4 and in the widely used "khnormal" algorithm (M. Hosken, SIL):
//   base, robat, subscripts (coeng-ro last), register shifter, vowel, signs.
// The original text is never changed silently: the analyzer reports each change
// as a finding the user may accept or reject.

import {
  COENG, ZWJ, ZWNJ, ZWSP, isBase, isVowel, isShifter, isRobat, isSign,
  isInherentVowel,
} from './chars.js';

const RO = 'រ';

// Two-part vowels that have a single precomposed code point.
const COMPOSE = [
  ['េី', 'ើ'], // េ + ី → ើ
  ['េា', 'ោ'], // េ + ា → ោ
];

// Deprecated characters with recommended replacements (Unicode §16.4, Table 16-9).
export const DEPRECATED = new Map([
  ['ឣ', 'អ'], // ឣ → អ
  ['ឤ', 'អា'], // ឤ → អា
  ['ឨ', 'ឧក'], // ឨ → ឧក
  ['៓', 'ំ'], // bathamasat → nikahit (as recommended)
  ['៘', '។ល។'], // ៘ → ។ល។
]);

/** Split a cluster body (everything after the base) into ordered parts. */
function sortClusterMarks(marks) {
  const robat = [], subs = [], subRo = [], shifters = [], vowels = [], signs = [], other = [];
  for (let i = 0; i < marks.length; i++) {
    const ch = marks[i];
    if (ch === COENG) {
      const next = marks[i + 1];
      if (next && isBase(next)) {
        (next === RO ? subRo : subs).push(COENG + next);
        i++;
      } else other.push(ch); // stray coeng: keep position-independent at the end
    } else if (isRobat(ch)) robat.push(ch);
    else if (isShifter(ch)) shifters.push(ch);
    else if (isVowel(ch)) vowels.push(ch);
    else if (isSign(ch)) signs.push(ch);
    else if (isInherentVowel(ch) || ch === ZWJ || ch === ZWNJ) continue; // invisible: drop
    else other.push(ch);
  }
  // Remove exact duplicates of the same mark (e.g. ាា), which never render differently.
  const dedupe = arr => arr.filter((x, i) => arr.indexOf(x) === i);
  let vowelStr = dedupe(vowels).join('');
  for (const [from, to] of COMPOSE) vowelStr = vowelStr.split(from).join(to);
  return robat.join('') + dedupe(subs).join('') + dedupe(subRo).join('') +
    dedupe(shifters).join('') + vowelStr + dedupe(signs).join('') + other.join('');
}

/** Normalise one orthographic cluster: base + following marks. */
export function normalizeCluster(cluster) {
  if (!cluster) return cluster;
  let out = '';
  for (const ch of cluster) out += DEPRECATED.get(ch) ?? ch;
  if (!isBase(out[0])) return sortClusterMarks(out); // orphan marks: order only
  return out[0] + sortClusterMarks(out.slice(1));
}

// A Khmer orthographic cluster in storage order (lenient: also matches disordered input).
export const CLUSTER_RE = /[\u1780-\u17B3](?:\u17D2[\u1780-\u17B3]|[\u17B4-\u17D1\u17D3\u17DD\u200C\u200D]|\u17D2(?![\u1780-\u17B3]))*|[\u17B4-\u17D3\u17DD]+/gu;

/** Normalise a whole string cluster-by-cluster. Non-Khmer text is unchanged. */
export function normalizeText(text) {
  let s = text;
  for (const [from, to] of DEPRECATED) if (from === '៘') s = s.split(from).join(to);
  return s.replace(CLUSTER_RE, normalizeCluster);
}

/** Lookup key for a single word: normalised, without zero-width characters. */
export function wordKey(word) {
  return normalizeText(word.replace(/[\u200B\u200C\u200D\u2060\uFEFF]/gu, ''));
}

/**
 * Variant-folding key. It merges spellings that render alike or that Khmer writers
 * treat as variants, so that the engine can say "variant of X" instead of "wrong":
 *   subscript ដ / ត (្ដ ្ត), ឲ / ឱ.
 */
export function foldKey(word) {
  return wordKey(word).replace(/\u17D2\u178A/gu, '្ត').replace(/\u17B2/gu, 'ឱ');
}

/** Explain in Khmer what normalisation would change in a cluster. */
export function describeNormalization(original) {
  const reasons = [];
  if ([...original].some(ch => DEPRECATED.has(ch))) reasons.push('មានតួអក្សរយូនីកូដដែលលែងប្រើ (deprecated)');
  if (/[\u17B4\u17B5]/u.test(original)) reasons.push('មានស្រៈពេញមើលមិនឃើញ U+17B4/U+17B5');
  if (/[\u200C\u200D]/u.test(original)) reasons.push('មានតួអក្សរ zero-width នៅកណ្ដាលព្យាង្គ');
  if (/\u17C1[\u17B6\u17B8]/u.test(original)) reasons.push('ស្រៈត្រូវបានវាយជាពីរផ្នែក ជំនួសឱ្យតួអក្សរតែមួយ');
  if (/([\u17B6-\u17D1])\1/u.test(original)) reasons.push('សញ្ញា ឬស្រៈដដែលត្រូវបានវាយជាន់គ្នា');
  if (reasons.length === 0) reasons.push('លំដាប់តួអក្សរក្នុងព្យាង្គមិនត្រូវតាមស្តង់ដារយូនីកូដ (ឧ. ំ មុន ុ ឬ ្រ មុនជើងផ្សេង)');
  return reasons;
}

export { ZWSP };
