"""Parse the LLM's raw reply text into a `ParsedReply` (PLAN §9 structured output).

The parser accepts what models really send: surrounding whitespace, one ```json fence,
missing or null action lists and unknown keys. It is strict only about the message: a
reply without a non-blank string `message` is unreadable (502). A present but non-list
`trades` or `watchlist_changes` does not fail the reply; it is named in `bad_lists`
and the executor records one failed action for it. Items stay raw here and are
validated one by one with `TradeItem` / `WatchlistItem` by the executor.

These models only parse. The strict schema sent to the model lives with the real
client (plan 03-04); side, action, ticker format and quantity rules are left to the
services so error texts match the REST routes.
"""

from __future__ import annotations

import json
from dataclasses import dataclass

from pydantic import BaseModel, ConfigDict, StrictFloat, StrictStr

_FENCE = "```"
_LISTS = ("trades", "watchlist_changes")


class ReplyParseError(ValueError):
    """The reply is not JSON or lacks a non-empty string `message`."""


@dataclass(frozen=True, slots=True)
class ParsedReply:
    """The conversational message plus the raw requested actions.

    `bad_lists` names the action lists that were present but not lists, in the
    fixed order trades, watchlist_changes.
    """

    message: str
    trades: list
    watchlist_changes: list
    bad_lists: tuple[str, ...] = ()


class TradeItem(BaseModel):
    """One requested trade, type-checked only (the TradeService applies the rules)."""

    model_config = ConfigDict(extra="ignore")

    ticker: StrictStr
    side: StrictStr
    quantity: StrictFloat


class WatchlistItem(BaseModel):
    """One requested watchlist change, type-checked only."""

    model_config = ConfigDict(extra="ignore")

    ticker: StrictStr
    action: StrictStr


def strip_fences(raw: str) -> str:
    """Strip whitespace and one surrounding ``` or ```json fence."""
    text = raw.strip()
    if text.startswith(_FENCE):
        _, _, text = text.partition("\n")  # the fence line and any language tag
        text = text.rstrip()
        if text.endswith(_FENCE):
            text = text[: -len(_FENCE)]
        text = text.strip()
    return text


def parse_reply(raw: str | None) -> ParsedReply:
    """Parse `raw` reply text. Missing or null action lists become `[]`.

    Raises ReplyParseError for a non-string or blank input, non-JSON text, a
    non-object, or a missing, non-string or blank `message`.
    """
    if not isinstance(raw, str) or not raw.strip():
        raise ReplyParseError("Reply is empty")
    try:
        data = json.loads(strip_fences(raw))
    except (json.JSONDecodeError, TypeError, ValueError) as exc:
        raise ReplyParseError("Reply is not valid JSON") from exc
    if not isinstance(data, dict):
        raise ReplyParseError("Reply is not a JSON object")
    message = data.get("message")
    if not isinstance(message, str) or not message.strip():
        raise ReplyParseError("Reply has no message")
    lists: dict[str, list] = {}
    bad: list[str] = []
    for name in _LISTS:
        value = data.get(name)
        if value is None:
            lists[name] = []
        elif isinstance(value, list):
            lists[name] = value
        else:
            lists[name] = []
            bad.append(name)
    return ParsedReply(
        message=message,
        trades=lists["trades"],
        watchlist_changes=lists["watchlist_changes"],
        bad_lists=tuple(bad),
    )
