// Khmer character classes used by every layer of the engine.
// Code points follow The Unicode Standard, chapter 16.4 (Khmer, U+1780–U+17FF).

export const COENG = '្';
export const ZWSP = '​';
export const ZWNJ = '‌';
export const ZWJ = '‍';
export const KHAN = '។'; // ។
export const BARIYOOSAN = '៕'; // ៕
export const LEK_TOO = 'ៗ'; // ៗ
export const CAMNUC_PII_KUUH = '៖'; // ៖

export function cp(ch) { return ch.codePointAt(0); }

/** Consonants U+1780–U+17A2 */
export function isConsonant(ch) { const c = cp(ch); return c >= 0x1780 && c <= 0x17A2; }
/** Independent vowels U+17A3–U+17B3 (U+17A3, U+17A4 and U+17A8 are deprecated) */
export function isIndependentVowel(ch) { const c = cp(ch); return c >= 0x17A3 && c <= 0x17B3; }
export function isBase(ch) { const c = cp(ch); return c >= 0x1780 && c <= 0x17B3; }
/** Dependent vowels U+17B6–U+17C5 */
export function isVowel(ch) { const c = cp(ch); return c >= 0x17B6 && c <= 0x17C5; }
/** Register shifters: muusikatoan U+17C9, triisap U+17CA */
export function isShifter(ch) { const c = cp(ch); return c === 0x17C9 || c === 0x17CA; }
export function isRobat(ch) { return ch === '៌'; }
/** Signs written after the vowel: nikahit, reahmuk, yuukaleapintu, bantoc, toandakhiat, kakabat, ahsda, samyok sannya, viriam, bathamasat, atthacan */
export function isSign(ch) {
  const c = cp(ch);
  return c === 0x17C6 || c === 0x17C7 || c === 0x17C8 || c === 0x17CB ||
    (c >= 0x17CD && c <= 0x17D1) || c === 0x17D3 || c === 0x17DD;
}
/** Inherent vowels U+17B4/U+17B5: invisible, Unicode advises against using them. */
export function isInherentVowel(ch) { const c = cp(ch); return c === 0x17B4 || c === 0x17B5; }
export function isCombining(ch) {
  const c = cp(ch);
  return (c >= 0x17B4 && c <= 0x17D3) || c === 0x17DD;
}
export function isKhmerLetterOrMark(ch) { const c = cp(ch); return (c >= 0x1780 && c <= 0x17D3) || c === 0x17DD; }
export function isKhmerDigit(ch) { const c = cp(ch); return c >= 0x17E0 && c <= 0x17E9; }
export function isKhmerPunct(ch) { const c = cp(ch); return c >= 0x17D4 && c <= 0x17DA && c !== 0x17D7; }
export function isKhmer(ch) { const c = cp(ch); return (c >= 0x1780 && c <= 0x17FF) || (c >= 0x19E0 && c <= 0x19FF); }
export function hasKhmer(s) { return /[\u1780-\u17FF]/u.test(s); }

export const KHMER_DIGITS = '០១២៣៤៥៦៧៨៩';
export function toKhmerDigits(s) { return String(s).replace(/[0-9]/g, d => KHMER_DIGITS[Number(d)]); }
