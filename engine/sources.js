// Source registry. Every finding cites one of these, so a reader can check the basis
// of a suggestion. Nothing here claims a page number that has not been verified.

export const SOURCES = {
  'chuon-nath': {
    km: 'វចនានុក្រមខ្មែរ សម្ដេចព្រះសង្ឃរាជ ជួន ណាត (វិទ្យាស្ថានពុទ្ធសាសនបណ្ឌិត ១៩៦៧) កំណែឌីជីថលរបស់វិទ្យាស្ថានបើកទូលាយ',
    en: 'Chuon Nath, Khmer Dictionary (Buddhist Institute, 1967), Open Institute digital edition (LGPL-2.1)',
    url: 'https://github.com/interscript/khmer-dict-spice',
    tier: 'authority',
  },
  'nckl': {
    km: 'ក្រុមប្រឹក្សាជាតិភាសាខ្មែរ រាជបណ្ឌិត្យសភាកម្ពុជា (ពាក្យបច្ចេកទេសដែលបានអនុម័ត)',
    en: 'National Council of Khmer Language, Royal Academy of Cambodia (approved terminology)',
    url: 'https://nckl.rac.gov.kh/',
    tier: 'authority',
  },
  'sbbic': {
    km: 'បញ្ជីពាក្យ SBBIC សម្រាប់ពិនិត្យអក្ខរាវិរុទ្ធ',
    en: 'SBBIC Khmer spelling word list (via khmer-dict-spice)',
    url: 'https://github.com/interscript/khmer-dict-spice',
    tier: 'attested',
  },
  'unicode': {
    km: 'ស្តង់ដារយូនីកូដ ជំពូក ១៦.៤ (អក្សរខ្មែរ) ស្ដីពីលំដាប់តួអក្សរក្នុងព្យាង្គ',
    en: 'The Unicode Standard, §16.4 Khmer (storage order of characters within a cluster)',
    url: 'https://www.unicode.org/versions/latest/ch16.pdf',
    tier: 'standard',
  },
  'curated-misspellings': {
    km: 'បញ្ជីកំហុសអក្ខរាវិរុទ្ធញឹកញាប់ របស់ KhmerProof (ពាក្យត្រឹមត្រូវផ្ទៀងផ្ទាត់នឹងវចនានុក្រម ជួន ណាត ឬបញ្ជីពាក្យដែលបានរៀបចំ)',
    en: 'KhmerProof list of frequent misspellings; each correction is checked against Chuon Nath or a curated list at build time',
    tier: 'project',
  },
  'edit-distance': {
    km: 'ការប្រៀបធៀបជាមួយពាក្យក្នុងវចនានុក្រម (ចម្ងាយកែសម្រួលតាមលក្ខណៈអក្សរខ្មែរ)',
    en: 'Khmer-aware weighted edit distance to dictionary entries',
    tier: 'method',
  },
  'project-grammar': {
    km: 'វិធានវេយ្យាករណ៍របស់ KhmerProof (មិនទាន់បានផ្ទៀងផ្ទាត់ជាមួយសៀវភៅវេយ្យាករណ៍ដែលអ្នកប្រើផ្ដល់ទេ)',
    en: 'KhmerProof grammar rule (not yet verified against the user-supplied grammar textbook)',
    tier: 'project',
  },
  'project-style': {
    km: 'ការណែនាំរចនាប័ទ្មរបស់ KhmerProof (ជម្រើសរចនាប័ទ្ម មិនមែនកំហុសដាច់ខាតទេ)',
    en: 'KhmerProof style guidance (a style choice, not an absolute error)',
    tier: 'project',
  },
  'project-legal': {
    km: 'ការណែនាំសំណេរច្បាប់របស់ KhmerProof (រក្សាន័យច្បាប់ដើម)',
    en: 'KhmerProof legal-drafting guidance (preserves the original legal meaning)',
    tier: 'project',
  },
  'context-bigram': {
    km: 'ភស្តុតាងប្រេកង់ពាក្យពីអត្ថបទនិយមន័យក្នុងវចនានុក្រម ជួន ណាត (ប្រហែល ៥៧៦,០០០ ពាក្យ)',
    en: 'Word-pair frequency evidence from the Chuon Nath definition corpus (~576,000 tokens)',
    tier: 'statistical',
  },
  'document': {
    km: 'ការប្រៀបធៀបក្នុងឯកសារតែមួយ',
    en: 'Comparison within this document',
    tier: 'method',
  },
  'textbook-unverified': {
    km: 'វិធាននេះមកពីគំរូមុន ដែលអះអាងថាផ្អែកលើសៀវភៅវេយ្យាករណ៍ភាសាខ្មែរ ទំព័រ PDF ១០៤។ មិនទាន់បានផ្ទៀងផ្ទាត់ទេ ព្រោះមិនមានសៀវភៅនោះក្នុងគម្រោងនេះ',
    en: 'Rule carried over from the previous prototype, which cited the grammar textbook, PDF p. 104. Not verified in this build: the textbook was not supplied.',
    tier: 'unverified',
  },
  'ai': {
    km: 'ការវិភាគបរិបទដោយម៉ូដែល AI (ស្រេចចិត្ត ត្រូវផ្ទៀងផ្ទាត់ដោយមនុស្ស)',
    en: 'Optional AI contextual review (requires human verification)',
    tier: 'model',
  },
  'user': {
    km: 'សទ្ទានុក្រមផ្ទាល់ខ្លួនរបស់អ្នកប្រើ',
    en: 'User glossary',
    tier: 'user',
  },
};

export function sourceRef(id, detail) {
  const s = SOURCES[id] || { km: id, en: id };
  return { id, km: s.km, en: s.en, url: s.url, detail: detail || null };
}
