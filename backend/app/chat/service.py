"""The chat turn (PLAN §9 "How It Works"): store, ask the LLM, parse, execute, store, return.

`ChatService.handle` stores the user message, asks the LLM client for raw reply
text, parses it, runs the requested actions through the existing services, stores
the assistant message with its actions and returns that stored row. A missing
client is a 503 that stores nothing; an LLM failure or an unreadable reply is a 502
that keeps the stored user message.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid

from ..db import DEFAULT_USER_ID, Database, now_iso
from ..errors import ChatUnavailableError, LLMFailedError
from ..portfolio import PortfolioService
from ..trading import TradeService
from ..watchlist import WatchlistService
from .actions import execute_actions
from .llm import LLMClient, LLMError
from .parsing import ReplyParseError, parse_reply

logger = logging.getLogger(__name__)

NOT_CONFIGURED = "AI assistant is not configured. Set OPENROUTER_API_KEY in .env."
LLM_CALL_FAILED = "AI assistant request failed. Try again."
LLM_BAD_REPLY = "AI assistant returned an unreadable reply. Try again."


class ChatService:
    """Runs one chat turn per `handle` call. Never takes the shared state lock itself."""

    def __init__(
        self,
        db: Database,
        portfolio: PortfolioService,
        watchlist: WatchlistService,
        trades: TradeService,
        llm_client: LLMClient | None,
    ) -> None:
        self._db = db
        self._portfolio = portfolio  # prompt context (plan 03-02)
        self._watchlist = watchlist
        self._trades = trades
        self._client = llm_client

    async def handle(self, message: str) -> dict:
        """Run one turn for `message`; returns the stored assistant row (PLAN §8 shape).

        Raises ChatUnavailableError (503) when no client is configured, before any
        write, and LLMFailedError (502) when the call fails or the reply is unreadable.
        """
        if self._client is None:
            raise ChatUnavailableError(NOT_CONFIGURED)
        await asyncio.to_thread(self._insert, "user", message, None)
        logger.info("Chat: user message stored (%s chars)", len(message))
        try:
            raw = await self._client.complete([{"role": "user", "content": message}])
        except LLMError as exc:
            logger.warning("Chat: LLM call failed: %s", type(exc).__name__)
            raise LLMFailedError(LLM_CALL_FAILED) from exc
        try:
            reply = parse_reply(raw)
        except ReplyParseError as exc:
            logger.warning("Chat: unreadable LLM reply: %s", exc)
            raise LLMFailedError(LLM_BAD_REPLY) from exc
        outcome = await execute_actions(reply, self._watchlist, self._trades)
        content = reply.message  # plan 03-02 appends the failure notes
        return await asyncio.to_thread(self._insert, "assistant", content, outcome.actions)

    # --- Internals ---

    def _insert(self, role: str, content: str, actions: dict | None) -> dict:
        """Blocking insert of one chat row; returns it as the API dict (actions as a dict)."""
        row = {
            "id": str(uuid.uuid4()),
            "role": role,
            "content": content,
            "actions": actions,
            "created_at": now_iso(),
        }
        with self._db.transaction() as conn:
            conn.execute(
                "INSERT INTO chat_messages (id, user_id, role, content, actions, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (
                    row["id"],
                    DEFAULT_USER_ID,
                    role,
                    content,
                    json.dumps(actions) if actions is not None else None,
                    row["created_at"],
                ),
            )
        return row
