"""Tests for the deterministic mock LLM (PLAN section 9 table): rules, word boundaries,
uppercase capture, first rule wins, purity and statelessness."""

import asyncio
import json

import pytest

from app.chat.mock import GREETING, MockLLMClient, mock_reply

BUY = {
    "message": "Buying 1 share of AAPL.",
    "trades": [{"ticker": "AAPL", "side": "buy", "quantity": 1}],
    "watchlist_changes": [],
}
SELL = {
    "message": "Selling 1 share of AAPL.",
    "trades": [{"ticker": "AAPL", "side": "sell", "quantity": 1}],
    "watchlist_changes": [],
}
HELLO = {"message": GREETING, "trades": [], "watchlist_changes": []}


def add(ticker: str) -> dict:
    return {
        "message": f"Adding {ticker} to your watchlist.",
        "trades": [],
        "watchlist_changes": [{"ticker": ticker, "action": "add"}],
    }


def remove(ticker: str) -> dict:
    return {
        "message": f"Removing {ticker} from your watchlist.",
        "trades": [],
        "watchlist_changes": [{"ticker": ticker, "action": "remove"}],
    }


class TestRules:
    def test_greeting_text(self):
        assert GREETING == "Hello! I'm FinAlly, your AI trading assistant. How can I help?"

    @pytest.mark.parametrize("text", ["buy", "BUY", "Please buy now", "Buy 5 NVDA"])
    def test_buy(self, text):
        assert mock_reply(text) == BUY

    @pytest.mark.parametrize("text", ["sell", "SELL it", "please Sell."])
    def test_sell(self, text):
        assert mock_reply(text) == SELL

    @pytest.mark.parametrize(
        "text, ticker", [("add PYPL", "PYPL"), ("add pypl.", "PYPL"), ("Please ADD brk.b", "BRK.B")]
    )
    def test_add_uppercases_capture(self, text, ticker):
        assert mock_reply(text) == add(ticker)

    @pytest.mark.parametrize("text, ticker", [("remove nflx", "NFLX"), ("REMOVE TSLA now", "TSLA")])
    def test_remove_uppercases_capture(self, text, ticker):
        assert mock_reply(text) == remove(ticker)

    @pytest.mark.parametrize(
        "text", ["hello", "", "buyer", "bestseller", "address PYPL", "please add", "removed"]
    )
    def test_word_boundaries_fall_through_to_greeting(self, text):
        assert mock_reply(text) == HELLO

    def test_first_rule_wins(self):
        assert mock_reply("buy and sell") == BUY
        assert mock_reply("sell then add PYPL") == SELL
        assert mock_reply("add PYPL and remove NFLX") == add("PYPL")


class TestPurity:
    def test_mock_reply_is_pure(self):
        assert mock_reply("add PYPL") == mock_reply("add PYPL")
        first = mock_reply("buy")
        first["trades"].append("mutated")
        assert mock_reply("buy") == BUY

    async def test_complete_is_identical_on_repeat(self):
        client = MockLLMClient()
        messages = [{"role": "system", "content": "sell"}, {"role": "user", "content": "buy"}]
        first = await client.complete(messages)
        assert await client.complete(messages) == first
        assert json.loads(first) == BUY

    async def test_complete_uses_last_user_message(self):
        messages = [
            {"role": "user", "content": "sell"},
            {"role": "assistant", "content": "Selling."},
            {"role": "user", "content": "add PYPL"},
        ]
        assert json.loads(await MockLLMClient().complete(messages)) == add("PYPL")

    async def test_concurrent_calls_get_their_own_reply(self):
        client = MockLLMClient()
        texts = ["buy", "sell", "add PYPL"]
        results = await asyncio.gather(
            *(client.complete([{"role": "user", "content": t}]) for t in texts)
        )
        assert [json.loads(r) for r in results] == [BUY, SELL, add("PYPL")]
