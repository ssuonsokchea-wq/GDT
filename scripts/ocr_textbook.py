#!/usr/bin/env python3
"""OCR a scanned Khmer grammar textbook and prepare it for page-by-page verification.

Usage:
    python scripts/ocr_textbook.py <textbook.pdf> [--out private/textbook-ocr] [--first 1] [--last 131] [--dpi 300]
    python scripts/ocr_textbook.py --score <ocr.txt> <reference.txt>     # character accuracy

Requires Poppler (pdftoppm) and Tesseract 4+ with the Khmer model (khm.traineddata).
Windows: install Tesseract (UB Mannheim build) with the Khmer language selected, and
Poppler; add both bin folders to PATH, or set TESSERACT and PDFTOPPM to the executables.

Output (keep it out of Git: the scan and its text are copyrighted):
    pages/p001.png        the page image, for checking OCR against the original
    pages/p001.txt        OCR text
    pages/p001.tsv        word boxes with Tesseract confidence
    index.json            per-page mean confidence and low-confidence word counts
    verify.html           side-by-side page image and OCR text, low-confidence words marked
    rules-template.tsv    the form in which verified rules enter KhmerProof

Nothing in this script decides what the textbook says. A person must read each page
image, correct the OCR text, and copy rules into data/curated/textbook-rules.tsv with
the PDF page, the printed page and the reviewer's name. The lexicon build refuses rule
rows that lack a reviewer.
"""
import argparse
import csv
import html
import json
import os
import shutil
import statistics
import subprocess
import sys
import unicodedata
from pathlib import Path

TESSERACT = os.environ.get("TESSERACT", "tesseract")
PDFTOPPM = os.environ.get("PDFTOPPM", "pdftoppm")
RULE_FIELDS = ["rule_id", "pdf_page", "printed_page", "section", "rule_text_km", "example_correct", "example_incorrect",
               "pattern_wrong", "pattern_right", "category", "machine_checkable", "verified_by", "verified_on", "notes"]


def need(cmd):
    if shutil.which(cmd) is None:
        sys.exit(f"Cannot find '{cmd}'. Install it or set the environment variable (see --help).")


def page_count(pdf):
    out = subprocess.run(["pdfinfo", str(pdf)], capture_output=True, text=True)
    for line in out.stdout.splitlines():
        if line.startswith("Pages:"):
            return int(line.split()[1])
    return None


def ocr_page(png, base):
    # --psm 4: a single column of text of variable sizes, which suits textbook pages.
    subprocess.run([TESSERACT, str(png), str(base), "-l", "khm+eng", "--psm", "4", "txt", "tsv"],
                   check=True, capture_output=True)
    words, confs = [], []
    with open(f"{base}.tsv", encoding="utf-8") as fh:
        for row in csv.DictReader(fh, delimiter="\t", quoting=csv.QUOTE_NONE):
            text = (row.get("text") or "").strip()
            try:
                conf = float(row.get("conf", -1))
            except ValueError:
                conf = -1
            if text and conf >= 0:
                words.append((text, conf))
                confs.append(conf)
    return words, (statistics.mean(confs) if confs else 0.0)


def write_verify_html(out, pages):
    parts = ["<!doctype html><html lang='km'><meta charset='utf-8'><title>OCR verification</title>",
             "<style>body{font-family:'Noto Sans Khmer','Khmer OS Siemreap',sans-serif;margin:16px}"
             ".p{display:grid;grid-template-columns:1fr 1fr;gap:16px;border-top:2px solid #0b5cad;padding:12px 0}"
             "img{width:100%;border:1px solid #ccc}pre{white-space:pre-wrap;font-family:inherit;font-size:16px;line-height:1.9}"
             ".low{background:#ffe08a}</style>",
             "<h1>Textbook OCR — verify every rule against the page image</h1>"
             "<p>Words highlighted in yellow had Tesseract confidence below 70.</p>"]
    for p in pages:
        low = {w for w, c in p["words"] if c < 70}
        text = html.escape(p["text"])
        for w in sorted(low, key=len, reverse=True):
            text = text.replace(html.escape(w), f"<span class='low'>{html.escape(w)}</span>")
        parts.append(f"<section class='p' id='p{p['page']}'><div><h2>PDF page {p['page']} · mean confidence {p['confidence']:.0f}</h2>"
                     f"<img src='pages/{p['name']}.png' alt='page {p['page']}'></div><pre>{text}</pre></section>")
    (out / "verify.html").write_text("\n".join(parts), encoding="utf-8")


def char_accuracy(ocr, ref):
    """1 - (Levenshtein distance / reference length), on NFC text without whitespace."""
    a = "".join(unicodedata.normalize("NFC", ocr).split())
    b = "".join(unicodedata.normalize("NFC", ref).split())
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i] + [0] * len(b)
        for j, cb in enumerate(b, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb))
        prev = cur
    return max(0.0, 1 - prev[-1] / max(1, len(b)))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pdf", nargs="?")
    ap.add_argument("--out", default="private/textbook-ocr")
    ap.add_argument("--first", type=int, default=1)
    ap.add_argument("--last", type=int)
    ap.add_argument("--dpi", type=int, default=300)
    ap.add_argument("--score", nargs=2, metavar=("OCR", "REFERENCE"))
    args = ap.parse_args()

    if args.score:
        acc = char_accuracy(Path(args.score[0]).read_text(encoding="utf-8"), Path(args.score[1]).read_text(encoding="utf-8"))
        print(f"character accuracy: {acc:.3f}")
        return
    if not args.pdf:
        ap.error("give the textbook PDF")
    need(TESSERACT)
    need(PDFTOPPM)
    pdf = Path(args.pdf)
    out = Path(args.out)
    (out / "pages").mkdir(parents=True, exist_ok=True)
    last = args.last or page_count(pdf) or args.first
    pages = []
    for n in range(args.first, last + 1):
        name = f"p{n:03d}"
        base = out / "pages" / name
        subprocess.run([PDFTOPPM, "-r", str(args.dpi), "-gray", "-png", "-singlefile", "-f", str(n), "-l", str(n), str(pdf), str(base)], check=True)
        words, conf = ocr_page(f"{base}.png", base)
        text = Path(f"{base}.txt").read_text(encoding="utf-8")
        pages.append({"page": n, "name": name, "confidence": conf, "words": words, "text": text})
        print(f"page {n}: mean confidence {conf:.1f}, {sum(1 for _, c in words if c < 70)} low-confidence words", flush=True)
    index = [{"page": p["page"], "confidence": round(p["confidence"], 1), "words": len(p["words"]),
              "low_confidence_words": sum(1 for _, c in p["words"] if c < 70)} for p in pages]
    (out / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
    write_verify_html(out, pages)
    with open(out / "rules-template.tsv", "w", encoding="utf-8", newline="") as fh:
        csv.writer(fh, delimiter="\t").writerow(RULE_FIELDS)
    print(f"Wrote {out}/verify.html and {out}/rules-template.tsv")


if __name__ == "__main__":
    main()
