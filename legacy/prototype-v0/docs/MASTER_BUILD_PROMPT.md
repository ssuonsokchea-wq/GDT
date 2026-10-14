# MASTER BUILD PROMPT — KHMERPROOF (GRAMMARLY-STYLE KHMER WRITING ASSISTANT)

> **Instruction for a software engineering AI/team:** Build a trustworthy, production-oriented, publicly accessible Khmer proofreading platform. Execute the work, not just the research. Do not misrepresent partial heuristics as comprehensive Khmer grammatical understanding. Start by auditing and extending the working KhmerProof prototype in the parent directory.

## 0. Goal, users, non-negotiable principles

Create a **Khmer-first**, mobile-responsive web app that lets any visitor type, paste or upload Khmer text; highlights precisely located issues directly in the editor; explains why a phrase may need attention; gives explicit accept/ignore controls; and exports a complete, professionally formatted **Flagged Errors Report** in HTML, CSV, DOCX and PDF. Permit a separately exported corrected document. Design for students, civil servants, authors, lawyers, teachers, and other professionals, with **General** and **Formal/Legal/Government** modes. Preserve authorial intent and legal meaning.

Core principles, ranked: **linguistic correctness > auditability > privacy > usability > attractive interface**. Never rewrite legal obligations, negation, quantities, dates, parties, definitions or names without clearly flagging the change for human review. Never auto-accept suggestions. Every finding needs a traceable reason and clear degree of uncertainty. If the engine cannot reliably determine whether a passage is wrong, report a *possible issue*, not a confirmed error.

## 1. Source hierarchy and provenance

1. **Chuon Nath Khmer dictionary** (វចនានុក្រមសម្ដេចព្រះសង្ឃរាជ ជួន ណាត), digitised by Open Institute, is a primary historical lexical authority for spelling, headwords and definitions. Initial public dataset: https://github.com/interscript/khmer-dict-spice (`kh_dictionary_words.csv` or `kh_dictionary.csv`). Publisher/project also described at https://www.open.org.kh/en/node/131. Confirm redistribution requirements (Open Institute describes LGPL 2.1) before bundling or republishing data; preserve credits and source revision.
2. **Contemporary usage**: incorporate a separately sourced, reviewed **modern Khmer terminology layer**, clearly distinguish verified official terminology, common contemporary vocabulary, proper names, and user-created project lexicons. Do NOT silently treat all modern words missing from Chuon Nath as errors. Review licences of all materials separately. The RAC 2022 lexicon available in third-party projects may have noncommercial data limitations—do not assume software licence applies to dictionary data.
3. **The user's scanned Khmer grammar reference**: `/mnt/data/សៀវភៅវេយ្យាករណ៍ភាសាខ្មែរ.pdf`, 131 PDF pages. It is image-based, not reliably searchable, so undertake page-by-page extraction/transcription with verification against images. Build a structured rule map (PDF page, printed page, original Khmer explanation, example, reviewer, confidence, permitted machine-check), and use the PDF only as reference unless redistribution rights are established. NEVER invent quotes or page numbers. Identify what the textbook teaches about morphology, word classes, syntax, sentence forms, punctuation, and when a written rule has exceptions. Do not claim every rule from the scanned book has already been implemented.
4. Other academic/official sources can be used as supplementary evidence only after documenting publisher, edition, date, URL, licence, scope and conflicts with primary sources.

Implement a **source hierarchy with selectable authority profiles**: Strict Chuon Nath (historical dictionary profile), Modern Standard Khmer (historic + vetted contemporary forms), Formal Government, and Legal/Academic (editable term base). Do not collapse variants into a universal *wrong/correct* judgement; explicitly show whether a recommendation is a strict dictionary preference, contemporary variant, grammatical rule, terminology convention or style choice.

## 2. Full linguistic pipeline

### Stage A. Input and preservation

- Accept UTF-8 plain text, DOCX, and eventually searchable PDF with appropriate permission/processing notices. Import DOCX while recording paragraph/run boundaries so issue offsets can map to original document structure. On export, preserve original formatting whenever technically possible; when not, warn prominently.
- Normalize encoding for **analysis** without destructively changing original Khmer text. Handle Khmer combining marks, COENG/subscript clusters, zero-width spaces, punctuation, legacy font encodings (only if an explicit conversion tool is added), mixed English/Khmer, numbers, quotations, names and honorifics.
- Store original text, original offsets, accepted edits, disabled rules and user dictionary per document. Enforce input size and safe parsing limits; never upload to cloud without explicit user opt-in.

### Stage B. Segmentation, morphology and lexical checking

- Use **grapheme/Khmer Character Cluster-aware** processing and evaluated Khmer word segmentation; do not split an orthographic cluster. Benchmark at least two candidate segmenters on independent gold-standard data (subject to dataset terms).
- Check spelling against the selected lexical authority with source-level provenance. Generate ranked correction candidates using Khmer-aware edit distance/confusion patterns and dictionary frequency only where licensed. Preserve proper names, technical vocabulary and dialectal/historical variants.
- Make unknown vocabulary a separate **UNVERIFIED** category: absence from one dictionary is insufficient to prove error.
- Handle inflection/compounding, reduplication, function particles, and multiword expressions only after developing reviewed rules and tests.

### Stage C. Khmer grammar and sentence structure

Check, where the evidence and validated technology allow:
- well-formed clause and sentence structure;
- subject–predicate relations; constituent placement; modifier attachment;
- use of nouns, verbs, classifiers, pronouns, particles, negation, aspect/time constructions, conjunctions, prepositions, questions and reported speech;
- inconsistent/incorrect connectors, unnecessary repetition, ambiguous referents, fragmented or overly long sentences;
- punctuation, paragraph organization, cohesion and consistent terminology;
- incorrect or contextually unsuitable vocabulary, redundant wording, register/style in government, academic and legal documents.

**Technical honesty:** An ordinary browser dictionary plus handcrafted regex rules CANNOT reliably recognize all Khmer grammar, meaning, pragmatics or subtle sentence-order faults. For true contextual checking, design a Khmer POS/syntactic analysis pipeline and evaluate self-hosted multilingual/Khmer language models against human-reviewed Khmer datasets. Model-generated suggestions must be *evidence-checked and confidence-calibrated*, may be disabled for confidential text, and never masquerade as normative grammar rules. Offline deterministic checks must still function if contextual models are unavailable.

### Stage D. Reliability and decision policy

For each candidate finding, store:
`finding_id, document_id, start_offset_UTF16, end_offset_UTF16, paragraph_id, original_text, category, severity, confidence, detection_type, rule_id, source_id, source_page_or_headword, explanation_km, explanation_en_optional, suggestion[], auto_fix_safe, human_review_required, authority_profile, version`.

Classify results as **verified mechanical errors**, **probable issues**, **contextual possibilities**, and **style/consistency preferences**. Never call an unknown word wrong. Suppress suggestions with weak evidence; support multiple accepted variants. When a user rejects an issue, avoid repeating it in the same context. Provide versioned, auditable rule packs and explanation tests.

## 3. Editor/UI requirements

- High-quality responsive interface, Khmer typography, adequate line height for Khmer marks, light/dark mode eventually, accessible keyboards and screen readers.
- Visual inline issue highlights with distinct categories, keyboard navigation, click-to-reveal explanations and traceable sources. Accurately highlight Unicode offsets even after edits. Respect IME composition and copy/paste.
- Right pane listing issues; filters by severity, grammar/spelling/style, confidence, and accepted/ignored states. Clicking a card scrolls to the exact text; accepting a suggestion updates text and reruns affected checks.
- User-selectable **General** vs **Formal/Legal** modes and dictionary authority profile; user glossary and do-not-change terminology list; configurable on-device retention.
- Prominent **privacy and capability notices**: spellcheck status, loaded dictionary size, status of contextual model, what is and is not checked, and confidence of individual findings.

## 4. Flagged Errors Report — MUST BE WORKING

From any reviewed document, export:

1. **HTML report** (portable, printable, with live Khmer fonts through OS fallbacks).
2. **CSV** in UTF-8 with BOM for Excel, one finding per row with clean quoted fields.
3. **DOCX** containing audit summary, explanation, source and the exact original passage.
4. **PDF**: direct validated Khmer-font embedding if legally available; otherwise explicit browser **Print → Save as PDF** while retaining rendered Khmer glyphs and page breaks. Never falsely label an HTML download a PDF.
5. **Separate corrected TXT/DOCX** containing ONLY edits the user accepted, plus an optional tracked-change copy that can be compared with the original.

Report structure: title, datetime, document hash/ID, scope and warnings, selected checking profile, dictionary/model versions, issue totals by category/severity, detailed table with sequential finding numbers, paragraph/sentence positions, original text, proposed wording, Khmer explanation, severity, confidence, source and precise page/headword if verified, status (accepted/rejected/unresolved), and full source text. Include an explicit section for unresolved uncertain findings. For PDF and Word, test Khmer shaping, headers/footers, line breaks, print pagination and font fallbacks. The report must NEVER invent rule citations or page numbers.

## 5. Deployment and architecture

**Phase 1—Static-first:** HTML/CSS/JavaScript frontend with a deterministic offline checker, privacy-first browser storage, safe TXT/DOCX imports, report exports, and optional lexical data import. Public deployment on GitHub Pages or Cloudflare Pages. No mandatory account or paid AI API. Use a clearly labelled demonstration lexicon when the full resource has not been loaded.

**Phase 2—Reliable linguistic services:** modular Khmer segmentation, dictionary indexes and rule execution; source manager; telemetry only opt-in with anonymized consent and never raw private writings. If an external API is needed, create a transparent self-hostable server with rate limits, audit logs excluding user content, scalable queues and privacy protections; publish a deployment cost model.

**Phase 3—Contextual grammar:** reviewed Khmer gold corpus; annotation guidelines; academic and government partnerships; optional self-hosted contextual models; grammar evaluation (precision, recall, false alarms per 1,000 words, confidence calibration, meaning-preservation). Human reviewer workflow and regression suite by topic, register and dialect.

**Phase 4—Publication-grade:** track changes in DOCX, source-rich reports, browser extension, collaboration only by opt-in, versioned linguistic authority and legal citation verification.

Never assume that free static hosting means unlimited model processing or unlimited site traffic without restrictions. Separate operating costs from user-facing prices.

## 6. Copyright, privacy and safety

- Review dictionary licences separately from code licences and dataset-specific noncommercial restrictions. Do not package copyrighted grammar-book scans, modern dictionaries or closed fonts without distribution permission.
- Privacy by default: all on-device analysis for phase 1, no analytics, no external text transmission. Dictionary *downloads* may contact hosting/CDN but must not transmit the writing itself.
- Harden all text rendering against XSS: textContent/escaping, input limits, safe DOCX ZIP/XML parsing, zip bomb limits, no untrusted HTML injection, no eval. Provide content security policy when deploying.
- Legal documents: protect parties' names, dates, amounts, cross-references, negation, jurisdiction-specific terminology and confidentiality; show explicit warnings for semantic alterations.
- QA should cover Khmer shaping, Unicode combining marks, Chrome/Edge/Firefox/Safari, mobile, long and empty documents, right-to-left embedded foreign text, tables, corrupted DOCX, whitespace and line break interactions.

## 7. Deliverables and acceptance tests

Deliver runnable source code, dependency manifest (or prove no dependencies), verified source/licence ledger, local Windows/macOS instructions, free hosting instructions, source-specific limitations, unit/integration and accessibility tests, reports and sample annotated Khmer text.

Acceptance tests MUST demonstrate: (a) an incorrect sample word is underlined, (b) a suggested fix changes precisely that span, (c) the user can ignore a finding, (d) a sample sentence-order heuristic is labelled as a *heuristic* rather than universally authoritative, (e) formal mode changes appropriately, (f) TXT and DOCX upload work and layout-loss warning appears, (g) CSV/HTML/DOCX export opens and retains Khmer, (h) PDF Print/Save works, (i) full dictionary loading via authorised source or local import succeeds, (j) incorrect or unavailable dictionary data does not produce false claims, (k) text never leaves the browser unless explicitly consented, (l) no fake textbook references.

## 8. Execution command

**Start now:** inventory existing files; inspect and run tests; fix defects; implement the highest-value missing feature completely; execute browser tests using a real browser; evaluate behaviour on Khmer examples drawn from human-verified material; document remaining accuracy gaps. Do not stop at architecture discussion. Be explicit about what is already delivered and what still needs linguistic research and data licensing.

---

### Status of the accompanying implementation (first prototype)

The accompanying static site implements: responsive HTML editor, live marks, several auditable preliminary rules, example sentence-order detection, experimental dictionary-not-found mode after import, manual correction/ignore, TXT and simple DOCX upload, HTML/CSV/DOCX reports, browser Print/Save as PDF and editable source. **Not yet delivered:** genuine comprehensive grammar parsing, a comprehensively vetted textbook rule set (only a limited question-punctuation example from PDF page 104 is referenced), comprehensive modern lexical corpus, original DOCX formatting preservation, automatic model-based sentence restructuring, direct embedded-font PDF generation, user accounts, browser extension, production monitoring and large-scale reliability validation.
