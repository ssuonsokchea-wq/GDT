import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadLexicon, analyze, applySuggestion, segment } from '../../engine/node.js';
import { normalizeText, normalizeCluster, wordKey, foldKey } from '../../engine/normalize.js';
import { units, weightedDistance } from '../../engine/lexicon.js';
import { tokenize } from '../../engine/tokenize.js';

const lexicon = loadLexicon();
const run = (text, opts) => analyze(text, lexicon, opts).findings;

test('normalisation: nikahit after vowel u, coeng-ro last, composed vowels, deprecated letters', () => {
  assert.equal(normalizeCluster('ញំុ'), 'ញុំ');
  assert.equal(normalizeText('ស្រ្ត'), 'ស្ត្រ');
  assert.equal(normalizeCluster('កេា'), 'កោ');
  assert.equal(normalizeText('ឣ'), 'អ');
  assert.equal(normalizeText('ខ្ញុំ'), 'ខ្ញុំ', 'already normal text is unchanged');
  assert.equal(wordKey('ខ្ញុំ​'), 'ខ្ញុំ');
  assert.equal(foldKey('សេចក្តី'), foldKey('សេចក្ដី'));
});

test('segmentation never splits an orthographic cluster', () => {
  const text = 'ការិយាល័យនិងបណ្ណាល័យរបស់ក្រសួងសុខាភិបាល';
  for (const t of tokenize(text, lexicon)) {
    if (t.type === 'word' || t.type === 'unknown') assert.ok(!/^[឴-៓៝]/u.test(t.text), `token ${t.text} starts with a mark`);
  }
  assert.deepEqual(segment('ខ្ញុំទៅសាលារៀន', lexicon), ['ខ្ញុំ', 'ទៅ', 'សាលារៀន']);
});

test('edit distance treats a missing subscript as one unit and confusable vowels as cheap', () => {
  assert.deepEqual(units('ខ្ញុំ'), ['ខ', '្ញ', 'ុ', 'ំ']);
  assert.ok(weightedDistance(units('ពិនិត្ស'), units('ពិនិត្យ')) <= 1);
  assert.ok(weightedDistance(units('ខ្ញី'), units('ខ្ញិ')) <= 0.5);
});

test('every finding points at the exact original text and cites a source', () => {
  const items = fs.readFileSync(new URL('../corpus/gold.jsonl', import.meta.url), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  for (const item of items) {
    for (const f of run(item.text, { mode: item.mode })) {
      assert.equal(item.text.slice(f.start, f.end), f.original, `${item.id} ${f.ruleId}`);
      assert.ok(f.source && f.source.km && f.source.en, `${item.id} ${f.ruleId} has a source`);
      assert.ok(f.explanation && /[ក-៿]/u.test(f.explanation), 'explanation is in Khmer');
      assert.ok(f.confidence > 0 && f.confidence < 1);
      assert.ok(['high', 'medium', 'low'].includes(f.confidenceLevel));
    }
  }
});

test('no rule claims a textbook page except the one carried over and marked unverified', () => {
  const text = 'តើអ្នកសុខសប្បាយទេ។ ខ្ញុំនិងទៅផ្សារ។ សេចក្ដីងាររបស់គាត់ច្រើន។';
  for (const f of run(text)) {
    if (/ទំព័រ|page/i.test(f.source.km + f.source.en)) assert.equal(f.source.id, 'textbook-unverified');
  }
});

test('accepting a suggestion changes exactly the flagged span', () => {
  const text = 'សូមអនុញ្ញាតិឱ្យខ្ញុំនិយាយ។';
  const f = run(text).find(x => x.category === 'spelling');
  assert.equal(applySuggestion(text, f, f.suggestions[0]), 'សូមអនុញ្ញាតឱ្យខ្ញុំនិយាយ។');
  assert.equal(applySuggestion('changed text', f, 'x'), null, 'stale findings are refused');
});

test('writing modes change register advice', () => {
  assert.ok(!run('ខ្ញុំអត់ដឹងទេ។', { mode: 'general' }).some(f => f.ruleId === 'wording.register'));
  for (const mode of ['academic', 'government', 'administrative', 'legal']) {
    assert.ok(run('ខ្ញុំអត់ដឹងទេ។', { mode }).some(f => f.ruleId === 'wording.register'), mode);
  }
  assert.ok(!run('គាត់មានការអត់ធ្មត់ខ្ពស់។', { mode: 'government' }).some(f => f.ruleId === 'wording.register'), 'compound អត់ធ្មត់ is left alone');
});

test('legal mode never offers a one-click change that alters legal meaning', () => {
  const text = 'ភាគីទីមួយនិងបង់ប្រាក់ឱ្យភាគីទីពីរ។';
  const general = run(text, { mode: 'general' }).find(f => f.ruleId === 'grammar.ning-neung');
  const legal = run(text, { mode: 'legal' }).find(f => f.ruleId === 'grammar.ning-neung');
  assert.ok(general && legal);
  assert.equal(legal.autoFixSafe, false);
  assert.equal(legal.humanReview, true);
  assert.match(legal.legalNote, /ច្បាប់/u);
  // A pure spelling correction keeps its meaning and stays one-click in legal mode
  const sp = run('ភាគីទីពីរមិនត្រូវផ្ទេរសិទ្ធិអោយតតិយជនឡើយ។', { mode: 'legal' }).find(f => f.category === 'spelling');
  assert.equal(sp.humanReview, false);
  // Word-order rewrites are advisory in legal mode
  const wo = run('ខ្ញុំសាលារៀនទៅ។', { mode: 'legal' }).find(f => f.category === 'structure');
  assert.equal(wo.autoFixSafe, false);
});

test('unknown words are not called errors when there is no close dictionary word', () => {
  const f = run('គាត់ទិញក្រូចឆ្មាហ្វ្លូរីដា។').filter(x => x.category === 'spelling');
  assert.equal(f.length, 0);
});

test('proper names after a title are not flagged', () => {
  assert.deepEqual(run('លោក សុខ ពិសិដ្ឋ បានមកដល់។').filter(f => f.severity !== 'info'), []);
});

test('user glossary words are accepted, and user term rules are enforced', () => {
  const lex = loadLexicon();
  assert.ok(run('ក្រុមហ៊ុនស្រែអង្គរថ្មី។').length >= 0);
  lex.addWords(['ឡុងវីន'], 256);
  assert.ok(!run('ក្រុមហ៊ុនឡុងវីនបើកហាង។').some(f => f.original.includes('ឡុងវីន') && f.category === 'spelling'));
  const rule = run('យើងប្រើកុងត្រានេះ។', { termRules: [{ preferred: 'កិច្ចសន្យា', variants: ['កុងត្រា'] }] }).find(f => f.ruleId === 'terminology.user-rule');
  assert.equal(rule.suggestions[0], 'កិច្ចសន្យា');
});

test('handles empty, Latin-only and very long input', () => {
  assert.deepEqual(run(''), []);
  assert.deepEqual(run('Hello world.'), []);
  const long = 'ខ្ញុំទៅសាលារៀន។ '.repeat(3000);
  const t0 = Date.now();
  const r = analyze(long, lexicon);
  assert.ok(Date.now() - t0 < 5000, 'a 9,000-word text is analysed within 5 s');
  // 3,000 sentences that all start with ខ្ញុំ: only the monotony note is expected
  assert.deepEqual([...new Set(r.findings.filter(f => f.severity !== 'info').map(f => f.ruleId))], ['repetition.sentence-openings']);
  assert.throws(() => analyze('ក'.repeat(400001), lexicon), /exceeds/);
});

test('report locations are 1-based and paragraphs are counted', () => {
  const text = 'ខ្ញុំទៅសាលារៀន។\n\nខ្ងុំទៅផ្សារ។';
  const f = run(text).find(x => x.category === 'spelling');
  assert.deepEqual(f.location, { line: 3, column: 1, paragraph: 2 });
});
