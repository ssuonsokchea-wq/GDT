// Unicode-level checks: cluster storage order, deprecated characters, stray marks,
// invisible and bidirectional control characters.

import { makeFinding } from '../finding.js';
import { CLUSTER_RE, normalizeCluster, describeNormalization, DEPRECATED } from '../normalize.js';

export function checkUnicode(ctx) {
  const { text } = ctx;
  const out = [];
  for (const m of text.matchAll(CLUSTER_RE)) {
    const orig = m[0];
    if (!/^[\u1780-\u17B3]/u.test(orig)) {
      out.push(makeFinding(text, {
        start: m.index, end: m.index + orig.length, category: 'unicode', severity: 'error', confidence: 0.85,
        ruleId: 'unicode.orphan-mark', layer: 'normalization',
        title: 'សញ្ញាអក្សរគ្មានតួអក្សរមេ',
        explanation: 'ស្រៈ ឬសញ្ញានេះមិនភ្ជាប់នឹងព្យញ្ជនៈទេ (ឧ. នៅក្រោយដកឃ្លា)។ ពិនិត្យថាតើមានដកឃ្លាលើស ឬវាយខុសលំដាប់។',
        suggestions: [], source: 'unicode',
      }));
      continue;
    }
    const norm = normalizeCluster(orig);
    if (norm !== orig) {
      out.push(makeFinding(text, {
        start: m.index, end: m.index + orig.length, category: 'unicode', severity: 'warning', confidence: 0.95,
        ruleId: 'unicode.cluster-order', layer: 'normalization',
        title: 'ការអ៊ិនកូដព្យាង្គមិនស្តង់ដារ',
        explanation: describeNormalization(orig).join('។ ') + '។ អក្សរអាចមើលទៅដូចគ្នា ប៉ុន្តែការស្វែងរក ការតម្រៀប និងការពិនិត្យអក្ខរាវិរុទ្ធនឹងខុស។',
        suggestions: [norm], source: 'unicode', autoFixSafe: true,
      }));
    }
  }
  for (const m of text.matchAll(/\u17D8/gu)) {
    out.push(makeFinding(text, {
      start: m.index, end: m.index + 1, category: 'unicode', severity: 'warning', confidence: 0.9,
      ruleId: 'unicode.deprecated', layer: 'normalization', title: 'តួអក្សរលែងប្រើ',
      explanation: 'សញ្ញា «៘» (U+17D8) លែងប្រើក្នុងយូនីកូដ។ ប្រើ «។ល។» ជំនួស។',
      suggestions: [DEPRECATED.get('\u17D8')], source: 'unicode', autoFixSafe: true,
    }));
  }
  for (const m of text.matchAll(/\u200B{2,}/gu)) {
    out.push(makeFinding(text, {
      start: m.index, end: m.index + m[0].length, category: 'unicode', severity: 'suggestion', confidence: 0.8,
      ruleId: 'unicode.zwsp-repeat', layer: 'normalization', title: 'សញ្ញាបំបែកពាក្យលាក់ច្រើនដង',
      explanation: 'មានសញ្ញាបំបែកពាក្យមើលមិនឃើញ (ZWSP) ជាប់គ្នាច្រើន។ មួយគ្រប់គ្រាន់។',
      suggestions: ['\u200B'], source: 'unicode', autoFixSafe: true,
    }));
  }
  for (const m of text.matchAll(/\uFFFD/gu)) {
    out.push(makeFinding(text, {
      start: m.index, end: m.index + 1, category: 'unicode', severity: 'error', confidence: 0.95,
      ruleId: 'unicode.replacement-char', layer: 'normalization', title: 'តួអក្សរខូច',
      explanation: 'តួអក្សរ U+FFFD បង្ហាញថាអត្ថបទដើមមានទិន្នន័យដែលមិនអាចអានបាន (ច្រើនកើតពីការបម្លែងពុម្ពអក្សរ ឬការចម្លងពី PDF)។ សូមពិនិត្យឯកសារដើម។',
      suggestions: [], source: 'unicode',
    }));
  }
  for (const m of text.matchAll(/[\u202A-\u202E\u2066-\u2069\u200E\u200F]/gu)) {
    out.push(makeFinding(text, {
      start: m.index, end: m.index + 1, category: 'unicode', severity: 'warning', confidence: 0.9,
      ruleId: 'unicode.bidi-control', layer: 'normalization', title: 'សញ្ញាគ្រប់គ្រងទិសអក្សរលាក់',
      explanation: 'មានសញ្ញាគ្រប់គ្រងទិសអត្ថបទដែលមើលមិនឃើញ។ វាអាចប្ដូរលំដាប់បង្ហាញអក្សរ ហើយមិនចាំបាច់ក្នុងអត្ថបទខ្មែរទេ។',
      suggestions: [''], source: 'unicode', autoFixSafe: true,
    }));
  }
  // Legacy-font (Limon/ABC) text decoded as Latin: many Latin letters and symbols but no Khmer.
  const latinRuns = text.match(/[A-Za-z\[\];'\\]{25,}/g) || [];
  if (latinRuns.length && !/[\u1780-\u17FF]/u.test(text) && text.length > 40) {
    out.push(makeFinding(text, {
      start: 0, end: Math.min(text.length, 40), category: 'unicode', severity: 'warning', confidence: 0.5,
      ruleId: 'unicode.legacy-font', layer: 'normalization', title: 'អាចជាពុម្ពអក្សរចាស់ (មិនមែនយូនីកូដ)',
      explanation: 'អត្ថបទនេះមិនមានអក្សរខ្មែរយូនីកូដទេ។ បើឯកសារដើមប្រើពុម្ពអក្សរ Limon ឬ ABC សូមបម្លែងទៅយូនីកូដជាមុនសិន។',
      suggestions: [], source: 'unicode',
    }));
  }
  return out;
}
