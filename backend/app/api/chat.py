"""Chat endpoints (PLAN §8): send a message and get the stored assistant reply."""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel, StrictStr

from ..chat import ChatService


class ChatRequest(BaseModel):
    """POST body. `message` is strict: a non-string is a malformed body (422)."""

    message: StrictStr


def create_chat_router(chat_service: ChatService) -> APIRouter:
    """Create the chat router bound to the given service (a new router per call)."""
    router = APIRouter(tags=["chat"])

    @router.post("/api/chat")
    async def chat(body: ChatRequest) -> dict:
        """Run one chat turn; returns the stored assistant message with its actions."""
        return await chat_service.handle(body.message)

    return router
