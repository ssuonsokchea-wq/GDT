"""Error taxonomy shared with the renderer.

Every failure the user can plausibly cause gets a stable machine code so the UI
can show a specific recovery hint instead of a stack trace.
"""

from __future__ import annotations


class AppError(Exception):
    status = 400
    code = "app_error"

    def __init__(self, message: str, *, code: str | None = None, status: int | None = None, hint: str | None = None, details: dict | None = None):
        super().__init__(message)
        self.message = message
        if code:
            self.code = code
        if status:
            self.status = status
        self.hint = hint
        self.details = details or {}

    def to_payload(self) -> dict:
        return {
            "error": {
                "code": self.code,
                "message": self.message,
                "hint": self.hint,
                "details": self.details,
            }
        }


class NotFound(AppError):
    status = 404
    code = "not_found"


class Conflict(AppError):
    status = 409
    code = "conflict"


class UnsupportedMedia(AppError):
    status = 415
    code = "unsupported_media"


class ToolMissing(AppError):
    status = 503
    code = "tool_missing"


class ModelMissing(AppError):
    status = 503
    code = "model_missing"


class JobCancelled(AppError):
    status = 499
    code = "job_cancelled"
