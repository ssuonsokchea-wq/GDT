"""Backend entry point.

Started by the Electron main process, which reads the first line of stdout to
learn the port and token. Also runnable by hand for development:

    python -m subtitleforge --port 8756 --token dev
"""

from __future__ import annotations

import argparse
import json
import logging
import socket
import sys
from pathlib import Path

from .core.config import Settings, set_settings


def _free_port(host: str) -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind((host, 0))
        return sock.getsockname()[1]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="subtitleforge", description="SubtitleForge AI backend")
    parser.add_argument("--host", default=None)
    parser.add_argument("--port", type=int, default=None)
    parser.add_argument("--token", default=None)
    parser.add_argument("--data-dir", default=None)
    parser.add_argument("--ffmpeg", default=None)
    parser.add_argument("--ffprobe", default=None)
    parser.add_argument("--max-jobs", type=int, default=None)
    parser.add_argument("--log-level", default=None)
    args = parser.parse_args(argv)

    settings = Settings.from_env(
        host=args.host,
        port=args.port,
        token=args.token,
        data_dir=Path(args.data_dir) if args.data_dir else None,
        max_concurrent_jobs=args.max_jobs,
        log_level=args.log_level,
    )
    if args.ffmpeg:
        settings.ffmpeg = args.ffmpeg
    if args.ffprobe:
        settings.ffprobe = args.ffprobe
    if not settings.port:
        settings.port = _free_port(settings.host)
    settings.ensure_dirs()
    set_settings(settings)

    logging.basicConfig(
        level=getattr(logging, settings.log_level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
        handlers=[
            logging.FileHandler(settings.logs_dir / "backend.log", encoding="utf-8"),
            logging.StreamHandler(sys.stderr),
        ],
    )

    import uvicorn

    from .api.app import create_app

    # The handshake: one JSON line on stdout, flushed, before the server loop
    # starts. Electron waits for it rather than polling a guessed port.
    print(
        json.dumps({"event": "ready", "host": settings.host, "port": settings.port, "token": settings.token,
                    "dataDir": str(settings.data_dir)}),
        flush=True,
    )
    uvicorn.run(
        create_app(),
        host=settings.host,
        port=settings.port,
        log_level=settings.log_level,
        access_log=False,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
