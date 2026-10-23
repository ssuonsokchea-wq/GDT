"""Sortable identifiers.

A 26-character Crockford base32 ULID: 48 bits of millisecond timestamp followed
by 80 bits of randomness. Sorting rows by id therefore sorts them by creation
time, which keeps job lists and revision journals in order without an extra
index.
"""

from __future__ import annotations

import os
import time

_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def _encode(value: int, length: int) -> str:
    chars = []
    for _ in range(length):
        chars.append(_ALPHABET[value & 31])
        value >>= 5
    return "".join(reversed(chars))


def new_id(prefix: str = "") -> str:
    stamp = _encode(int(time.time() * 1000), 10)
    entropy = _encode(int.from_bytes(os.urandom(10), "big"), 16)
    ulid = stamp + entropy
    return f"{prefix}_{ulid}" if prefix else ulid
