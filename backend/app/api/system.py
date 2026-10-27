"""System endpoints: health check (PLAN §8)."""

from __future__ import annotations

from fastapi import APIRouter


def create_system_router() -> APIRouter:
    """Create the system router (a new router per call)."""
    router = APIRouter(tags=["system"])

    @router.get("/api/health")
    async def health() -> dict:
        """Liveness check. Touches neither SQLite nor the market source."""
        return {"status": "ok"}

    return router
