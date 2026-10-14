# Sources and licences

Every finding in KhmerProof names its source (`engine/sources.js`). This ledger records where each source comes from, its licence and how it is used.

## Language data

| Source | Version | Licence | Use in KhmerProof | Precedence |
|---|---|---|---|---|
| **Chuon Nath Khmer Dictionary** (វចនានុក្រមខ្មែរ, Buddhist Institute, 1967), digitised by the Open Institute under the USAID-funded SPICE programme | `github.com/interscript/khmer-dict-spice`, commit `85f37da`, files `kh_dictionary_words.csv` and `kh_dictionary.csv` | LGPL-2.1, as stated by the Open Institute and the repository (`data/LICENSES/LGPL-2.1.txt`) | 16,995 headwords (spelling authority); part of speech from definition tags such as (ន.) and (កិ.); 1,243 further words attested at least 5 times in definitions; word and word-pair frequencies; 603 held-out example phrases for testing | Highest after NCKL and your own list |
| **SBBIC Khmer word list** (`SBBICkm_KH.txt`) | Same repository and commit | Distributed in the same LGPL-2.1 repository; the original SBBIC licence was not independently verified | 74,077 words that make a word "attested". These words carry less weight than Chuon Nath: when two corrections are equally close, the Chuon Nath word ranks first, and fragments found only here count as weak evidence during segmentation. The list contains some common misspellings (e.g. អោយ, អនុញ្ញាតិ), which the curated misspelling list overrides. | Lowest |
| **National Council of Khmer Language** (ក្រុមប្រឹក្សាជាតិភាសាខ្មែរ), Royal Academy of Cambodia | <https://nckl.rac.gov.kh/> | Terms of use not reviewed | **Not yet imported**: the build environment could not reach the site. Approved terms can be added to `data/curated/nckl.tsv` (with a reference for each) or imported by users in the app. They outrank every other modern source. | Highest |
| **User-supplied Khmer grammar textbook** (`សៀវភៅវេយ្យាករណ៍ភាសាខ្មែរ.pdf`, 131 scanned pages, as described by the prototype) | **Not supplied** to this build | Copyright of its author or publisher; do not redistribute the scan | No rule implemented yet. Verified rules enter through `data/curated/textbook-rules.tsv`, citing PDF page, printed page and reviewer ([TEXTBOOK.md](TEXTBOOK.md)). The prototype's question-mark rule claimed PDF p. 104; it is kept but cited as **unverified**. | Authority, once verified |
| **KhmerProof curated lists** (`data/curated/*.tsv`) | This repository | Same as the KhmerProof code | Function words (127), modern vocabulary (154), legal terms (115), proper names (45), common misspellings (20), register advice (13), wordy phrases and contradictions (11), ការ/សេចក្ដី pairs (11). Written by the developer; **need expert review**. The build checks that every curated correction is a Chuon Nath headword or a curated term. | Between Chuon Nath and SBBIC |

The legal term list was compiled from terms as commonly used in the Constitution of the Kingdom of Cambodia, the Civil Code (2007), the Code of Civil Procedure (2006) and the Labour Law. Individual entries were not checked against official gazette copies.

## Software and fonts

| Component | Licence | Use |
|---|---|---|
| Noto Sans Khmer (`@fontsource/noto-sans-khmer`) | SIL Open Font License 1.1 | Web font and the font embedded in PDF reports |
| pdf.js (`pdfjs-dist` 4.10.38) | Apache-2.0 | PDF text extraction in the browser |
| fflate 0.8.3 | MIT | ZIP for DOCX import and export |
| playwright-core 1.56.1 | Apache-2.0 | Headless Chromium for PDF reports |
| @anthropic-ai/sdk 0.132.1, zod 3.25.76 | MIT | Optional AI review |
| Poppler `pdftotext` (external) | GPL-2.0 or later | Server-side PDF text extraction, run as a separate program |
| Tesseract with the `khm` model (external) | Apache-2.0 | Textbook OCR |

## Standards

- The Unicode Standard, chapter 16.4 (Khmer): storage order within an orthographic cluster, deprecated characters. Normalisation follows the same ordering as the widely used *khnormal* algorithm (M. Hosken, SIL).

## Redistribution checklist

When you publish the app or its data: keep `data/LICENSES/LGPL-2.1.txt` with `data/lexicon.json` (the static build copies it); keep the credit to the Open Institute and the Buddhist Institute (about page and reports); do not publish the grammar-textbook scan or its full OCR text without permission; and check the NCKL terms of use before importing its terminology in bulk.
