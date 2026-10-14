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

import { validateRephrase } from '../../server/ai-review.mjs';
import { analyze } from '../../engine/node.js';

test('rephrase validation drops misspellings, changed numbers, and (in legal mode) changed meaning markers', () => {
  const passage = 'ភាគីទីមួយត្រូវបង់ប្រាក់ក្នុងរយៈពេល ៣០ ថ្ងៃ។';
  const alts = [
    { text: 'ភាគីទីមួយត្រូវទូទាត់ប្រាក់ក្នុងរយៈពេល ៣០ ថ្ងៃ។', style: 'clearer', explanation_km: 'ok' },
    { text: 'ភាគីទីមួយត្រូវបង់ប្រាក់ក្នុងរយៈពេល ៦០ ថ្ងៃ។', style: 'clearer', explanation_km: 'number changed' },
    { text: 'ភាគីទីមួយអាចបង់ប្រាក់ក្នុងរយៈពេល ៣០ ថ្ងៃ។', style: 'shorter', explanation_km: 'obligation → permission' },
    { text: 'ភាគីទីមួយត្រូវបង់ប្រាក់ខ្ងុំក្នុងរយៈពេល ៣០ ថ្ងៃ។', style: 'more_formal', explanation_km: 'misspelling' },
  ];
  assert.deepEqual(validateRephrase(passage, 'legal', alts, lexicon).map(a => a.text), [alts[0].text]);
  const general = validateRephrase(passage, 'general', alts, lexicon);
  assert.ok(general.some(a => a.text === alts[2].text && a.meaningMarkersChanged), 'general mode keeps it but warns');
});

test('a sentence with several wordy phrases gets one combined rewrite', () => {
  const r = analyze('ក្នុងពេលបច្ចុប្បន្ននេះ តម្លៃប្រេងមានការកើនឡើង ដើម្បីនឹងដោះស្រាយ ក្រុមការងារបានធ្វើការពិភាក្សាជាថ្មីម្ដងទៀត។', lexicon);
  const rw = r.findings.find(f => f.ruleId === 'clarity.rewrite');
  assert.equal(rw.suggestions[0], 'បច្ចុប្បន្ននេះ តម្លៃប្រេងកើនឡើង ដើម្បីដោះស្រាយ ក្រុមការងារបានពិភាក្សាម្ដងទៀត។');
  assert.equal(rw.scope, 'sentence');
});

test('a long sentence gets a concrete place to split it', () => {
  const long = 'ក្រសួងអប់រំ យុវជន និងកីឡា បានរៀបចំកិច្ចប្រជុំពិគ្រោះយោបល់ជាមួយគ្រូបង្រៀន នាយកសាលា និងតំណាងសហគមន៍ នៅខេត្តសៀមរាប និងខេត្តបាត់ដំបង ដើម្បីពិនិត្យលទ្ធផលនៃកម្មវិធីអប់រំឆ្នាំមុន ហើយអ្នកចូលរួមបានលើកឡើងអំពីបញ្ហាខ្វះគ្រូ ខ្វះសម្ភារៈសិក្សា និងការធ្វើដំណើរឆ្ងាយរបស់សិស្សនៅតំបន់ជនបទ ព្រមទាំងបានស្នើឱ្យក្រសួងបង្កើនថវិកាសម្រាប់សាលារៀនតូចៗ។';
  const f = analyze(long, lexicon).findings.find(x => x.ruleId === 'clarity.split-sentence');
  assert.equal(f.original, 'ឆ្នាំមុន ហើយ');
  assert.equal(f.suggestions[0], 'ឆ្នាំមុន។ ');
});
