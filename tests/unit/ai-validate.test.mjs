// The optional AI layer is never trusted directly. These tests run offline: they feed
// hand-written "model output" to the validator, without calling any API.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validate, aiEnabled } from '../../server/ai-review.mjs';
import { loadLexicon } from '../../engine/node.js';

const lexicon = loadLexicon();
const text = 'គាត់បានទៅផ្សារដើម្បីទិញបន្លែ ហើយគាត់ក៏បានទិញត្រីដែរ។';

test('AI review is off unless explicitly enabled', () => {
  const saved = process.env.KHMERPROOF_AI;
  delete process.env.KHMERPROOF_AI;
  assert.equal(aiEnabled(), false);
  if (saved !== undefined) process.env.KHMERPROOF_AI = saved;
});

test('findings whose text is not in the document are dropped', () => {
  const out = validate(text, 'general', [{ original: 'មិនមានក្នុងអត្ថបទ', category: 'grammar', suggestion: 'x', explanation_km: 'ពន្យល់', confidence: 0.9 }], lexicon);
  assert.equal(out.length, 0);
});

test('unknown categories are dropped and confidence is capped at 0.6', () => {
  const out = validate(text, 'general', [
    { original: 'ហើយគាត់ក៏', category: 'grammar', suggestion: 'ហើយក៏', explanation_km: 'ពន្យល់', confidence: 0.99 },
    { original: 'ផ្សារ', category: 'invented', suggestion: 'ផ្សា', explanation_km: 'x', confidence: 0.9 },
  ], lexicon);
  assert.equal(out.length, 1);
  assert.equal(out[0].confidence, 0.6);
  assert.equal(out[0].source.id, 'ai');
  assert.equal(out[0].autoFixSafe, false);
});

test('suggestions that introduce spelling errors are removed', () => {
  const out = validate(text, 'general', [{ original: 'បន្លែ', category: 'wording', suggestion: 'បន្លៃខ្ងុំ', explanation_km: 'ពន្យល់', confidence: 0.5 }], lexicon);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].suggestions, []);
});

test('legal mode marks every AI finding for human review', () => {
  const out = validate(text, 'legal', [{ original: 'ហើយគាត់ក៏', category: 'clarity', suggestion: '', explanation_km: 'ពន្យល់', confidence: 0.5 }], lexicon);
  assert.equal(out[0].humanReview, true);
  assert.match(out[0].legalNote, /AI/);
});
