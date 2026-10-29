"""Domain errors and the `{"error": message}` response envelope (PLAN §8).

Business-rule failures raise `DomainError` (400); missing resources raise
`NotFoundError` (404). The chat service alone raises `ChatUnavailableError` (503)
and `LLMFailedError` (502); never a service the chat executor calls, because the
executor records any `DomainError` from a service as a failed action. Malformed
request bodies keep FastAPI's default 422.
"""

from __future__ import annotations

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class DomainError(Exception):
    """A business-rule failure; mapped to 400 `{"error": message}`."""

    status_code = 400

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class NotFoundError(DomainError):
    """A missing resource; mapped to 404 `{"error": message}`."""

    status_code = 404


class ChatUnavailableError(DomainError):
    """The AI assistant is not configured; mapped to 503. Raised only by ChatService."""

    status_code = 503


class LLMFailedError(DomainError):
    """The LLM call failed or its reply was unreadable; mapped to 502. Raised only by ChatService."""

    status_code = 502


async def _domain_error(request: Request, exc: DomainError) -> JSONResponse:
    return JSONResponse({"error": exc.message}, status_code=exc.status_code)


async def _http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    return JSONResponse(
        {"error": exc.detail}, status_code=exc.status_code, headers=getattr(exc, "headers", None)
    )


def error_handlers() -> dict:
    """Exception handlers for `FastAPI(exception_handlers=...)`.

    RequestValidationError is deliberately absent: FastAPI's default 422 stays.
    """
    return {
        DomainError: _domain_error,
        NotFoundError: _domain_error,
        ChatUnavailableError: _domain_error,
        LLMFailedError: _domain_error,
        StarletteHTTPException: _http_error,
    }
