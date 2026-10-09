// Contradictions in meaning that a careful reader would stop at.
//
//   1. Time expressions that point both ways: «ម្សិលមិញសប្ដាហ៍ក្រោយ», «ពេលល្ងាចថ្ងៃត្រង់»,
//      «ម្សិលមិញរបស់ថ្ងៃស្អែក».
//   2. «X មិន X» in a statement: «មកមិនមក», «ឆ្ងាញ់មិនឆ្ងាញ់». In a question it is normal
//      («ទៅមិនទៅ?»), and after ទោះ it means "whether or not"; both are left alone.
//   3. Opposite words side by side: «ក្ដៅត្រជាក់», «មូលជ្រុង». A pair the dictionary lists as
//      one word is an established expression («ឡើងចុះ», «ចេញចូល», «មុនក្រោយ») and is skipped.
// Each finding offers "keep one of the two" as its corrections. These are project rules;
// the writer decides which meaning was intended.

import { makeFinding } from '../finding.js';
import { wordKey } from '../normalize.js';

const PAST = new Set(['ម្សិលមិញ', 'ម្សិលម្ងៃ', 'ម្សិល']);
const FUTURE = new Set(['ស្អែក', 'ថ្ងៃស្អែក', 'ខានស្អែក']);
const UNITS = ['សប្ដាហ៍', 'សប្តាហ៍', 'ខែ', 'ឆ្នាំ', 'ថ្ងៃ'];
const TIMES_OF_DAY = ['ព្រឹក', 'ថ្ងៃត្រង់', 'រសៀល', 'ល្ងាច', 'យប់', 'អាធ្រាត្រ'];
const OPPOSITES = [['ក្ដៅ', 'ត្រជាក់'], ['ក្តៅ', 'ត្រជាក់'], ['មូល', 'ជ្រុង'], ['រត់', 'អង្គុយ'], ['ធំ', 'តូច'], ['វែង', 'ខ្លី'], ['ខ្ពស់', 'ទាប'],
  ['ជិត', 'ឆ្ងាយ'], ['ចាស់', 'ថ្មី'], ['ល្អ', 'អាក្រក់'], ['ស្ងួត', 'សើម'], ['ពិត', 'មិនពិត'], ['រស់', 'ស្លាប់'], ['ឆ្អែត', 'ឃ្លាន']];
const OPP = new Map();
for (const [a, b] of OPPOSITES) { OPP.set(wordKey(a) + '|' + wordKey(b), true); OPP.set(wordKey(b) + '|' + wordKey(a), true); }

/** Relative time of a token, a two-token phrase like «សប្ដាហ៍ក្រោយ», or one token like «ឆ្នាំមុន». */
function timeSense(words, i) {
  const k = words[i].key;
  if (PAST.has(k)) return { sense: 'past', len: 1 };
  if (FUTURE.has(k)) return { sense: 'future', len: 1 };
  for (const u of UNITS) {
    if (k === u + 'មុន') return { sense: 'past', len: 1 };
    if (k === u + 'ក្រោយ') return { sense: 'future', len: 1 };
    if (k === u && words[i + 1]?.key === 'មុន') return { sense: 'past', len: 2 };
    if (k === u && words[i + 1]?.key === 'ក្រោយ') return { sense: 'future', len: 2 };
  }
  return null;
}
const dayTime = k => TIMES_OF_DAY.find(t => k === t || k === 'ពេល' + t) || null;

export function checkMeaning(ctx) {
  const { text, sentences } = ctx;
  const out = [];
  const add = f => out.push(makeFinding(text, { layer: 'grammar', category: 'clarity', severity: 'warning', source: 'project-grammar', autoFixSafe: false, ...f }));
  const span = (a, b) => text.slice(a.start, b.end);

  for (const s of sentences) {
    const w = s.words;
    const question = s.terminator === '?' || w.some(x => ['តើ', 'ឬ'].includes(x.key));
    for (let i = 0; i < w.length; i++) {
      // 1a. past and future within two words of each other
      const t1 = timeSense(w, i);
      if (t1) {
        for (let j = i + t1.len; j <= Math.min(w.length - 1, i + t1.len + 1); j++) {
          const t2 = timeSense(w, j);
          if (!t2 || t2.sense === t1.sense) continue;
          const first = span(w[i], w[i + t1.len - 1]), second = span(w[j], w[j + t2.len - 1]);
          add({ start: w[i].start, end: w[j + t2.len - 1].end, confidence: 0.7, ruleId: 'meaning.time-conflict',
            title: 'ពេលវេលាផ្ទុយគ្នា',
            explanation: `«${first}» និយាយពី${t1.sense === 'past' ? 'អតីតកាល' : 'អនាគតកាល'} ប៉ុន្តែ «${second}» និយាយពី${t2.sense === 'past' ? 'អតីតកាល' : 'អនាគតកាល'}។ ពេលវេលាតែមួយមិនអាចជាទាំងពីរបានទេ។ សូមរក្សាទុកមួយ ដែលត្រូវនឹងន័យដែលអ្នកចង់និយាយ។`,
            suggestions: [first, second] });
          i = j + t2.len - 1;
          break;
        }
      }
      // 1b. two different times of day side by side
      const d1 = dayTime(w[i].key), d2 = w[i + 1] && dayTime(w[i + 1].key);
      if (d1 && d2 && d1 !== d2) {
        add({ start: w[i].start, end: w[i + 1].end, confidence: 0.65, ruleId: 'meaning.time-of-day-conflict',
          title: 'ពេលវេលាផ្ទុយគ្នា',
          explanation: `«${w[i].text}» និង «${w[i + 1].text}» ជាពេលពីរផ្សេងគ្នានៃថ្ងៃ។ បើចង់និយាយពីរយៈពេល សរសេរ «ពី...ដល់...»។ បើមិនដូច្នោះ សូមរក្សាទុកមួយ។`,
          suggestions: [w[i].text, w[i + 1].text] });
        i++;
        continue;
      }
      // 2. X មិន X in a statement
      if (!question && w[i + 2] && w[i + 1].key === 'មិន' && w[i + 2].key === w[i].key && w[i - 1]?.key !== 'ទោះ' && !s.words.some(x => x.key.startsWith('ទោះ'))) {
        add({ start: w[i].start, end: w[i + 2].end, confidence: 0.7, ruleId: 'meaning.x-not-x',
          title: 'ន័យផ្ទុយគ្នាក្នុងល្បះ',
          explanation: `«${w[i].text}មិន${w[i].text}» និយាយទាំង «${w[i].text}» និង «មិន${w[i].text}» ក្នុងពេលតែមួយ។ ក្នុងល្បះប្រកាស នេះធ្វើឱ្យអ្នកអានមិនដឹងថាមួយណាពិត។ សូមជ្រើសមួយ។`,
          suggestions: [w[i].text, 'មិន' + w[i].text] });
        i += 2;
        continue;
      }
      // 3. opposites side by side, unless the dictionary lists the pair as one expression
      const nx = w[i + 1];
      // «តូចធំៗ», «ខ្ពស់ទាបៗ»: with ៗ the pair means "of various sizes / heights", which is normal.
      const reduplicated = nx && ctx.tokens[nx.index + 1]?.type === 'repeat';
      if (nx && !reduplicated && OPP.has(w[i].key + '|' + nx.key) && !ctx.lexicon.has(w[i].key + nx.key) && !/\S/u.test(text.slice(w[i].end, nx.start).replace(/[ ​]/gu, ''))) {
        add({ start: w[i].start, end: nx.end, confidence: 0.6, ruleId: 'meaning.opposites',
          title: 'ពាក្យមានន័យផ្ទុយគ្នានៅជាប់គ្នា',
          explanation: `«${w[i].text}» និង «${nx.text}» មានន័យផ្ទុយគ្នា។ ដាក់ជាប់គ្នាដូច្នេះ អ្នកអានមិនដឹងថាមួយណាពិត។ សូមរក្សាទុកមួយ ឬសរសេរ «${w[i].text} ឬ ${nx.text}» បើចង់និយាយពីជម្រើស។`,
          suggestions: [w[i].text, nx.text] });
        i++;
      }
    }
  }
  return out;
}
