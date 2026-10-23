"""FastAPI application assembly.

The backend is a private sidecar, not a public service: it binds to loopback,
requires a per-launch token on every request, and allows no cross-origin
requests. Those three together are what make running an HTTP server inside a
desktop application reasonable.
"""

from __future__ import annotations

import asyncio
import logging

from fastapi import Depends, FastAPI, Request
from fastapi.responses import JSONResponse

from .. import API_VERSION, __version__
from ..core import db
from ..core.config import get_settings
from ..core.errors import AppError
from ..core.events import broker
from ..core.jobs import manager
from ..services import pipeline
from .deps import require_token
from . import routes_jobs, routes_media, routes_projects, routes_system, routes_tracks

log = logging.getLogger("subtitleforge")


def create_app() -> FastAPI:
    settings = get_settings()
    settings.ensure_dirs()

    app = FastAPI(
        title="SubtitleForge AI backend",
        version=__version__,
        docs_url="/docs",
        openapi_url="/openapi.json",
    )

    @app.on_event("startup")
    async def _startup() -> None:
        broker.bind_loop(asyncio.get_running_loop())
        db.get_connection()
        pipeline.register_all()
        manager._workers = max(1, settings.max_concurrent_jobs)
        manager.start()
        log.info("backend ready on %s:%s", settings.host, settings.port)

    @app.on_event("shutdown")
    async def _shutdown() -> None:
        manager.stop()
        from ..services.transcribe import unload_models

        unload_models()

    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(status_code=exc.status, content=exc.to_payload())

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception) -> JSONResponse:  # pragma: no cover
        log.exception("unhandled error")
        return JSONResponse(
            status_code=500,
            content={"error": {"code": "internal_error", "message": str(exc),
                               "hint": "The backend log in the app's logs folder has the stack trace."}},
        )

    @app.get("/")
    def root() -> dict:
        return {"name": "SubtitleForge AI", "version": __version__, "apiVersion": API_VERSION}

    guarded = [Depends(require_token)]
    prefix = f"/api/v{API_VERSION}"
    app.include_router(routes_system.router, prefix=prefix, dependencies=guarded)
    app.include_router(routes_media.router, prefix=prefix, dependencies=guarded)
    app.include_router(routes_projects.router, prefix=prefix, dependencies=guarded)
    app.include_router(routes_tracks.router, prefix=prefix, dependencies=guarded)
    app.include_router(routes_jobs.router, prefix=prefix, dependencies=guarded)
    return app
