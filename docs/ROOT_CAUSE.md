# Why the prototype missed an obvious Khmer mistake

## The failure

Type «ខ្ងុំទៅសាលារៀន។» into the prototype (`legacy/prototype-v0`). The first word should be «ខ្ញុំ», the commonest pronoun in the language, written with subscript ញ (្ញ), not subscript ង (្ង). The prototype reports nothing. It also passes «ពួកយើងបានពិនិត្សឯកសារ» («ពិនិត្យ» with the wrong final subscript) and «ខ្ញុំចង់ទិញកំព្យូទ័រ» («កុំព្យូទ័រ» missing its vowel). `tests/unit/regression.test.mjs` reproduces each case against the prototype's own `checker.js` before checking the new engine.

## The cause

The failure was not one missing word. Four design faults combined, and each would have hidden the error on its own.

**1. Spelling detection was a seven-item list.** `checker.js` raised a spelling error only for seven hard-coded pairs (`TYPO_PAIRS`: «សួរស្តី», «ពត៌មាន», «អនុញ្ញាតិ» and four more). Any other misspelling, however common, could not be detected, because no code compared words against a dictionary.

**2. The dictionary check was switched off and could not be switched on in practice.** The "unknown word" check (`includeUnknown`) was off by default, required a list of at least 1,000 words, and the app shipped only 70. A user had to find, download and import the Chuon Nath word list before the check did anything.

**3. When it did run, it cut words in the wrong places.** The fallback segmenter (`heuristicUnknownChunks`) moved through text one UTF-16 code unit at a time. Khmer is written in orthographic clusters: a consonant with its subscripts, vowels and signs. Cutting inside a cluster produced fragments such as «ិយាល៏យ», which begins with a dependent vowel and is not a possible Khmer string. Even then, the check offered no correction: it reported "not found" only.

**4. No Unicode normalisation.** Khmer that looks identical can be stored in different orders (ំ before ុ, coeng-ro before another subscript), and invisible characters such as a zero-width space can sit inside a word. The prototype matched raw strings, so «ពត​៌មាន» escaped even its own hard-coded pair.

The prototype's tests asserted only the seven pairs. They could not fail on any other misspelling, so they never revealed the gap.

## The fix

The new engine (`engine/`) replaces each faulty part:

| Prototype | KhmerProof 1.0 |
|---|---|
| Seven hard-coded pairs | 74,000-entry lexicon built from the Chuon Nath dictionary (16,995 headwords), words attested in its definitions, the SBBIC list and curated modern, legal and name lists, with each entry's source recorded |
| Dictionary check off by default | Always on; the lexicon ships with the app |
| Code-unit segmentation | Cluster-aware segmentation (`engine/tokenize.js`) that never splits a cluster, with a cost model preferring dictionary words |
| "Not found" without a suggestion | Khmer-aware weighted edit distance (`engine/lexicon.js`): a missing subscript counts as one edit; confusable letters (ិ/ី, ត/ថ, ញ/ង) cost less; candidates ranked by source and frequency |
| No normalisation | Cluster reordering to Unicode storage order, deprecated characters and invisible marks (`engine/normalize.js`) |
| Tests that only restate the rules | Regression tests against the old code, a gold corpus, a held-out set of human-written Khmer, and synthetic errors injected into that held-out text (`docs/EVALUATION.md`) |

An unknown word with no close dictionary match is still not called an error; it is reported as "not in dictionary", because absence from a 1967 dictionary does not prove a modern word is wrong.
