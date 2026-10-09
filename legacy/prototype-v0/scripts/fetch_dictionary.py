"""Optional reference downloader. Run only on your own machine with internet.

Usage: python scripts/fetch_dictionary.py
Fetches a CSV attributed to Open Institute / Chuon Nath / interscript.
Review LGPL-2.1 source data licensing before redistribution.
"""
from pathlib import Path
from urllib.request import urlopen
URL = "https://raw.githubusercontent.com/interscript/khmer-dict-spice/main/kh_dictionary_words.csv"
DEST = Path(__file__).resolve().parent.parent / "kh_dictionary_words.csv"
with urlopen(URL, timeout=45) as source:
    data = source.read(8_000_000)
if len(data) < 10_000:
    raise RuntimeError("Dictionary download too small; inspect remote source")
DEST.write_bytes(data)
print(f"Saved {len(data):,} bytes to {DEST}")
print("In the KhmerProof website choose 'Import word list' and select this CSV.")
