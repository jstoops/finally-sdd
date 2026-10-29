"""Parse the LLM's raw reply text into a `ParsedReply` (PLAN §9 structured output).

The parser is lenient about the action lists and strict about the message: a reply
without a non-empty string `message` is unreadable. Items are kept raw here; the
executor and the services validate them one by one.
"""

from __future__ import annotations

import json
from dataclasses import dataclass


class ReplyParseError(ValueError):
    """The reply is not JSON or lacks a non-empty string `message`."""


@dataclass(frozen=True, slots=True)
class ParsedReply:
    """The conversational message plus the raw requested actions."""

    message: str
    trades: list
    watchlist_changes: list


def parse_reply(raw: str) -> ParsedReply:
    """Parse `raw` JSON text. Missing or null action lists become `[]`.

    Raises ReplyParseError for non-JSON text, a non-object, a missing or empty
    `message`, or an action list that is not a list.
    """
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, TypeError, ValueError) as exc:
        raise ReplyParseError("Reply is not valid JSON") from exc
    if not isinstance(data, dict):
        raise ReplyParseError("Reply is not a JSON object")
    message = data.get("message")
    if not isinstance(message, str) or not message.strip():
        raise ReplyParseError("Reply has no message")
    return ParsedReply(
        message=message,
        trades=_as_list(data.get("trades"), "trades"),
        watchlist_changes=_as_list(data.get("watchlist_changes"), "watchlist_changes"),
    )


def _as_list(value: object, name: str) -> list:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    raise ReplyParseError(f"Reply field {name} is not a list")
