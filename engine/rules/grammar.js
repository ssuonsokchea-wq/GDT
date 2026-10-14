// Grammar and sentence-structure rules.
//
// Each rule is narrow on purpose: it fires only when part-of-speech evidence from the
// Chuon Nath dictionary (and the curated function-word list) makes the error likely.
// None of these rules has yet been checked against the user's grammar textbook, which
// was not supplied; their source is cited as a KhmerProof rule.

import { makeFinding } from '../finding.js';
import { POS } from '../lexicon.js';
import { isPron, isVerbOnly, isNounOnly, isVerbish, posOf, has, touching, findPhrase, sentenceKey, FORMAL_MODES } from './helpers.js';

// Verbs and adjectives that take នឹង as a preposition ("with", "to").
const TAKES_NEUNG = new Set(['ទាក់ទង', 'ស្មើ', 'ជាប់', 'ដូច', 'ដូចគ្នា', 'ប្រឆាំង', 'យល់ស្រប', 'ស្រប', 'ទល់', 'ប្រៀបធៀប', 'ត្រូវ', 'ផ្ទុយ', 'ជួប', 'ប៉ះ', 'ប្រទះ',
  'ភ្ជាប់', 'សម', 'សមស្រប', 'ជាមួយ', 'ព្រម', 'រួម', 'ទៅ', 'តប', 'ឆ្លើយតប', 'ទប់ទល់', 'ទាស់', 'ស្និទ្ធ', 'ស៊ាំ', 'ប្រកួត', 'ច្រឡំ', 'ទម្លាប់', 'ស្គាល់',
  'ជិត', 'ក្បែរ', 'អាស្រ័យ', 'ជំពាក់', 'ខឹង', 'ពេញចិត្ត', 'ភ្ញាក់ផ្អើល', 'ចាប់អារម្មណ៍', 'ប្រើ', 'ឆ្លើយ', 'ស្រដៀង', 'ធៀប']);
const MODAL_OR_ASPECT = new Set(['មិន', 'ពុំ', 'អាច', 'ត្រូវ', 'បាន', 'ចង់', 'គួរ', 'ធ្វើ', 'ទៅ', 'មក', 'ក្លាយ', 'ក្លាយជា', 'ទទួល', 'ចាប់ផ្ដើម', 'បន្ត']);
const NEGATION_BEFORE_DAEL = new Set(['មិន', 'ពុំ', 'មិនទាន់', 'ពុំទាន់', 'ធ្លាប់', 'មិនដែល', 'ពុំដែល', 'មិនធ្លាប់']);
const QUESTION_MARKERS = ['អ្វី', 'ណា', 'ទេ', 'ឬ', 'ប៉ុន្មាន', 'ម្ដេច', 'ម្តេច', 'ម៉េច', 'ខ្លះ', 'មែន', 'នៅ', 'ឬក៏', 'ប៉ុណ្ណា', 'ហេតុអី'];
const HUMAN_NOUNS = new Set(['សិស្ស', 'និស្សិត', 'គ្រូ', 'គ្រូបង្រៀន', 'មនុស្ស', 'កុមារ', 'បុគ្គលិក', 'មន្ត្រី', 'កម្មករ', 'កម្មការិនី', 'អ្នកចូលរួម', 'សមាជិក',
  'ពលរដ្ឋ', 'ក្មេង', 'អ្នកជំងឺ', 'អតិថិជន', 'វិនិយោគិន', 'បុរស', 'ស្ត្រី', 'នារី', 'យុវជន', 'សាក្សី', 'ចៅក្រម', 'មេធាវី', 'និយោជិត', 'អ្នកស្រុក']);
const CLASSIFIERS = new Set(['នាក់', 'រូប', 'អង្គ', 'ព្រះអង្គ', 'ក្រុម', 'គ្រួសារ', 'ជំនាន់', 'ថ្នាក់', 'ភាគរយ']);
const PAST_MARKERS = ['ម្សិលមិញ', 'ម្សិលម្ងៃ', 'ឆ្នាំមុន', 'ខែមុន', 'សប្ដាហ៍មុន', 'សប្តាហ៍មុន', 'កាលពី'];
const MOTION_VERBS = new Set(['ទៅ', 'មក']);
const ALLOWED_REPEATS = new Set(['គ្នា', 'ទេ']);

function adjacentNext(s, i) { return s.words[i + 1]; }

function confusables(ctx, s, add) {
  const { lexicon } = ctx;
  const w = s.words;
  for (let i = 0; i < w.length; i++) {
    const t = w[i], prev = w[i - 1], next = w[i + 1];
    if (t.key === 'និង' && prev && next) {
      const modal = MODAL_OR_ASPECT.has(next.key);
      // «…សប្បាយរីករាយ និងមានន័យ» coordinates two predicates: a space before និង after a
      // word that is not a pronoun marks coordination, not the future marker នឹង.
      const spaced = /\s/u.test(ctx.text.slice(prev.end, t.start));
      const subject = isPron(ctx, prev) || (!spaced && isNounOnly(ctx, prev) && !isVerbish(ctx, prev));
      if (subject && (modal || isVerbOnly(ctx, next)) && !isPron(ctx, next)) {
        const evidence = lexicon.bigram('នឹង', next.key) > lexicon.bigram('និង', next.key);
        let c = isPron(ctx, prev) ? 0.75 : 0.55;
        if (evidence) c += 0.08;
        add({ start: t.start, end: t.end, category: 'grammar', severity: 'error', confidence: c, ruleId: 'grammar.ning-neung',
          title: 'ច្រឡំ «និង» និង «នឹង»',
          explanation: `«និង» ជាពាក្យភ្ជាប់ (ន័យ «and») ដែលតភ្ជាប់ពាក្យប្រភេទដូចគ្នា។ នៅទីនេះ វានៅចន្លោះប្រធាន «${prev.text}» និងកិរិយាសព្ទ «${next.text}» ដូច្នេះប្រហែលជាត្រូវប្រើ «នឹង» ដែលបង្ហាញអនាគតកាល។`,
          suggestions: ['នឹង'], source: 'project-grammar', sourceDetail: evidence ? 'ភស្តុតាងប្រេកង់គាំទ្រ «នឹង» នៅមុខកិរិយាសព្ទនេះ' : null, autoFixSafe: false });
      }
    }
    if (t.key === 'នឹង' && prev && next) {
      const prevNominal = isPron(ctx, prev) || isNounOnly(ctx, prev);
      const nextNominal = isPron(ctx, next) || isNounOnly(ctx, next);
      if (prevNominal && nextNominal && !TAKES_NEUNG.has(prev.key) && !isVerbish(ctx, next)) {
        const c = isPron(ctx, prev) && isPron(ctx, next) ? 0.8 : 0.6;
        add({ start: t.start, end: t.end, category: 'grammar', severity: 'error', confidence: c, ruleId: 'grammar.neung-ning',
          title: 'ច្រឡំ «នឹង» និង «និង»',
          explanation: `«នឹង» ជាពាក្យបង្ហាញអនាគតកាល ដែលត្រូវនៅមុខកិរិយាសព្ទ។ នៅទីនេះ វាតភ្ជាប់នាមពីរ «${prev.text}» និង «${next.text}» ដូច្នេះប្រហែលជាត្រូវប្រើពាក្យភ្ជាប់ «និង»។`,
          suggestions: ['និង'], source: 'project-grammar', autoFixSafe: false });
      }
    }
    if (t.key === 'ដែល' && prev && !NEGATION_BEFORE_DAEL.has(prev.key)) {
      const last = i === w.length - 1 || (i === w.length - 2 && ['ឬ', 'ទេ'].includes(next?.key));
      if (last) {
        const hasKor = w.some(x => x.key === 'ក៏');
        add({ start: t.start, end: t.end, category: 'grammar', severity: 'error', confidence: hasKor ? 0.85 : 0.7, ruleId: 'grammar.dael-dae',
          title: 'ច្រឡំ «ដែល» និង «ដែរ»',
          explanation: '«ដែល» ជាពាក្យភ្ជាប់ដែលត្រូវមានឃ្លាតាមក្រោយ (ឧ. «សៀវភៅដែលខ្ញុំទិញ»)។ នៅចុងល្បះ ពាក្យដែលមានន័យ «ដូចគ្នា ផង» គឺ «ដែរ» (ឧ. «ខ្ញុំក៏ទៅដែរ»)។',
          suggestions: ['ដែរ'], source: 'project-grammar', autoFixSafe: false });
      }
    }
    if (t.key === 'ដែរ' && prev && next && touching(ctx, t, next) && has(posOf(ctx, prev), POS.N) && !isVerbish(ctx, prev)) {
      if (isPron(ctx, next) || (isNounOnly(ctx, next) && w[i + 2] && isVerbish(ctx, w[i + 2]))) {
        add({ start: t.start, end: t.end, category: 'grammar', severity: 'error', confidence: isPron(ctx, next) ? 0.7 : 0.55, ruleId: 'grammar.dae-dael',
          title: 'ច្រឡំ «ដែរ» និង «ដែល»',
          explanation: `«ដែរ» មានន័យ «ដូចគ្នា ផង» ហើយច្រើននៅចុងល្បះ។ នៅទីនេះ វាភ្ជាប់នាម «${prev.text}» ទៅនឹងឃ្លាពន្យល់ ដូច្នេះត្រូវប្រើពាក្យភ្ជាប់ «ដែល»។`,
          suggestions: ['ដែល'], source: 'project-grammar', autoFixSafe: false });
      }
    }
  }
}

function repetition(ctx, s, add) {
  const w = s.words;
  for (let i = 1; i < w.length; i++) {
    const a = w[i - 1], b = w[i];
    if (a.key !== b.key || ALLOWED_REPEATS.has(a.key)) continue;
    const gap = ctx.text.slice(a.end, b.start);
    if (/[^\s\u200B]/u.test(gap)) continue;
    const functionWord = has(posOf(ctx, a), POS.CONJ) || has(posOf(ctx, a), POS.PART) || has(posOf(ctx, a), POS.PREP);
    // With a space between, the second word often starts a new phrase (មួយ មួយ...), so only
    // function words and pronouns keep a high confidence.
    const spaced = /\s/u.test(gap);
    if (spaced && !functionWord && !isPron(ctx, a)) continue;
    add({ start: a.start, end: b.end, category: 'repetition', severity: 'warning', confidence: functionWord ? 0.85 : 0.7, ruleId: 'repetition.adjacent',
      title: 'ពាក្យដដែលជាប់គ្នា',
      explanation: `ពាក្យ «${a.text}» ត្រូវបានសរសេរពីរដងជាប់គ្នា។ ប្រសិនបើចង់និយាយដដែលៗ ភាសាខ្មែរប្រើលេខទោ «ៗ» (ឧ. «${a.text}ៗ»)។ បើមិនមែនចេតនា សូមលុបមួយចេញ។`,
      suggestions: [a.text, a.text + 'ៗ'], source: 'project-grammar', autoFixSafe: functionWord });
  }
  // the same content word three or more times in one sentence (not in comma lists)
  if (w.length < 10 || /[,،、]/u.test(ctx.text.slice(s.start, s.end))) return;
  const counts = new Map();
  for (const t of w) {
    if (t.type !== 'word' || t.clusters < 2) continue;
    const p = posOf(ctx, t);
    if (has(p, POS.CONJ) || has(p, POS.PART) || has(p, POS.PREP) || has(p, POS.PRON)) continue;
    if (!counts.has(t.key)) counts.set(t.key, []);
    counts.get(t.key).push(t);
  }
  for (const [, list] of counts) {
    if (list.length >= 3) {
      const t = list[2];
      add({ start: t.start, end: t.end, category: 'repetition', severity: 'suggestion', confidence: 0.45, ruleId: 'repetition.sentence',
        title: 'ពាក្យដដែលច្រើនដងក្នុងល្បះតែមួយ',
        explanation: `ពាក្យ «${t.text}» លេចឡើង ${list.length} ដងក្នុងល្បះនេះ។ ពិចារណាប្រើសព្វនាម ឬរៀបល្បះឡើងវិញ ដើម្បីកុំឱ្យដដែលៗ។`,
        suggestions: [], source: 'project-style' });
    }
  }
}

function aspect(ctx, s, add) {
  const key = sentenceKey(s);
  if (!PAST_MARKERS.some(m => key.includes(m)) || key.includes('ថា')) return;
  const w = s.words;
  // A sentence that also names a future time («…ហើយសប្ដាហ៍ក្រោយ ខ្ញុំនឹង…») is not a conflict.
  if (/ក្រោយ|ស្អែក|អនាគត/u.test(key)) return;
  const pastAt = w.findIndex(x => PAST_MARKERS.some(m => x.key.includes(m)));
  for (let i = 0; i < w.length - 1; i++) {
    // only within the clause of the past marker: a connector in between starts a new clause
    if (i > pastAt && w.slice(pastAt + 1, i).some(x => ['ហើយ', 'ប៉ុន្តែ', 'ប៉ុន្ដែ', 'តែ', 'រួច'].includes(x.key))) break;
    if (w[i].key === 'នឹង' && !TAKES_NEUNG.has(w[i - 1]?.key) && isVerbish(ctx, w[i + 1])) {
      add({ start: w[i].start, end: w[i].end, category: 'grammar', severity: 'warning', confidence: 0.5, ruleId: 'grammar.tense-conflict',
        title: 'ពេលវេលាមិនស៊ីគ្នា',
        explanation: 'ល្បះនេះមានពាក្យបង្ហាញអតីតកាល (ឧ. «ម្សិលមិញ» «កាលពី...») ប៉ុន្តែប្រើ «នឹង» ដែលបង្ហាញអនាគតកាល។ បើនិយាយពីហេតុការណ៍ដែលកើតរួចហើយ គួរប្រើ «បាន»។',
        suggestions: ['បាន'], source: 'project-grammar', autoFixSafe: false, humanReview: true });
    }
  }
}

function correlatives(ctx, s, add) {
  const key = sentenceKey(s);
  const check = (opener, closers, explanation) => {
    for (const hit of findPhrase(s, opener)) {
      const rest = s.words.slice(hit.j + 1).map(x => x.key).join('');
      if (!closers.some(c => rest.includes(c))) {
        // «គាត់មិនត្រឹមតែរៀនពូកែ។» → «គាត់រៀនពូកែ។» is complete; adding the missing half needs the writer.
        const removable = opener === 'មិនត្រឹមតែ';
        add({ start: hit.start, end: hit.end, category: 'missing', severity: 'suggestion', confidence: 0.45, ruleId: 'missing.correlative',
          title: 'ខ្វះពាក្យគូ', explanation: explanation + (removable ? ' សំណើ៖ លុប «មិនត្រឹមតែ» ចេញ ដើម្បីឱ្យល្បះពេញលេញ ឬបន្ថែមផ្នែកទីពីរដោយខ្លួនឯង។' : ''),
          suggestions: removable ? [''] : [], source: 'project-grammar' });
      }
    }
  };
  check('មិនត្រឹមតែ', ['ថែមទាំង', 'ប៉ុណ្ណោះ', 'ប៉ុន្តែ', 'ប៉ុន្ដែ', 'តែ', 'ក៏', 'ផងដែរ', 'ទៀត'],
    '«មិនត្រឹមតែ...» ជាធម្មតាមានពាក្យគូនៅឃ្លាបន្ទាប់ ដូចជា «...ប៉ុណ្ណោះទេ ថែមទាំង...» ឬ «...ប៉ុន្តែ...ផងដែរ»។ ល្បះនេះហាក់ដូចជាខ្វះផ្នែកទីពីរ។');
  if (!key.includes('ក៏ដោយ')) check('ទោះបី', ['ក៏', 'ក្ដី', 'ក្តី', 'តែ', 'ប៉ុន្តែ', 'ប៉ុន្ដែ', 'នៅតែ'],
    '«ទោះបី(ជា)...» ជាធម្មតាមាន «...ក៏ដោយ» ឬ «...ក៏...» នៅឃ្លាបន្ទាប់។ ល្បះនេះហាក់ដូចជាខ្វះផ្នែកនោះ។');
}

function questions(ctx, s, add) {
  if (s.words[0]?.key !== 'តើ') return;
  const rest = s.words.slice(1).map(x => x.key).join('');
  // «តើអ្នកទៅមិនទៅ?»: the X មិន X form is itself the question.
  // Checked on the joined text, because the segmenter may join «មិនទៅ» into one word.
  const xNotX = s.words.some((x, i) => rest.includes(x.key + 'មិន' + x.key) && i > 0);
  if (!xNotX && !QUESTION_MARKERS.some(q => rest.includes(q))) {
    const w = s.words, last = w[w.length - 1];
    const end = s.terminator ? s.tokens[s.tokens.length - 1].end : last.end;
    const body = ctx.text.slice(w[0].start, last.end), withoutTae = ctx.text.slice(w[1] ? w[1].start : last.end, last.end);
    add({ start: w[0].start, end, category: 'missing', severity: 'suggestion', confidence: 0.45, ruleId: 'missing.question-word',
      title: 'ខ្វះពាក្យសួរ',
      explanation: 'ល្បះចាប់ផ្ដើមដោយ «តើ» ប៉ុន្តែគ្មានពាក្យសួរ (ឧ. «អ្វី» «ណា» «ទេ» «ឬទេ» «ប៉ុន្មាន»)។ បើជាសំណួរ សូមបន្ថែម «ទេ» និង «?»។ បើមិនមែនសំណួរ សូមលុប «តើ» ចេញ។',
      suggestions: w[1] ? [body + 'ទេ?', withoutTae + '។'] : [], source: 'project-grammar' });
  }
}

function classifiers(ctx, s, add) {
  const toks = s.tokens;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.type !== 'number') continue;
    // look back over spaces and the word ចំនួន for a human noun
    let j = i - 1, noun = null;
    while (j >= 0 && (toks[j].type === 'space' || toks[j].type === 'zwsp' || toks[j].key === 'ចំនួន')) j--;
    if (j >= 0 && HUMAN_NOUNS.has(toks[j].key)) noun = toks[j];
    if (!noun) continue;
    let k = i + 1;
    while (k < toks.length && (toks[k].type === 'space' || toks[k].type === 'zwsp')) k++;
    const next = toks[k];
    if (next && (CLASSIFIERS.has(next.key) || next.type === 'latin' || next.text === '%')) continue;
    add({ start: t.start, end: t.end, category: 'missing', severity: 'suggestion', confidence: 0.5, ruleId: 'missing.classifier',
      title: 'ខ្វះពាក្យឯកតា (ចំណាត់ថ្នាក់នាម)',
      explanation: `ពេលរាប់មនុស្ស ភាសាខ្មែរប្រើពាក្យឯកតា «នាក់» នៅក្រោយចំនួន (ឧ. «${noun.text} ${t.text} នាក់»)។`,
      suggestions: [t.text + ' នាក់'], source: 'project-grammar', autoFixSafe: false });
  }
}

function wordOrder(ctx, s, add) {
  const w = s.words;
  // PRONOUN + PLACE NOUN + ទៅ/មក at the end of a sentence: the verb normally precedes its destination.
  if (w.length === 3 && isPron(ctx, w[0]) && isNounOnly(ctx, w[1]) && MOTION_VERBS.has(w[2].key) && s.terminator) {
    add({ start: w[1].start, end: w[2].end, category: 'structure', severity: 'warning', confidence: 0.6, ruleId: 'structure.motion-verb-order',
      title: 'លំដាប់ពាក្យក្នុងល្បះ',
      explanation: `ក្នុងភាសាខ្មែរ លំដាប់ធម្មតាគឺ ប្រធាន + កិរិយាសព្ទ + ទីកន្លែង។ កិរិយាសព្ទ «${w[2].text}» គួរនៅមុខ «${w[1].text}»។`,
      suggestions: [w[2].text + w[1].text], source: 'project-grammar', autoFixSafe: false });
  }
}

const LONG_SENTENCE = 40;
// Clause connectors where a long sentence can end and a new one begin. For ហើយ ("and
// then") the full stop replaces the connector; the others start the new sentence.
const SPLIT_AT = new Map([['ហើយ', true], ['ប៉ុន្តែ', false], ['ប៉ុន្ដែ', false], ['ដូច្នេះ', false], ['ដោយហេតុនេះ', false], ['លើសពីនេះ', false], ['ម្យ៉ាងទៀត', false]]);

/** The connector nearest the middle of a long sentence, with at least 8 words on each side. */
function splitPoint(ctx, s) {
  const w = s.words;
  let best = null;
  for (let i = 8; i < w.length - 8; i++) {
    const t = w[i];
    if (!SPLIT_AT.has(t.key)) continue;
    const gap = ctx.text.slice(w[i - 1].end, t.start);
    if (!/^[ \t\u200B]+$/u.test(gap)) continue; // a connector is set off by a space; ធ្វើរួចហើយ is not
    // The new sentence needs its own subject. «…ហើយទិញត្រី» continues the same subject, so
    // splitting there would leave «ទិញត្រី។» without one.
    const next = w[i + 1];
    if (!next || !(isPron(ctx, next) || (has(posOf(ctx, next), POS.N) && !isVerbOnly(ctx, next) && !MODAL_OR_ASPECT.has(next.key)))) continue;
    const dist = Math.abs(i - w.length / 2);
    if (!best || dist < best.dist) best = { i, dist };
  }
  if (!best) return null;
  const t = w[best.i], prev = w[best.i - 1];
  const drop = SPLIT_AT.get(t.key);
  // Replace "prev␣connector" with "prev។␣connector" (or "prev។" when the connector is dropped)
  const start = prev.start, end = drop ? w[best.i + 1].start : t.end;
  const replacement = drop ? `${prev.text}។ ` : `${prev.text}។ ${t.text}`;
  return { start, end, replacement, word: t, drop };
}

const NO_SPLIT_AFTER = new Set(['ដែល', 'ថា', 'និង', 'ឬ', 'នៃ', 'របស់', 'នូវ', 'ដោយ', 'ពី', 'នៅ', 'ក្នុង', 'ដល់', 'ចំពោះ', 'សម្រាប់', 'ជា', 'គឺ']);

/** A space before «subject + verb» near the middle of a long sentence, outside brackets. */
function subjectSplit(ctx, s) {
  const w = s.words;
  let best = null;
  for (let i = 8; i < w.length - 8; i++) {
    const t = w[i], prev = w[i - 1], next = w[i + 1];
    if (!/^[ \t\u200B]+$/u.test(ctx.text.slice(prev.end, t.start))) continue;
    if (NO_SPLIT_AFTER.has(prev.key) || has(posOf(ctx, prev), POS.PREP) || has(posOf(ctx, prev), POS.CONJ)) continue;
    const before = ctx.text.slice(s.start, t.start);
    if ((before.match(/[(«]/g) || []).length > (before.match(/[)»]/g) || []).length) continue; // inside brackets or quotes
    const subject = isPron(ctx, t) || (has(posOf(ctx, t), POS.N) && !isVerbOnly(ctx, t));
    const verb = next && (isVerbOnly(ctx, next) || ['បាន', 'នឹង', 'កំពុង', 'មិន', 'ត្រូវ', 'អាច', 'ក៏'].includes(next.key));
    if (!subject || !verb) continue;
    const dist = Math.abs(i - w.length / 2);
    if (!best || dist < best.dist) best = { i, dist };
  }
  if (!best) return null;
  const prev = w[best.i - 1], t = w[best.i];
  return { start: prev.start, end: t.start, replacement: `${prev.text}។ `, word: t };
}

function clarity(ctx, s, add) {
  const w = s.words;
  if (w.length > LONG_SENTENCE) {
    let split = splitPoint(ctx, s);
    if (split) {
      add({ start: split.start, end: split.end, category: 'clarity', severity: 'suggestion', confidence: 0.45, ruleId: 'clarity.split-sentence',
        title: 'ល្បះវែងពេក៖ អាចបំបែកនៅទីនេះ',
        explanation: `ល្បះនេះមានប្រហែល ${w.length} ពាក្យ។ ល្បះវែងពិបាកអាន។ «${split.word.text}» ចាប់ផ្ដើមឃ្លាថ្មីដែលមានប្រធានផ្ទាល់ខ្លួន ដូច្នេះអាចបញ្ចប់ល្បះទីមួយនៅទីនេះ ហើយចាប់ផ្ដើមល្បះថ្មី ដោយន័យនៅដដែល។` +
          (split.drop ? ` ពាក្យ «${split.word.text}» អាចលុបចេញ ព្រោះខណ្ឌសញ្ញា «។» ជំនួសមុខងាររបស់វា។` : ''),
        suggestions: [split.replacement], source: 'project-style', autoFixSafe: false });
    } else if ((split = subjectSplit(ctx, s))) {
      add({ start: split.start, end: split.end, category: 'clarity', severity: 'suggestion', confidence: 0.4, ruleId: 'clarity.split-sentence',
        title: 'ល្បះវែងពេក៖ អាចបំបែកនៅទីនេះ',
        explanation: `ល្បះនេះមានប្រហែល ${w.length} ពាក្យ។ ឃ្លាថ្មីចាប់ផ្ដើមដោយប្រធាន «${split.word.text}» និងកិរិយាសព្ទរបស់វា ដូច្នេះអាចបញ្ចប់ល្បះទីមួយនៅមុខវា។ សូមអានល្បះទាំងពីរម្ដងទៀត ថាន័យនៅដដែល។`,
        suggestions: [split.replacement], source: 'project-style', autoFixSafe: false });
    } else {
      add({ start: w[0].start, end: w[Math.min(w.length - 1, 5)].end, category: 'clarity', severity: 'suggestion', confidence: 0.5, ruleId: 'clarity.long-sentence',
        title: 'ល្បះវែងពេក',
        explanation: `ល្បះនេះមានប្រហែល ${w.length} ពាក្យ ដោយគ្មានខណ្ឌសញ្ញា។ ល្បះវែងពិបាកអាន ហើយងាយយល់ច្រឡំ។ ពិចារណាបំបែកជាល្បះខ្លីៗ។`,
        suggestions: [], source: 'project-style' });
    }
  }
  const dael = w.filter(x => x.key === 'ដែល');
  if (dael.length >= 3) {
    add({ start: dael[2].start, end: dael[2].end, category: 'clarity', severity: 'suggestion', confidence: 0.45, ruleId: 'clarity.nested-relatives',
      title: 'ឃ្លា «ដែល» ច្រើនពេក',
      explanation: `ល្បះនេះមាន «ដែល» ${dael.length} ដង។ ឃ្លាពន្យល់ជាន់គ្នាច្រើន ធ្វើឱ្យអ្នកអានពិបាកដឹងថាឃ្លាណាពន្យល់នាមណា។`,
      suggestions: [], source: 'project-style' });
  }
  // A full sentence with no verb, adjective, copula or locative predicate (formal modes only)
  if (FORMAL_MODES.has(ctx.options.mode) && s.terminator === '។' && w.length >= 3 && w.every(x => x.type === 'word')) {
    const hasPredicate = w.some(x => isVerbish(ctx, x) || ['ជា', 'គឺ', 'នៅ', 'របស់', 'មាន', 'គ្មាន'].includes(x.key));
    if (!hasPredicate) {
      add({ start: w[0].start, end: w[w.length - 1].end, category: 'structure', severity: 'info', confidence: 0.35, ruleId: 'structure.no-predicate',
        title: 'ល្បះប្រហែលមិនពេញលេញ',
        explanation: 'រកមិនឃើញកិរិយាសព្ទ ឬគុណនាមដែលធ្វើជាអាខ្យាតក្នុងល្បះនេះទេ។ បើវាជាចំណងជើង អាចលុប «។» ចេញ។ បើវាជាល្បះ សូមពិនិត្យថាខ្វះកិរិយាសព្ទឬទេ។',
        suggestions: [], source: 'project-grammar' });
    }
  }
}

// Three or more sentences in a row that open with the same word read as monotonous.
function sentenceOpenings(ctx, add) {
  const ss = ctx.sentences.filter(s => s.terminator && s.words.length >= 3);
  for (let i = 2; i < ss.length; i++) {
    const k = ss[i].words[0].key;
    if (ss[i - 1].words[0].key !== k || ss[i - 2].words[0].key !== k) continue;
    if (i + 1 < ss.length && ss[i + 1].words[0].key === k) continue; // report a run once, at its end
    const t = ss[i].words[0], prevS = ss[i - 1], term = prevS.tokens[prevS.tokens.length - 1];
    // Join the last two sentences of the run: «ខ្ញុំទិញត្រី។ ខ្ញុំត្រឡប់…» → «ខ្ញុំទិញត្រី ហើយត្រឡប់…».
    // Only when the shared opener is the subject and a verb follows it, and the result stays short.
    const subject = isPron(ctx, t) || isNounOnly(ctx, t);
    const verbNext = ss[i].words[1] && (isVerbish(ctx, ss[i].words[1]) || MODAL_OR_ASPECT.has(ss[i].words[1].key) || ['បាន', 'នឹង', 'កំពុង', 'ក៏'].includes(ss[i].words[1].key));
    const canJoin = subject && verbNext && prevS.terminator === '។' && prevS.words.length + ss[i].words.length <= 30;
    add({ start: canJoin ? term.start : t.start, end: t.end, category: 'repetition', severity: 'suggestion', confidence: canJoin ? 0.5 : 0.4, ruleId: 'repetition.sentence-openings',
      title: canJoin ? 'អាចភ្ជាប់ល្បះពីរជាមួយ «ហើយ»' : 'ល្បះជាប់គ្នាចាប់ផ្ដើមដោយពាក្យដដែល',
      explanation: `ល្បះជាប់គ្នាច្រើនចាប់ផ្ដើមដោយ «${t.text}» ធ្វើឱ្យសំណេរស្ដាប់ទៅដដែលៗ។` +
        (canJoin ? ` ល្បះពីរចុងក្រោយមានប្រធានដូចគ្នា ដូច្នេះអាចភ្ជាប់ជាល្បះតែមួយ ដោយប្រើ «ហើយ» ជំនួស «។ ${t.text}» ហើយន័យនៅដដែល។` : ' ពិចារណាភ្ជាប់ល្បះខ្លះ ឬផ្លាស់ប្ដូរការចាប់ផ្ដើម។'),
      suggestions: canJoin ? [' ហើយ'] : [], source: 'project-style' });
  }
}

export function checkGrammar(ctx) {
  const out = [];
  const add = f => out.push(makeFinding(ctx.text, { layer: 'grammar', ...f }));
  sentenceOpenings(ctx, add);
  for (const s of ctx.sentences) {
    confusables(ctx, s, add);
    repetition(ctx, s, add);
    aspect(ctx, s, add);
    correlatives(ctx, s, add);
    questions(ctx, s, add);
    classifiers(ctx, s, add);
    wordOrder(ctx, s, add);
    clarity(ctx, s, add);
  }
  return out;
}
