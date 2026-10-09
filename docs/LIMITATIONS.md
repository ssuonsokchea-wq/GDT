# Limitations

KhmerProof is useful now for catching misspellings, encoding faults, punctuation slips and a set of common grammatical confusions. It is not yet a complete Khmer grammar checker, and it should not be the last reader of a legal or official document. This page says where its evidence ends.

## Missing resources

| Resource | Status | Effect |
|---|---|---|
| Your Khmer grammar textbook (the 131-page scan the prototype cited) | **Not supplied** to this build: the upload contained only the prototype | No grammar rule is yet verified against it. Every grammar finding cites "KhmerProof grammar rule (not yet verified against the user-supplied grammar textbook)". The OCR and verification pipeline is ready; see [TEXTBOOK.md](TEXTBOOK.md). |
| NCKL approved terminology (nckl.rac.gov.kh) | **Not imported**: the build environment's network policy blocked both the NCKL site and its Facebook page | `data/curated/nckl.tsv` is empty. Users can import a list in the app; maintainers can add rows with references and rebuild. |
| A modern Khmer text corpus | Not available under a clear licence | The contextual frequency model uses the Chuon Nath definitions (about 576,000 words of 1967 Khmer). It knows little modern usage. |
| Review by a Khmer linguist | Not done | The curated lists (modern words, legal terms, names, misspellings, register advice, 161-item gold corpus) were written by the developer and need expert review. |

## What the engine cannot do well

- **Real-word errors.** When a typo produces another valid word («ពី» for «ពីរ», «នៅ» for «ទៅ»), a dictionary sees nothing wrong. Narrow rules catch «និង/នឹង» and «ដែល/ដែរ» in clear contexts; in the injected-error test they caught 17% of such swaps.
- **Grammar beyond its rules.** There is no full parser of Khmer syntax. The grammar layer recognises specific, documented patterns (listed in the README). A sentence may be ungrammatical in ways no rule describes.
- **Meaning and style.** "Unclear writing" means long sentences, stacked relative clauses, vague legal terms and similar measurable signs, not a judgement of what the writer meant.
- **Rare and archaic words, names and new coinages.** Words missing from all lists are shown as "not in dictionary" (information, not error). If such a word is one edit away from a dictionary word, it may be reported as a misspelling; the held-out test shows about 7 such false alarms per 1,000 words of 1967 dictionary prose. Add correct words to your personal list to silence them.
- **Variant spellings.** Chuon Nath and current official practice differ in places (ឲ្យ/ឱ្យ, ្ដ/្ត, ជំរាប/ជម្រាប). The modern-standard profile accepts the common variants and checks only that a document uses one form consistently. The strict profile follows Chuon Nath. Neither profile is an official ruling.
- **Confidence values** are set per rule from its evidence, then adjusted (for example, lowered when two corrections are equally close). They are not calibrated probabilities. The evaluation report shows how the rules performed on the test sets.

## Documents

- **PDF:** text extraction is only as good as the PDF. Scanned files need OCR. Files made with legacy fonts (Limon, ABC) contain no Khmer Unicode. Browser-only extraction (static hosting) damages many Khmer PDFs; the server's `pdftotext` handles more of them. Layout is never preserved.
- **DOCX:** the editor shows plain text. The corrected DOCX keeps formatting by writing accepted changes into the original runs. If you add or delete whole paragraphs by hand, it falls back to a plain document and says so. Tracked changes, comments, headers, footers and text boxes are not checked.
- **Size:** up to 300,000 characters per document; the AI review takes up to 6,000.

## Legal mode

Legal mode blocks one-click changes that alter negation, obligation, permission, «និង/ឬ», numbers, quoted defined terms or cross-references, and marks such suggestions for review by a person. It cannot know the law, the parties' intent or the drafting conventions of a particular ministry, court or firm. A qualified lawyer must review the final text.

## Measurement limits

The gold corpus was written alongside the rules, so its perfect score shows that intended behaviour works, not how often KhmerProof is right on new text. The injected-error test uses 6 to 57 trials per error type. A trustworthy accuracy figure needs a few hundred real sentences with errors, written and annotated by people outside the project.
