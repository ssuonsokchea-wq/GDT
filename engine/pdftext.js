// Text extraction from PDF files with pdf.js (the library is passed in, so the same code
// runs in browsers and Node.js).
//
// Khmer PDFs are often unreliable sources of text:
//   - scanned PDFs have no text layer at all (OCR is needed first);
//   - PDFs made with legacy fonts (Limon, ABC) contain Latin letters, not Khmer Unicode;
//   - some generators store glyphs in visual order, so a pre-base vowel such as េ comes
//     out before its consonant. KhmerProof detects and repairs this case and warns.

const PREBASE = 'េែៃ'; // េ ែ ៃ
const VISUAL_ORDER = new RegExp(`(^|[^\\u1780-\\u17D3])([${PREBASE}])([\\u1780-\\u17A2](?:\\u17D2[\\u1780-\\u17A2])*)`, 'gu');
const RO_FIRST = /(^|[^ក-៓])(្រ)([ក-អ](?:្[ក-អ])?)/gu;

/** Count signs that the text was extracted in visual (not logical) order. */
export function visualOrderScore(text) {
  const khmer = (text.match(/[ក-៿]/gu) || []).length;
  if (!khmer) return 0;
  const bad = (text.match(VISUAL_ORDER) || []).length + (text.match(RO_FIRST) || []).length;
  return bad / Math.max(1, khmer / 10);
}

/** Move pre-base vowels and subscript RO back after the consonant cluster they belong to. */
export function repairVisualOrder(text) {
  return text
    .replace(VISUAL_ORDER, (m, pre, vowel, cluster) => pre + cluster + vowel)
    .replace(RO_FIRST, (m, pre, ro, cluster) => pre + cluster[0] + ro + cluster.slice(1));
}

/**
 * @param {object} pdfjs   the pdf.js module (getDocument)
 * @param {Uint8Array} bytes
 * @returns {Promise<{text:string, pages:number, warnings:string[]}>}
 */
export async function extractPdfText(pdfjs, bytes, { maxPages = 300 } = {}) {
  const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false, disableFontFace: true, useSystemFonts: false }).promise;
  const warnings = [];
  const pages = Math.min(doc.numPages, maxPages);
  if (doc.numPages > maxPages) warnings.push(`PDF មាន ${doc.numPages} ទំព័រ។ KhmerProof អានតែ ${maxPages} ទំព័រដំបូង។`);
  const parts = [];
  for (let p = 1; p <= pages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    let line = '', lastY = null;
    const lines = [];
    for (const item of content.items) {
      if (!('str' in item)) continue;
      const y = item.transform ? Math.round(item.transform[5]) : null;
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 2 && line) { lines.push(line); line = ''; }
      line += item.str;
      if (item.hasEOL) { lines.push(line); line = ''; }
      lastY = y;
    }
    if (line) lines.push(line);
    parts.push(lines.map(l => l.replace(/\s+$/u, '')).join('\n'));
  }
  await doc.destroy();
  let text = parts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!text) warnings.push('PDF នេះគ្មានស្រទាប់អត្ថបទ (ប្រហែលជាឯកសារស្កេន)។ សូមធ្វើ OCR ជាមុនសិន ឬចម្លងអត្ថបទមកបិទភ្ជាប់។');
  else if (!/[ក-៿]/u.test(text)) warnings.push('PDF នេះមិនមានអក្សរខ្មែរយូនីកូដទេ។ វាអាចប្រើពុម្ពអក្សរចាស់ (Limon/ABC) ដែលត្រូវបម្លែងជាមុន។');
  else if (visualOrderScore(text) > 0.5) {
    text = repairVisualOrder(text);
    warnings.push('អត្ថបទក្នុង PDF ត្រូវបានរក្សាទុកតាមលំដាប់បង្ហាញ។ KhmerProof បានតម្រៀបស្រៈឡើងវិញ ប៉ុន្តែសូមផ្ទៀងផ្ទាត់ជាមួយឯកសារដើម។');
  }
  if (text) warnings.push('ការដកអត្ថបទពី PDF មិនរក្សាប្លង់ ឬទ្រង់ទ្រាយដើមទេ។');
  return { text, pages, warnings };
}
