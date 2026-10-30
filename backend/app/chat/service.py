"""The chat turn (PLAN §9 "How It Works"): validate, store, prompt, parse, execute, store, return.

`ChatService.handle` rejects an empty or over-long message (400) and a missing client
(503) before any write. Then, under a chat-only lock that serializes whole turns, it
loads the 20 messages before this one, stores the user message, builds the FinAlly
prompt from the live portfolio and watchlist, asks the LLM client for raw reply text,
parses it, runs the requested actions through the existing services, appends one
failure note per failed action, stores the assistant message with its actions and
returns that stored row. An LLM failure or an unreadable reply is a 502 that keeps
the stored user message.

The chat lock is never the shared state lock: the services the executor calls take
that lock themselves, and it is not reentrant. POST /api/reset also takes the chat lock
(`turn_lock`), before the state lock as a turn does, so a reset never lands between a
turn's prompt and its actions: the reply always runs against the account it was asked about.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from contextlib import closing

from ..db import DEFAULT_USER_ID, Database, now_iso
from ..errors import ChatUnavailableError, DomainError, LLMFailedError
from ..portfolio import PortfolioService
from ..trading import TradeService
from ..watchlist import WatchlistService
from .actions import execute_actions
from .llm import LLMClient, LLMError
from .parsing import ReplyParseError, parse_reply
from .prompt import build_context, build_messages

logger = logging.getLogger(__name__)

NOT_CONFIGURED = "AI assistant is not configured. Set OPENROUTER_API_KEY in .env."
LLM_CALL_FAILED = "AI assistant request failed. Try again."
LLM_BAD_REPLY = "AI assistant returned an unreadable reply. Try again."
EMPTY_MESSAGE = "Message cannot be empty."
MESSAGE_TOO_LONG = "Message is too long (max 2,000 characters)."

MAX_MESSAGE_CHARS = 2000  # code points, counted on the stripped text
HISTORY_LIMIT = 20  # prior messages replayed in each prompt
HISTORY_PAGE = 50  # messages served by GET /api/chat/history


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
        self._portfolio = portfolio
        self._watchlist = watchlist
        self._trades = trades
        self._client = llm_client
        self._turn_lock = asyncio.Lock()  # chat-only: serializes whole turns

    @property
    def turn_lock(self) -> asyncio.Lock:
        """The lock held for a whole turn. Reset waits on it, then takes the state lock."""
        return self._turn_lock

    async def handle(self, message: str) -> dict:
        """Run one turn for `message`; returns the stored assistant row (PLAN §8 shape).

        Raises DomainError (400) for an empty or over-long message and
        ChatUnavailableError (503) when no client is configured, both before any
        write, and LLMFailedError (502) when the call fails or the reply is unreadable.
        """
        text = message.strip()
        if not text:
            raise DomainError(EMPTY_MESSAGE)
        if len(text) > MAX_MESSAGE_CHARS:
            raise DomainError(MESSAGE_TOO_LONG)
        if self._client is None:
            raise ChatUnavailableError(NOT_CONFIGURED)
        async with self._turn_lock:
            # Loaded before the new row is stored: the window is the messages before this one
            history = await asyncio.to_thread(self._load_recent, HISTORY_LIMIT)
            await asyncio.to_thread(self._insert, "user", text, None)
            logger.info("Chat: user message stored (%s chars)", len(text))
            context = build_context(
                await self._portfolio.view(), await self._watchlist.list_entries()
            )
            try:
                raw = await self._client.complete(build_messages(context, history, text))
            except LLMError as exc:
                logger.warning("Chat: LLM call failed: %s", type(exc).__name__)
                raise LLMFailedError(LLM_CALL_FAILED) from exc
            try:
                reply = parse_reply(raw)
            except ReplyParseError as exc:
                logger.warning("Chat: unreadable LLM reply: %s", exc)
                raise LLMFailedError(LLM_BAD_REPLY) from exc
            outcome = await execute_actions(reply, self._watchlist, self._trades)
            content = reply.message
            if outcome.notes:
                content = reply.message.rstrip() + "\n\n" + "\n".join(outcome.notes)
            row = _new_row("assistant", content, outcome.actions)
            try:
                await asyncio.to_thread(self._write, row)
            except Exception:
                # The actions already committed: still return them, so the client refreshes
                # the portfolio and watchlist instead of seeing a bare 500 with no actions.
                logger.exception("Chat: actions ran but the assistant message was not stored")
            return row

    async def history(self, limit: int = HISTORY_PAGE) -> list[dict]:
        """The last `limit` messages, oldest first, in the PLAN §8 shape."""
        return await asyncio.to_thread(self._load_recent, limit)

    # --- Internals ---

    def _load_recent(self, limit: int) -> list[dict]:
        """Blocking read of the last `limit` rows, oldest first; rowid breaks same-second ties."""
        with closing(self._db.connect()) as conn:
            rows = conn.execute(
                "SELECT id, role, content, actions, created_at FROM chat_messages "
                "WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?",
                (DEFAULT_USER_ID, limit),
            ).fetchall()
        return [
            {
                "id": row["id"],
                "role": row["role"],
                "content": row["content"],
                "actions": json.loads(row["actions"]) if row["actions"] is not None else None,
                "created_at": row["created_at"],
            }
            for row in reversed(rows)
        ]

    def _insert(self, role: str, content: str, actions: dict | None) -> dict:
        """Blocking insert of one chat row; returns it as the API dict (actions as a dict)."""
        row = _new_row(role, content, actions)
        self._write(row)
        return row

    def _write(self, row: dict) -> None:
        """Blocking insert of one API-shaped chat row."""
        role, content, actions = row["role"], row["content"], row["actions"]
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


def _new_row(role: str, content: str, actions: dict | None) -> dict:
    """A new chat row in the API shape (actions as a dict), stamped now."""
    return {
        "id": str(uuid.uuid4()),
        "role": role,
        "content": content,
        "actions": actions,
        "created_at": now_iso(),
    }
