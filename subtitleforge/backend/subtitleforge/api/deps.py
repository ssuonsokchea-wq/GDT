"""Request guards.

The backend listens on loopback only, but loopback is not a security boundary:
any process on the machine, and any page able to reach ``127.0.0.1``, could
otherwise drive it. Every request therefore carries a token the Electron main
process generated at launch and passed to both sides. Nothing else knows it.

The token normally travels in the ``X-SF-Token`` header. Two browser APIs
cannot set headers — ``<img>``/``<video>`` loads and ``EventSource`` — so a
``token`` query parameter is accepted as well. That is safe here because the
token lives for one application launch, never leaves the machine, and the only
routes reached that way are reads.
"""

from __future__ import annotations

import hmac

from fastapi import Header, HTTPException, Query, status

from ..core.config import get_settings


async def require_token(
    x_sf_token: str | None = Header(default=None),
    token: str | None = Query(default=None),
) -> None:
    expected = get_settings().token
    supplied = x_sf_token or token
    if not supplied or not hmac.compare_digest(supplied, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": {"code": "unauthorised", "message": "Missing or invalid session token"}},
        )
