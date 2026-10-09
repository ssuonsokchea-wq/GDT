// Terminology management: consistent spelling variants, defined terms, digits and
// user-defined preferred terms.

import { makeFinding } from '../finding.js';
import { wordKey } from '../normalize.js';
import { units, weightedDistance } from '../lexicon.js';

// Pairs that name the same thing in legal or official drafting; mixing them invites a
// reader to ask whether two different things are meant.
const LEGAL_SYNONYMS = [
  ['អ្នកទិញ', 'អ្នកជាវ'],
  ['កិច្ចសន្យា', 'កុងត្រា'],
  ['និយោជិត', 'បុគ្គលិក'],
  ['ភាគីទីមួយ', 'ភាគីទី១'],
  ['ភាគីទីពីរ', 'ភាគីទី២'],
];

export function checkConsistency(ctx) {
  const { text, options } = ctx;
  const out = [];
  const add = f => out.push(makeFinding(text, { layer: 'terminology', category: 'terminology', source: 'document', ...f }));

  // 1. One word written with both ្ដ/្ត or ឲ/ឱ forms anywhere in the document (also inside
  //    compounds: សេចក្ដីណែនាំ … សេចក្តីសម្រេច).
  const groups = [];
  if (/\u17D2[\u178A\u178F]|[\u17B1\u17B2]/u.test(text)) {
    const boundary = i => i <= 0 || i >= text.length || !/[\u17B4-\u17D3\u17DD]/u.test(text[i]) && text[i - 1] !== '\u17D2';
    for (const forms of ctx.lexicon.variantGroups()) {
      const g = new Map();
      for (const form of forms) {
        let at = text.indexOf(form);
        while (at !== -1) {
          if (boundary(at) && boundary(at + form.length)) {
            if (!g.has(form)) g.set(form, []);
            g.get(form).push({ start: at, end: at + form.length });
          }
          at = text.indexOf(form, at + form.length);
        }
      }
      if (g.size >= 2) groups.push(g);
    }
  }
  const flagged = new Set();
  for (const g of groups) {
    const forms = [...g].sort((a, b) => b[1].length - a[1].length || a[1][0].start - b[1][0].start);
    const [preferred] = forms[0];
    for (const [form, list] of forms.slice(1)) for (const t of list) {
      if (flagged.has(t.start)) continue;
      flagged.add(t.start);
      add({ start: t.start, end: t.end, severity: 'suggestion', confidence: 0.8, ruleId: 'terminology.variant-mix',
        title: 'សរសេរពាក្យតែមួយពីរបែប',
        explanation: `ឯកសារនេះសរសេរ «${preferred}» ${g.get(preferred).length} ដង និង «${form}» ${list.length} ដង។ ទម្រង់ទាំងពីរអាចមើលទៅស្រដៀងគ្នា ប៉ុន្តែជាតួអក្សរខុសគ្នា។ គួរប្រើទម្រង់តែមួយ។`,
        suggestions: [preferred], autoFixSafe: true });
    }
  }

  // 2. Arabic and Khmer digits mixed
  const arabic = [...text.matchAll(/[0-9]+/g)], khmer = [...text.matchAll(/[\u17E0-\u17E9]+/gu)];
  if (arabic.length && khmer.length && /[\u1780-\u17FF]/u.test(text)) {
    const minority = arabic.length <= khmer.length ? arabic : khmer;
    const toKhmer = minority === arabic;
    for (const m of minority.slice(0, 20)) {
      const conv = toKhmer ? m[0].replace(/[0-9]/g, d => '០១២៣៤៥៦៧៨៩'[d]) : m[0].replace(/[\u17E0-\u17E9]/gu, d => String(d.codePointAt(0) - 0x17E0));
      add({ start: m.index, end: m.index + m[0].length, severity: 'suggestion', confidence: 0.6, ruleId: 'terminology.digits',
        title: 'លេខពីរប្រភេទ', explanation: `ឯកសារនេះប្រើទាំងលេខខ្មែរ និងលេខអារ៉ាប់។ គួរប្រើប្រភេទតែមួយ (ឯកសាររដ្ឋភាគច្រើនប្រើលេខខ្មែរ)។`,
        suggestions: [conv], autoFixSafe: false, humanReview: options.mode === 'legal' });
    }
  }

  // 3. Defined terms: «X» introduced by ហៅថា / តទៅនេះហៅថា / ហៅកាត់ថា; later near-variants are flagged.
  const defined = [];
  for (const m of text.matchAll(/(?:\u178F\u1791\u17C5\u1793\u17C1\u17C7\u17A0\u17C5\u1790\u17B6|\u178F\u1791\u17C5\u17A0\u17C5\u1790\u17B6|\u17A0\u17C5\u1780\u17B6\u178F\u17CB\u1790\u17B6|\u17A0\u17C5\u1790\u17B6|\u178A\u17C2\u179B\u17A0\u17C5\u1790\u17B6)\s*\u00AB([^\u00BB\n]{2,60})\u00BB/gu)) {
    defined.push({ term: m[1], key: wordKey(m[1]), at: m.index + m[0].length });
  }
  for (const d of defined) {
    const du = units(d.key);
    if (du.length < 3) continue;
    for (const m of text.matchAll(/\u00AB([^\u00BB\n]{2,60})\u00BB/gu)) {
      if (m.index + m[0].length <= d.at) continue;
      const k = wordKey(m[1]);
      if (k === d.key) continue;
      const dist = weightedDistance(units(k), du, 1.5);
      if (dist <= 1.5) {
        add({ start: m.index + 1, end: m.index + 1 + m[1].length, severity: 'warning', confidence: 0.7, ruleId: 'terminology.defined-term',
          title: 'ពាក្យកំណត់និយមន័យមិនស៊ីគ្នា',
          explanation: `ពាក្យ «${d.term}» ត្រូវបានកំណត់និយមន័យមុននេះ ប៉ុន្តែទីនេះសរសេរ «${m[1]}»។ ក្នុងឯកសារច្បាប់ ពាក្យកំណត់និយមន័យត្រូវសរសេរដូចគ្នាគ្រប់ទីកន្លែង។`,
          suggestions: [d.term], humanReview: true });
      }
    }
  }

  // 4. Synonym pairs in formal drafting
  if (['legal', 'government', 'administrative'].includes(options.mode)) {
    for (const [a, b] of LEGAL_SYNONYMS) {
      const ka = wordKey(a), kb = wordKey(b);
      const ia = text.indexOf(a), ib = text.indexOf(b);
      if (ia === -1 || ib === -1 || ka === kb) continue;
      const [first, second, at] = ia < ib ? [a, b, ib] : [b, a, ia];
      add({ start: at, end: at + second.length, severity: 'warning', confidence: 0.6, ruleId: 'terminology.synonym-mix',
        title: 'ពាក្យពីរសម្រាប់គំនិតតែមួយ',
        explanation: `ឯកសារនេះប្រើទាំង «${first}» និង «${second}»។ ក្នុងអត្ថបទផ្លូវការ ឬច្បាប់ អ្នកអានអាចយល់ថាជាមនុស្ស ឬវត្ថុពីរផ្សេងគ្នា។ ជ្រើសរើសពាក្យតែមួយ។`,
        suggestions: [first], humanReview: true });
    }
  }

  // 5. User terminology rules: preferred term with listed variants
  for (const rule of options.termRules || []) {
    for (const v of rule.variants || []) {
      if (!v) continue;
      let at = text.indexOf(v);
      while (at !== -1) {
        add({ start: at, end: at + v.length, severity: 'warning', confidence: 0.85, ruleId: 'terminology.user-rule',
          title: 'ពាក្យមិនត្រូវតាមសទ្ទានុក្រមរបស់អ្នក',
          explanation: `សទ្ទានុក្រមរបស់អ្នកកំណត់ឱ្យប្រើ «${rule.preferred}» ជំនួស «${v}»។`, suggestions: [rule.preferred], source: 'user', autoFixSafe: true });
        at = text.indexOf(v, at + v.length);
      }
    }
  }
  return out;
}
