"""The LLM client seam: every client returns the model's raw reply text.

Mock, real and test clients all hand back unparsed text, so every reply goes through
the same parse, execute and store path in `ChatService`.

`OpenRouterLLMClient` follows the cerebras-inference skill (`.claude/skills/cerebras`):
LiteLLM `completion` with `MODEL`, `response_format=LLMReply`, `reasoning_effort="low"`
and `extra_body=EXTRA_BODY`. `EXTRA_BODY` adds two documented OpenRouter routing flags to
the skill's `{"provider": {"order": ["cerebras"]}}`: `require_parameters` keeps the
request on a provider that honors `response_format`, and `allow_fallbacks: False` turns
a Cerebras outage into a clean 502 instead of a fallback provider that ignores the
schema (plan 03-04 A-16).

litellm is imported lazily inside `warm()`, in a worker thread: the import is heavy
and would otherwise fetch its model cost map from GitHub (prevented by
`LITELLM_LOCAL_MODEL_COST_MAP`). Mock mode and the tests never import it.
"""

from __future__ import annotations

import asyncio
import logging
import os
from collections.abc import Callable
from typing import Any, Literal, Protocol

from pydantic import BaseModel, ConfigDict

logger = logging.getLogger(__name__)

MODEL = "openrouter/openai/gpt-oss-120b"
EXTRA_BODY = {
    "provider": {"order": ["cerebras"], "require_parameters": True, "allow_fallbacks": False}
}
LLM_TIMEOUT = 30.0  # seconds per completion call


class LLMError(Exception):
    """A transport or provider failure while calling the LLM."""


class LLMClient(Protocol):
    """Anything that turns chat messages into the model's raw reply text."""

    async def complete(self, messages: list[dict[str, str]]) -> str:
        """Return the raw reply text for `messages` (`{"role", "content"}` dicts).

        Raises LLMError on any transport or provider failure.
        """
        ...


# --- Schema sent to the model (Cerebras strict mode) ---
# No Field constraints, defaults or validators: strict mode rejects pattern, format and
# length keywords, and every property must be required. The app parses replies
# leniently and per item in `parsing.py`; this schema only steers the model.


class LLMTrade(BaseModel):
    """One trade the model asks to execute."""

    model_config = ConfigDict(extra="forbid")

    ticker: str
    side: Literal["buy", "sell"]
    quantity: float


class LLMWatchlistChange(BaseModel):
    """One watchlist change the model asks to make."""

    model_config = ConfigDict(extra="forbid")

    ticker: str
    action: Literal["add", "remove"]


class LLMReply(BaseModel):
    """The structured reply (PLAN §9): a message plus the requested actions."""

    model_config = ConfigDict(extra="forbid")

    message: str
    trades: list[LLMTrade]
    watchlist_changes: list[LLMWatchlistChange]


class OpenRouterLLMClient:
    """LiteLLM -> OpenRouter -> Cerebras, run off the event loop.

    `completion` is a test seam (like `MassiveDataSource(client=...)`): when given,
    it replaces `litellm.completion` and litellm is never imported.
    """

    def __init__(self, api_key: str, *, completion: Callable[..., Any] | None = None) -> None:
        self._api_key = api_key  # never logged
        self._completion = completion

    def __repr__(self) -> str:
        return f"OpenRouterLLMClient(model={MODEL!r})"

    def warm(self) -> None:
        """Import litellm (blocking, a few seconds). Call from a worker thread.

        A no-op when a completion function was injected or already loaded.
        """
        if self._completion is not None:
            return
        # Must be set before the import, which otherwise fetches the cost map from GitHub
        os.environ.setdefault("LITELLM_LOCAL_MODEL_COST_MAP", "True")
        import litellm

        logging.getLogger("LiteLLM").setLevel(logging.WARNING)
        self._completion = litellm.completion

    async def complete(self, messages: list[dict[str, str]]) -> str:
        """Return the raw reply text; the blocking call runs in a worker thread."""
        return await asyncio.to_thread(self._complete_sync, messages)

    # --- Internals ---

    def _complete_sync(self, messages: list[dict[str, str]]) -> str:
        """Blocking completion. Raises LLMError carrying only the exception type name."""
        try:
            self.warm()
            response = self._completion(
                model=MODEL,
                messages=messages,
                response_format=LLMReply,
                reasoning_effort="low",
                extra_body=EXTRA_BODY,
                api_key=self._api_key,
                timeout=LLM_TIMEOUT,
            )
            content = response.choices[0].message.content
        except Exception as exc:
            # Provider messages can echo request details; keep only the type name
            logger.warning("Chat: OpenRouter call failed: %s", type(exc).__name__)
            raise LLMError(type(exc).__name__) from exc
        return content or ""
