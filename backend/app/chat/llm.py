"""The LLM client seam: every client returns the model's raw reply text.

Mock, real and test clients all hand back unparsed text, so every reply goes through
the same parse, execute and store path in `ChatService`. Plan 03-04 adds the
OpenRouter client to this module.
"""

from __future__ import annotations

from typing import Protocol


class LLMError(Exception):
    """A transport or provider failure while calling the LLM."""


class LLMClient(Protocol):
    """Anything that turns chat messages into the model's raw reply text."""

    async def complete(self, messages: list[dict[str, str]]) -> str:
        """Return the raw reply text for `messages` (`{"role", "content"}` dicts).

        Raises LLMError on any transport or provider failure.
        """
        ...
