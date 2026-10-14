# Turning the grammar textbook into verified rules

The grammar textbook was not included with the project, so no rule from it is implemented yet. This page describes how to add its rules so that each one can be traced to a page and a reviewer.

## 1. OCR the scan

Requirements: Python 3, Poppler (`pdftoppm`, `pdfinfo`) and Tesseract 4 or later with the Khmer model (`khm`). On Ubuntu: `apt install poppler-utils tesseract-ocr tesseract-ocr-khm`. On Windows: the UB Mannheim Tesseract installer with Khmer selected, plus Poppler (see [WINDOWS.md](WINDOWS.md)).

```bash
python scripts/ocr_textbook.py "សៀវភៅវេយ្យាករណ៍ភាសាខ្មែរ.pdf" --out private/textbook-ocr
```

The `private/` folder is ignored by Git. The scan and its text are under copyright and must not be committed.

The script writes page images, OCR text, word confidences, `verify.html` (each page image beside its OCR text, with low-confidence words highlighted) and `rules-template.tsv`.

**How good is the OCR?** On a synthetic scan of three Khmer sentences, rendered at 200 dpi and read back, Tesseract reached 92.3% character accuracy and read «ភ្ជាប់» as «ភ្លាប់» and «ខ្ញុំ» as «ខ្ញំ». Real scans of printed books are usually worse. OCR text is therefore a starting point for transcription, never a source to cite.

## 2. Verify each rule against the page image

For each rule worth implementing, a reviewer:

1. reads the rule on the page image, not only in the OCR text;
2. copies the rule wording, an example and, where the book gives one, a counter-example;
3. decides whether the rule can be checked by matching text (for example, a wrong word pair that has one right form), or whether it needs judgement;
4. records the PDF page, the printed page number, the section heading, their name and the date.

## 3. Add the rule to KhmerProof

Add a row to `data/curated/textbook-rules.tsv` (tab-separated):

| Column | Example |
|---|---|
| `rule_id` | `q-mark-1` |
| `pdf_page`, `printed_page`, `section` | `104`, `98`, `១.២ ល្បះសំណួរ` |
| `rule_text_km` | the rule as the book states it |
| `example_correct`, `example_incorrect` | from the book |
| `pattern_wrong`, `pattern_right` | the text to find and its replacement |
| `category` | `grammar`, `structure`, `wording`, `missing`, `unnecessary`, `punctuation`, `spelling` or `clarity` |
| `machine_checkable` | `yes` only if the pattern is reliable |
| `verified_by`, `verified_on` | the reviewer's name and the date |

Then run:

```bash
npm run build:data -- --source <path to a khmer-dict-spice checkout>   # or without --source to download it
npm test && npm run evaluate
```

The build loads a row only when `verified_by`, `pdf_page` and `pattern_wrong` are filled in and `machine_checkable` is `yes`. Each finding from such a rule cites "User-supplied Khmer grammar textbook (rule verified against the page image)" with the page numbers and the reviewer's name.

Rules that need judgement (word classes, sentence types, register) should become code in `engine/rules/grammar.js`, with tests in `tests/corpus/gold.jsonl` drawn from the book's own examples, and a source detail giving the page.
