// Regression test for the failure of the previous prototype (legacy/prototype-v0).
//
// Root cause, reproduced below:
//   1. Spelling detection was seven hard-coded string pairs; nothing else could raise a
//      spelling error, so «ខ្ងុំ» (wrong subscript in ខ្ញុំ, "I") passed silently.
//   2. The dictionary check was off by default, needed a 1,000-word list the app did not
//      ship, and segmented text by code point, splitting orthographic clusters
//      (it flagged «ិយាល៏យ», a string that begins with a dependent vowel).
//   3. A zero-width space inside a word defeated even the hard-coded pairs.
//   4. The prototype's tests asserted only those seven pairs, so they could not fail.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { loadLexicon, analyze } from '../../engine/node.js';

const require = createRequire(import.meta.url);
const legacy = require('../../legacy/prototype-v0/checker.js');
const lexicon = loadLexicon();

const spellingFindings = (text, opts) => analyze(text, lexicon, opts).findings.filter(f => f.category === 'spelling');

test('prototype failure is reproduced: «ខ្ងុំ» is not detected by the old engine', () => {
  assert.equal(legacy.analyze('ខ្ងុំទៅសាលារៀន។', {}).length, 0);
});

test('new engine detects «ខ្ងុំ» and proposes «ខ្ញុំ» at the exact span', () => {
  const text = 'ខ្ងុំទៅសាលារៀន។';
  const [f] = spellingFindings(text);
  assert.ok(f, 'a spelling finding is reported');
  assert.equal(text.slice(f.start, f.end), 'ខ្ងុំ');
  assert.equal(f.suggestions[0], 'ខ្ញុំ');
  assert.equal(f.confidenceLevel, 'high');
});

test('misspellings outside any curated list are found through the dictionary', () => {
  // Not one of the prototype's seven pairs, nor in data/curated/misspellings.tsv
  for (const [text, wrong, right] of [
    ['ពួកយើងបានពិនិត្សឯកសារ។', 'ពិនិត្ស', 'ពិនិត្យ'],
    ['ខ្ញុំចង់ទិញកំព្យូទ័រ។', 'កំព្យូទ័រ', 'កុំព្យូទ័រ'],
    ['សមត្តភាពរបស់គាត់ល្អ។', 'សមត្តភាព', 'សមត្ថភាព'],
  ]) {
    assert.equal(legacy.analyze(text, {}).length, 0, `prototype misses ${wrong}`);
    const f = spellingFindings(text).find(x => x.original === wrong);
    assert.ok(f, `new engine flags ${wrong}`);
    assert.ok(f.suggestions.includes(right), `suggests ${right}`);
  }
});

test('the old cluster-splitting bug is gone: the whole word is flagged, never a fragment', () => {
  const dict = new Set([...legacy.STARTER_WORDS]);
  for (let i = 0; i < 1100; i++) dict.add('ពាក្យ' + i);
  const old = legacy.analyze('ការិយាល៏យ', { dictionary: dict, includeUnknown: true });
  assert.ok(old.some(f => /^[ា-ៅ]/u.test(f.original)), 'prototype flagged a span starting with a dependent vowel');
  const [f] = spellingFindings('ការិយាល៏យ');
  assert.equal(f.original, 'ការិយាល៏យ');
  assert.equal(f.suggestions[0], 'ការិយាល័យ');
});

test('a zero-width space inside a word does not hide the error', () => {
  const text = 'ខ្ញុំចង់អានពត​៌មាន។';
  assert.equal(legacy.analyze(text, {}).filter(f => f.category === 'spelling').length, 0);
  const f = analyze(text, lexicon).findings.find(x => x.category === 'spelling' || x.category === 'unicode');
  assert.ok(f, 'the broken word is reported');
});

test('correct text produces no error-level findings', () => {
  for (const text of ['ខ្ញុំទៅសាលារៀន។', 'ខ្ញុំចង់អានព័ត៌មានអំពីប្រទេសកម្ពុជា។', 'ការិយាល័យនេះបើកនៅថ្ងៃច័ន្ទ។']) {
    const r = analyze(text, lexicon);
    assert.deepEqual(r.findings.filter(f => f.severity !== 'info').map(f => f.ruleId), [], text);
  }
});
