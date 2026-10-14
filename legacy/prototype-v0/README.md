# KhmerProof — Khmer Writing Assistant (Working Prototype)

KhmerProof is a **static, browser-only** Khmer proofreading prototype. It highlights possible spelling, Unicode, punctuation, stylistic, terminological and limited grammatical issues; lets users accept/ignore them; supports plain text and DOCX upload; and exports complete flagged-issue reports.

**Important:** This is **not** a full Khmer grammar parser and should not be trusted to certify the correctness of a legal or government document. The project does not silently upload writing to a server. No paid AI API is necessary.

## How to run (Windows, macOS, Linux)

1. Unzip the project while preserving its directory structure.
2. Double-click `index.html` in a modern browser. The starter checker, uploads and exports work without hosting.
3. Alternatively, open a terminal in the project directory and run `python -m http.server 8080` (Windows users may use `py -m http.server 8080`) then open **http://localhost:8080**.
4. Click **សាកល្បងឧទាហរណ៍** (Sample) to try the included intentionally imperfect Khmer text.
5. Use the right-hand result cards to jump to a flagged passage. Choose **ទទួលយក** (accept suggestion) or **មិនអើពើ** (ignore). You can select **ផ្លូវការ / ច្បាប់** (Formal/Legal) for additional register suggestions.
6. For larger lexical coverage, select **ផ្ទុកបញ្ជីពាក្យជួន ណាត** to fetch the source word list. If the source is unavailable or blocks cross-origin downloads, download `kh_dictionary_words.csv` manually from the dictionary repository and import it using **នាំចូលបញ្ជីពាក្យផ្ទាល់ខ្លួន**.
7. Export the full flagged report as **HTML, CSV or Word (DOCX)**. Use the PDF button and select **Print → Save as PDF** in your browser. TXT exports the **current reviewed text**, incorporating only corrections the user accepted.

## Where the data comes from

- Chuon Nath dictionary source project: https://github.com/interscript/khmer-dict-spice (word list: `kh_dictionary_words.csv`). Digitised by Open Institute as part of SPICE; project states LGPL 2.1 data terms. The **full dictionary is not bundled**; user may fetch/import it. We do not claim that this dictionary headword list provides contextual grammar checking, definitions or sentence-structure rules.
- Open Institute publisher note: https://www.open.org.kh/en/node/131.
- Grammar reference shared by the user: `សៀវភៅវេយ្យាករណ៍ភាសាខ្មែរ.pdf` (131-page scanned image PDF). This scan **is not redistributed inside the ZIP**. Its rules have **not** been transcribed and verified comprehensively. **One limited punctuation suggestion** is grounded in the examples for interrogative sentences on **PDF page 104, section 1.2** (question marks in sample questions); it remains an optional heuristic, not a compulsory rule. No other claim of systematic textbook implementation is made. Incorporating them in a future normative grammar engine requires transcription, editorial review and copyright clearance for republication.
- Modern lexicon: the prototype includes a **small illustrative modern starter vocabulary** and allows user-imported word lists. No broad modern standard dictionary is bundled. Do not mix in third-party data without checking its separate licence.
- Source of rule descriptions: project-authored heuristic rules (explicitly labelled), not verbatim statements from Chuon Nath or the textbook.

## Feature status

| Feature | State | Limitations |
|---|---|---|
| Browser text editor + underlines | Working | Layered textarea uses same-font positioning; complex shaping/overlaps merit more visual QA |
| Typos | Working on short starter pairs | Not full vocabulary detection; some suggestions need human verification |
| Khmer sentence structure | Illustrative example rule + optional question punctuation from textbook PDF p. 104 | Not a Khmer syntactic or semantic parser |
| Formal/legal register | A few cautious suggestions | Not an official drafting standard |
| Unicode and punctuation | Basic clear patterns | No exhaustive Unicode normalisation, OCR or legacy-font conversion |
| Dictionary import | CSV/TXT/JSON and remote fetch | Historic coverage; unknown-word segmentation experimental; source may be offline |
| Modern vocabulary | Starter + custom uploaded list | Not a full authoritative contemporary corpus |
| DOCX import | Paragraph text extraction | Original formatting, tables, comments and tracked changes not faithfully preserved |
| Download HTML, CSV, DOCX report | Working | DOCX report is simple, rather than publication-grade typesetting |
| PDF report | Browser Print/Save | No direct one-click PDF download or bundled font; verify Khmer rendering locally |
| Corrected text | Current editor → TXT | Automated tracked-change DOCX export not implemented |
| Public accessibility | Ready to host | Requires you to deploy; not already published |
| Data privacy | Browser processing only | Dictionary fetch contacts GitHub; exported files remain on your device |

**Confidence labels:** these are preliminary rule confidence levels (not statistically calibrated probabilities). An unknown word is never called a confirmed error. Historic dictionary membership is evidence that the word exists, not evidence that the sentence is grammatically correct.

## Deploy free for public visitors

1. Create a GitHub repository with the contents of this folder (do **not** upload personal or confidential writings).
2. In GitHub repository Settings → Pages, choose Deploy from a branch and set root (`/`), or upload the folder to Cloudflare Pages.
3. The site will work on a public HTTPS URL with no custom domain requirement. Custom domains are optional and may cost money.
4. Test remote dictionary fetching on the deployed origin. If third-party hosting blocks it, download the source word list and host it only after reviewing the applicable redistribution/licence requirements.
5. Add your own Privacy, Terms and correction-source policy before using it as a public professional service.

## Files

- `index.html` — interface
- `style.css` — responsive visual system
- `checker.js` — deterministic issue checker and lexicon reader
- `docx.js` — small browser DOCX ZIP/XML import and report export
- `app.js` — editor UI, file IO and downloads
- `docs/MASTER_BUILD_PROMPT.md` — comprehensive full-platform engineering prompt and roadmap
- `tests/engine.test.mjs` — JavaScript regression tests
- `scripts/fetch_dictionary.py` — OPTIONAL local reference-data retrieval on a machine with internet

## Limits / safe use

The feature that flags words absent from an imported dictionary is disabled by default and intentionally labelled **experimental**. It uses a very simple greedy approximation rather than a validated Khmer word segmenter and can yield false alarms. Long sentences without visible punctuation are flagged only as readability suggestions. Do not deploy for automated legal document revision without independent Khmer linguistic evaluation.

The prototype uses no tracking code or backend endpoints. The only network access in the app is when the user explicitly chooses remote dictionary loading. Browser storage may keep the imported dictionary (but not edited text).

## Testing

`node tests/engine.test.mjs`

For browser-level behaviour, host with `python -m http.server 8080` and verify in Chrome or Edge. The DOCX ZIP helper requires `DecompressionStream('deflate-raw')`, which may not exist in older browsers.
