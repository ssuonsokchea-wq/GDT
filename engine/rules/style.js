// Word choice, register, unnecessary words, nominalisers and legal-drafting advice.

import { makeFinding } from '../finding.js';
import { findPhrase, FORMAL_MODES } from './helpers.js';
import { AUTHORITATIVE } from '../lexicon.js';
import { segmentRun } from '../tokenize.js';

const CATEGORY_OK = new Set(['grammar', 'structure', 'wording', 'missing', 'unnecessary', 'punctuation', 'spelling', 'clarity']);

const LEGAL_VAGUE = [
  ['ជាដើម', 'ពាក្យ «ជាដើម» ធ្វើឱ្យបញ្ជីមិនកំណត់ច្បាស់។ ក្នុងអត្ថបទច្បាប់ គួររាប់បញ្ចូលធាតុទាំងអស់ ឬសរសេរឱ្យច្បាស់ថាបញ្ជីនោះជាឧទាហរណ៍។'],
  ['មួយចំនួន', '«មួយចំនួន» មិនកំណត់ចំនួនច្បាស់លាស់។ ក្នុងអត្ថបទច្បាប់ ពិចារណាកំណត់ចំនួន ឬលក្ខខណ្ឌឱ្យច្បាស់។'],
  ['ប្រហែល', '«ប្រហែល» បង្កើតភាពមិនច្បាស់លាស់។ កាតព្វកិច្ចផ្លូវច្បាប់គួរមានចំនួន ឬកាលកំណត់ច្បាស់។'],
  ['សមរម្យ', '«សមរម្យ» ជាស្តង់ដារដែលត្រូវបកស្រាយ។ ប្រសិនបើអាច កំណត់លក្ខខណ្ឌវាស់វែងបាន។'],
  ['ឆាប់ៗ', '«ឆាប់ៗ» មិនមែនជាកាលកំណត់ច្បាស់ទេ។ គួរកំណត់ចំនួនថ្ងៃ ឬកាលបរិច្ឆេទ។'],
  ['តាមការចាំបាច់', '«តាមការចាំបាច់» មិនបញ្ជាក់ថាអ្នកណាជាអ្នកសម្រេចថាចាំបាច់។'],
  ['ផ្សេងៗ', '«ផ្សេងៗ» ធ្វើឱ្យវិសាលភាពមិនច្បាស់។ ក្នុងអត្ថបទច្បាប់ គួររាប់បញ្ចូលជាក់លាក់។'],
];

/**
 * Tokens (or parts of tokens) equal to an informal word. A token that is only weakly
 * attested (e.g. the SBBIC compound បង់លុយ) is re-segmented with authoritative words so
 * that the colloquial part can be found; an authoritative compound such as អត់ធ្មត់ is
 * left whole.
 */
function registerHits(ctx, informal, insideCompounds) {
  const out = [];
  for (const t of ctx.tokens) {
    if (t.type !== 'word') continue;
    if (t.key === informal) { out.push(t); continue; }
    if (!insideCompounds || !t.key.includes(informal) || (ctx.lexicon.flags(t.key) & AUTHORITATIVE)) continue;
    for (const p of segmentRun(t.text, t.start, authoritativeView(ctx.lexicon))) {
      if (p.type === 'word' && ctx.text.slice(p.start, p.end) === informal) out.push(p);
    }
  }
  return out;
}

const views = new WeakMap();
function authoritativeView(lexicon) {
  if (!views.has(lexicon)) {
    const entries = new Map();
    for (const [k, e] of lexicon.entries) if (e.f & AUTHORITATIVE) entries.set(k, e);
    views.set(lexicon, { entries });
  }
  return views.get(lexicon);
}

export function checkStyle(ctx) {
  const { text, sentences, lexicon, options, tokens } = ctx;
  const mode = options.mode;
  const out = [];
  const add = f => out.push(makeFinding(text, { layer: 'style', ...f }));

  // Register: colloquial words in the selected writing mode (token-level, so compounds such as អត់ធ្មត់ are untouched)
  for (const r of lexicon.curated.register || []) {
    if (!r.modes.includes(mode)) continue;
    for (const t of registerHits(ctx, r.informal, r.insideCompounds)) {
      add({ start: t.start, end: t.end, category: 'wording', severity: FORMAL_MODES.has(mode) ? 'warning' : 'suggestion',
        confidence: FORMAL_MODES.has(mode) ? 0.7 : 0.55, ruleId: 'wording.register',
        title: 'ពាក្យមិនសមនឹងប្រភេទសំណេរ', explanation: r.explanation, suggestions: r.formal, source: 'project-style',
        sourceDetail: `របៀបសំណេរ៖ ${mode}`, autoFixSafe: false });
    }
  }
  // Curated verbose phrases and contradictions
  for (const p of lexicon.curated.style || []) {
    if (!p.modes.includes(mode)) continue;
    for (const s of sentences) for (const hit of findPhrase(s, p.pattern)) {
      add({ start: hit.start, end: hit.end, category: p.category === 'wording' ? 'unnecessary' : p.category, severity: p.category === 'wording' ? 'suggestion' : 'error',
        confidence: p.confidence, ruleId: `style.phrase`, title: p.category === 'wording' ? 'ពាក្យលើស' : p.category === 'spelling' ? 'ច្រឡំពាក្យ' : 'ការប្រើពាក្យផ្ទុយគ្នា',
        explanation: p.explanation, suggestions: [p.replacement], source: p.category === 'grammar' || p.category === 'spelling' ? 'project-grammar' : 'project-style',
        autoFixSafe: p.confidence === 'high' });
    }
  }
  // Verified textbook rules (data/curated/textbook-rules.tsv), cited by page
  for (const r of lexicon.curated.textbook || []) {
    for (const s of sentences) for (const hit of findPhrase(s, r.wrong)) {
      add({ start: hit.start, end: hit.end, category: CATEGORY_OK.has(r.category) ? r.category : 'grammar', severity: 'warning', confidence: 0.75,
        ruleId: `textbook.${r.ruleId}`, title: 'វិធានពីសៀវភៅវេយ្យាករណ៍', explanation: r.ruleText + (r.exampleCorrect ? ` ឧទាហរណ៍៖ ${r.exampleCorrect}` : ''),
        suggestions: r.right ? [r.right] : [], source: 'textbook',
        sourceDetail: `PDF ទំព័រ ${r.pdfPage}${r.printedPage ? `, ទំព័របោះពុម្ព ${r.printedPage}` : ''}${r.section ? `, ${r.section}` : ''} · ផ្ទៀងផ្ទាត់ដោយ ${r.verifiedBy}${r.verifiedOn ? ` (${r.verifiedOn})` : ''}`,
        autoFixSafe: false });
    }
  }
  // ការ / សេចក្ដី nominalisers
  for (const n of lexicon.curated.nominalizers || []) {
    for (const s of sentences) for (const hit of findPhrase(s, n.wrong)) {
      add({ start: hit.start, end: hit.end, category: 'wording', severity: 'warning', confidence: n.confidence, ruleId: 'grammar.nominalizer',
        title: 'ការប្រើ «ការ» និង «សេចក្ដី»', explanation: n.explanation + ' («ការ» នៅមុខកិរិយាសព្ទសកម្មភាព «សេចក្ដី» នៅមុខពាក្យបង្ហាញអារម្មណ៍ ឬសភាព)',
        suggestions: [n.correct], source: 'project-grammar', autoFixSafe: false });
    }
  }
  if (mode === 'legal') {
    for (const [phrase, explanation] of LEGAL_VAGUE) {
      const hits = phrase.includes('\u17D7')
        ? [...text.matchAll(new RegExp(phrase, 'gu'))].map(m => ({ start: m.index, end: m.index + m[0].length }))
        : sentences.flatMap(s => findPhrase(s, phrase));
      for (const hit of hits) {
        add({ start: hit.start, end: hit.end, category: 'clarity', severity: 'info', confidence: 0.5, ruleId: 'legal.vague-term',
          title: 'ពាក្យមិនច្បាស់លាស់ក្នុងអត្ថបទច្បាប់', explanation, suggestions: [], source: 'project-legal', humanReview: true });
      }
    }
    for (const m of text.matchAll(/\u1793\u17B7\u1784\s*\/\s*\u17AC/gu)) {
      add({ start: m.index, end: m.index + m[0].length, category: 'clarity', severity: 'warning', confidence: 0.6, ruleId: 'legal.and-or',
        title: '«និង/ឬ» មិនច្បាស់',
        explanation: '«និង/ឬ» អាចបកស្រាយបានពីរបែប។ សរសេរឱ្យច្បាស់ ឧ. «ក ឬ ខ ឬទាំងពីរ»។ KhmerProof មិនកែដោយស្វ័យប្រវត្តិទេ ព្រោះការកែប៉ះពាល់ន័យច្បាប់។',
        suggestions: [], source: 'project-legal', humanReview: true });
    }
    for (const s of sentences) {
      const i = s.words.findIndex((w, k) => w.key === 'គេ' && k === 0);
      if (i === 0) add({ start: s.words[0].start, end: s.words[0].end, category: 'clarity', severity: 'info', confidence: 0.45, ruleId: 'legal.unclear-actor',
        title: 'អ្នកអនុវត្តមិនច្បាស់', explanation: 'ក្នុងអត្ថបទច្បាប់ «គេ» មិនបញ្ជាក់ថាអ្នកណាមានកាតព្វកិច្ច ឬសិទ្ធិ។ គួរដាក់ឈ្មោះភាគី ឬអាជ្ញាធរឱ្យច្បាស់។',
        suggestions: [], source: 'project-legal', humanReview: true });
    }
  }
  if (mode === 'academic') {
    for (const s of sentences) {
      const first = s.words[0];
      if (first && first.key === 'ខ្ញុំ') add({ start: first.start, end: first.end, category: 'wording', severity: 'info', confidence: 0.35, ruleId: 'wording.academic-first-person',
        title: 'សព្វនាមបុរសទីមួយក្នុងសំណេរវិទ្យាសាស្ត្រ', explanation: 'សំណេរស្រាវជ្រាវជាច្រើនប្រើ «យើង» ឬទម្រង់អព្យាក្រឹត (ឧ. «ការសិក្សានេះ...») ជំនួស «ខ្ញុំ»។ ធ្វើតាមការណែនាំរបស់គ្រឹះស្ថានអ្នក។',
        suggestions: [], source: 'project-style' });
    }
  }
  return out;
}
