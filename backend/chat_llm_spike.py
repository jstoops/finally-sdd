"""FinAlly live LLM spike: one real call to OpenRouter -> Cerebras with the final schema.

Run with:  uv run --directory backend python chat_llm_spike.py

Needs OPENROUTER_API_KEY in the environment or the repo-root .env. Makes one paid
call, prints the raw reply, then validates it against `LLMReply`. Never run by the
tests. Exit codes: 0 valid structured reply, 1 call or validation failure, 2 no key.
"""

from __future__ import annotations

import asyncio
import sys

from pydantic import ValidationError

from app.chat.llm import LLMError, LLMReply, OpenRouterLLMClient
from app.chat.parsing import strip_fences
from app.config import Settings

SYSTEM = (
    "You are FinAlly, an AI trading assistant. Reply only with JSON that has "
    '"message" (a short reply to the user), "trades" (a list of '
    '{"ticker", "side": "buy" or "sell", "quantity"}) and "watchlist_changes" '
    '(a list of {"ticker", "action": "add" or "remove"}).'
)
USER = "Buy 1 AAPL and add PYPL to my watchlist."


def redact(text: str, key: str) -> str:
    return text.replace(key, "***")


async def run(key: str) -> int:
    client = OpenRouterLLMClient(key)
    messages = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": USER}]
    try:
        raw = await client.complete(messages)
        print("Raw content:")
        print(redact(raw, key))
        reply = LLMReply.model_validate_json(strip_fences(raw))
    except (LLMError, ValidationError) as exc:
        cause = exc.__cause__ if exc.__cause__ is not None else exc
        print(f"FAILED: {type(exc).__name__}: {redact(str(cause), key)}")
        return 1
    print()
    print(f"Message: {reply.message}")
    print(f"Trades: {[trade.model_dump() for trade in reply.trades]}")
    print(f"Watchlist changes: {[change.model_dump() for change in reply.watchlist_changes]}")
    return 0


def main() -> int:
    key = Settings.from_env().openrouter_api_key
    if not key:
        print("OPENROUTER_API_KEY is not set; nothing to check.")
        return 2
    return asyncio.run(run(key))


if __name__ == "__main__":
    sys.exit(main())
