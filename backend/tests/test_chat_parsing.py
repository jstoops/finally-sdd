"""Tests for the lenient reply parser: fences, missing lists, extra keys, bad lists and
the parse errors that become a 502."""

import json
import math

import pytest
from pydantic import ValidationError

from app.chat.parsing import (
    ParsedReply,
    ReplyParseError,
    TradeItem,
    WatchlistItem,
    parse_reply,
    strip_fences,
)

BARE = json.dumps(
    {
        "message": "Buying.",
        "trades": [{"ticker": "AAPL", "side": "buy", "quantity": 1}],
        "watchlist_changes": [{"ticker": "PYPL", "action": "add"}],
    }
)


class TestStripFences:
    def test_bare_text_is_stripped_only(self):
        assert strip_fences("  {}\n") == "{}"

    def test_json_fence_with_language_tag(self):
        assert strip_fences('```json\n{"a": 1}\n```') == '{"a": 1}'

    def test_plain_fence(self):
        assert strip_fences('\n```\n{"a": 1}\n```\n  ') == '{"a": 1}'


class TestParseEquivalence:
    def test_fenced_and_padded_replies_equal_bare(self):
        bare = parse_reply(BARE)
        assert parse_reply(f"```json\n{BARE}\n```") == bare
        assert parse_reply(f"```\n{BARE}\n```") == bare
        assert parse_reply(f"\n\t  {BARE}  \n") == bare

    def test_values(self):
        reply = parse_reply(BARE)
        assert reply.message == "Buying."
        assert reply.trades == [{"ticker": "AAPL", "side": "buy", "quantity": 1}]
        assert reply.watchlist_changes == [{"ticker": "PYPL", "action": "add"}]
        assert reply.bad_lists == ()

    @pytest.mark.parametrize("extra", [{}, {"trades": None, "watchlist_changes": None}])
    def test_missing_or_null_lists_are_empty(self, extra):
        reply = parse_reply(json.dumps({"message": "Hi", **extra}))
        assert reply == ParsedReply("Hi", [], [])

    def test_unknown_top_level_and_item_keys_are_ignored(self):
        raw = json.dumps(
            {
                "message": "Ok",
                "thoughts": "the user wants AAPL",
                "trades": [{"ticker": "AAPL", "side": "buy", "quantity": 1, "why": "cheap"}],
            }
        )
        reply = parse_reply(raw)
        assert reply.message == "Ok"
        assert reply.trades[0]["ticker"] == "AAPL"
        item = TradeItem.model_validate(reply.trades[0])
        assert (item.ticker, item.side, item.quantity) == ("AAPL", "buy", 1.0)

    def test_escaped_and_literal_non_ascii_message(self):
        literal = parse_reply('{"message": "Café ⚠️"}')
        escaped = parse_reply('{"message": "Caf\\u00e9 \\u26a0\\ufe0f"}')
        assert literal.message == escaped.message == "Café ⚠️"


class TestParseErrors:
    @pytest.mark.parametrize(
        "raw",
        [
            "",
            None,
            "   ",
            "{}",
            '{"message": ""}',
            '{"message": "   "}',
            '{"message": 5}',
            '{"message": null}',
            "[1]",
            "Sure, buying now",
            "```json\n```",
        ],
    )
    def test_unreadable_reply_raises(self, raw):
        with pytest.raises(ReplyParseError):
            parse_reply(raw)


class TestBadLists:
    def test_non_list_trades_is_flagged_not_raised(self):
        reply = parse_reply('{"message": "Hi", "trades": {"ticker": "AAPL"}}')
        assert reply.trades == []
        assert reply.bad_lists == ("trades",)

    def test_both_lists_flagged_in_fixed_order(self):
        reply = parse_reply('{"message": "Hi", "watchlist_changes": "PYPL", "trades": 5}')
        assert reply.bad_lists == ("trades", "watchlist_changes")

    def test_nan_quantity_item_is_kept_for_the_executor(self):
        reply = parse_reply(
            '{"message": "Hi", "trades": [{"ticker": "AAPL", "side": "buy", "quantity": NaN}]}'
        )
        assert len(reply.trades) == 1
        assert math.isnan(reply.trades[0]["quantity"])


class TestItemModels:
    def test_trade_item_is_strict(self):
        with pytest.raises(ValidationError):
            TradeItem.model_validate({"ticker": 5, "side": "buy", "quantity": 1})
        with pytest.raises(ValidationError):
            TradeItem.model_validate({"ticker": "AAPL", "side": "buy", "quantity": "1"})
        with pytest.raises(ValidationError):
            TradeItem.model_validate({"ticker": "AAPL"})
        with pytest.raises(ValidationError):
            TradeItem.model_validate("AAPL")

    def test_trade_item_accepts_int_quantity(self):
        assert TradeItem.model_validate({"ticker": "A", "side": "s", "quantity": 3}).quantity == 3

    def test_watchlist_item(self):
        item = WatchlistItem.model_validate({"ticker": "PYPL", "action": "add", "x": 1})
        assert (item.ticker, item.action) == ("PYPL", "add")
        with pytest.raises(ValidationError):
            WatchlistItem.model_validate({"ticker": "PYPL"})
