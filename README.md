# KhmerProof

KhmerProof checks Khmer writing for spelling mistakes, grammar errors, faulty sentence structure, unsuitable word choices, missing or unnecessary words, punctuation, repetition, unclear sentences and inconsistent terminology. It explains each finding in Khmer, proposes a correction, shows how confident it is and where the judgement comes from, and lets you accept or reject each suggestion. It exports reports in PDF, Word, CSV and HTML.

Its spelling authority is the **Chuon Nath Khmer Dictionary** (Buddhist Institute, 1967), in the Open Institute's digital edition. It does not rely on a word list or an AI model alone: eight engine layers each contribute evidence, and an optional AI review is checked against them before you see it.

> **Status.** The software works and is tested, but its grammar rules have not yet been checked against your grammar textbook, which was not supplied with the project. Its curated word lists also need review by a Khmer linguist. Read [Limitations](docs/LIMITATIONS.md) before using it on legal or official documents.

## What you get

- **Interactive editor** that underlines findings by category, with a card for each finding: Khmer explanation, suggested corrections, confidence (high, medium or low, with a percentage), location and source. Accept or reject findings one at a time, with undo.
- **Five writing modes:** general, academic, government, administrative and legal. Legal mode never offers a one-click change that would alter negation, obligation, permission, «និង/ឬ», numbers, quoted defined terms or cross-references; such changes require confirmation by a person.
- **Two dictionary profiles:** modern standard (Chuon Nath plus modern terms; ្ដ/្ត and ឲ/ឱ variants accepted) and strict Chuon Nath.
- **Uploads:** TXT, DOCX and PDF. A corrected DOCX keeps the original file's fonts, styles and tables.
- **Reports** in PDF (with the Khmer font embedded), DOCX, CSV (UTF-8 for Excel) and HTML. Each finding lists the original passage, location, category, explanation, suggested correction, confidence and source.
- **Your own terms:** a personal word list, preferred-term rules (for example «កិច្ចសន្យា» instead of «កុងត្រា»), and an import slot for terminology approved by the National Council of Khmer Language (NCKL).
- **Command line:** `node bin/khmerproof.mjs check file.docx --mode legal --report pdf,csv`.

## Quick start

Requires [Node.js](https://nodejs.org/) 20 or later.

```bash
git clone https://github.com/ssuonsokchea-wq/GDT.git khmerproof
cd khmerproof
npm install
npm start            # then open http://localhost:8080
```

For PDF reports, run `npm run setup:pdf` once to download Chromium. For reliable PDF uploads, install Poppler (`pdftotext`). Step-by-step instructions for Windows are in [docs/WINDOWS.md](docs/WINDOWS.md). To publish the app as a public website, see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## How it checks text

| Layer | What it does | Code |
|---|---|---|
| 1. Unicode normalisation | Puts each cluster in Unicode storage order; flags deprecated, invisible and bidirectional characters, broken text and legacy-font text | `engine/normalize.js`, `engine/rules/unicode.js` |
| 2. Word segmentation | Splits text into words without ever cutting an orthographic cluster | `engine/tokenize.js` |
| 3. Dictionary lookup | 74,000 entries, each tagged with its sources and part of speech | `engine/lexicon.js`, `data/lexicon.json` |
| 4. Spelling | Curated misspellings; Khmer-aware edit distance to dictionary words; misspellings that split into valid-looking fragments | `engine/spelling.js` |
| 5. Grammar and structure | និង/នឹង, ដែល/ដែរ, word order, tense conflicts, ការ/សេចក្ដី, classifiers, incomplete correlatives, questions, repetition, long or tangled sentences | `engine/rules/grammar.js`, `engine/rules/style.js` |
| 6. Punctuation | ។ ៕ ៖ ៗ, quotation marks, spacing, Latin punctuation in Khmer text | `engine/rules/punctuation.js` |
| 7. Context | Word-pair frequencies from the Chuon Nath definitions rank corrections and support grammar rules; optional AI review | `engine/lexicon.js`, `server/ai-review.mjs` |
| 8. Terminology | Mixed spellings of one word, defined terms in legal text, synonym pairs, mixed digits, your preferred terms | `engine/rules/consistency.js` |

Every finding cites one of the sources in `engine/sources.js`. No rule claims a textbook page that has not been verified.

## Measured accuracy

`npm run evaluate` measures the engine on three test sets and writes [docs/EVALUATION.md](docs/EVALUATION.md). On 9 October 2026 it reported:

| Test | Result |
|---|---|
| Gold corpus: 161 sentences (63 errors, 99 correct sentences including modern vocabulary, proper names, legal and government text) | 63 of 63 errors found; 0 false alarms; correct suggestion ranked first every time |
| Human-written Khmer held out from the frequency model (603 phrases from Chuon Nath examples) | 10.7 flags per 1,000 words. Some are true errors in the source, such as 4 Unicode-order faults and «ចិញ្ជឹម»; most of the rest are rare words missing from both lists |
| Errors injected into that held-out text | Confusable letters: 96% detected, 89% corrected. Missing subscripts: 94% and 82%. Disordered Unicode: 100% and 98%. Real-word swaps (និង/នឹង, ដែល/ដែរ): 17% detected |

**Read the gold-corpus figure with care.** I (the developer) wrote that corpus while writing the rules, so a perfect score shows that the intended behaviour works; it does not predict accuracy on your documents. The held-out and injected-error figures are more realistic but come from small samples (6 to 57 trials per error type). The weakest point is errors that produce another real word, which a dictionary cannot see.

## Tests

```bash
npm test             # 24 unit and regression tests, including the prototype failure
npm run evaluate     # accuracy and false-alarm measurement
npm run test:e2e     # 12 browser tests in Chromium (run `npm run setup:pdf` first)
```

The prototype's failure, and its fix, are explained in [docs/ROOT_CAUSE.md](docs/ROOT_CAUSE.md).

## Privacy and security

- Text is checked **in your browser**. It goes to a server only when you agree, in a dialog, to server PDF generation, server PDF text extraction or the AI review. The server handles requests in memory and does not store or log document text.
- The optional AI review is **off** unless the server operator sets `KHMERPROOF_AI=on` and `ANTHROPIC_API_KEY`. The key is read from the server environment and never sent to the browser. Do not commit `.env`.
- The app loads nothing from third-party sites, has a strict Content Security Policy, escapes all text in reports and limits upload sizes, including protection against ZIP bombs in DOCX files.
- Only settings and your word lists are saved in the browser, never document text.

## Sources and licences

The dictionary data is licensed under LGPL-2.1 (`data/LICENSES/LGPL-2.1.txt`); the Noto Sans Khmer font under the SIL Open Font License. [docs/SOURCES.md](docs/SOURCES.md) lists every source, its licence and its status, including the NCKL terminology (not yet imported) and the grammar textbook (not supplied). **No licence has yet been chosen for the KhmerProof code itself.** Choose one before you publish the repository or the website.

## Project layout

```
engine/            language engine (runs in the browser and in Node.js)
public/            web app (index.html, app.js, worker.js, styles.css)
server/            Node server: static files, PDF reports, PDF text, optional AI
data/              built lexicon, curated lists, licences
scripts/           lexicon build, vendor copy, static build, textbook OCR
bin/               command-line checker
tests/             unit, regression and browser tests; gold corpus; evaluation
legacy/            the previous prototype, kept to reproduce its failure
docs/              root cause, evaluation, limitations, sources, Windows, deployment, textbook OCR
```
