"""Tests for the chat prompt: the FinAlly system prompt, the live portfolio context, the
history replay and the fixed message order, including the service's 20-message window."""

import json

import pytest

from app.chat.prompt import SYSTEM_PROMPT, build_context, build_messages, replay_content
from app.chat.service import HISTORY_LIMIT, ChatService

PHRASES = [
    "You are FinAlly",
    "concentration",
    "P&L",
    "Suggest trades",
    "Execute trades only when the user asks or agrees",
    "watchlist",
    "concise",
    "4 decimal places",
    "sell all",
    "exact held quantity",
    "Plain text only",
    "no markdown tables",
    "latest message",
]


def chat_service(env, client) -> ChatService:
    return ChatService(env.db, env.portfolio, env.watchlist, env.trades, client)


class TestSystemPrompt:
    @pytest.mark.parametrize("phrase", PHRASES)
    def test_system_prompt_contains(self, phrase):
        assert phrase in SYSTEM_PROMPT

    def test_system_prompt_has_no_markdown_table(self):
        assert "|---" not in SYSTEM_PROMPT
        assert "| ---" not in SYSTEM_PROMPT
        assert "FinAlly" in SYSTEM_PROMPT


class TestContext:
    async def test_context_copies_the_portfolio_view(self, trade_env):
        trade_env.price("AAPL", 190.00)
        trade_env.price("AAPL", 190.50)
        trade_env.price("MSFT", 400.00)
        await trade_env.trades.execute("AAPL", 3.33335, "buy")
        trade_env.price("AAPL", 191.13)
        view = await trade_env.portfolio.view()
        ctx = build_context(view, await trade_env.watchlist.list_entries())
        assert list(ctx) == [
            "cash_balance",
            "total_value",
            "positions_value",
            "unrealized_pnl",
            "positions",
            "watchlist",
        ]
        for key in ("cash_balance", "total_value", "positions_value", "unrealized_pnl"):
            assert ctx[key] == view[key]
        assert ctx["positions"] == view["positions"]
        assert ctx["positions"][0]["quantity"] == 3.3334
        by_ticker = {w["ticker"]: w for w in ctx["watchlist"]}
        assert by_ticker["AAPL"] == {
            "ticker": "AAPL",
            "price": 191.13,
            "chg_percent": round((191.13 - 190.00) / 190.00 * 100, 2),
        }
        assert by_ticker["MSFT"]["chg_percent"] == 0.0
        assert by_ticker["GOOGL"] == {"ticker": "GOOGL", "price": None, "chg_percent": None}

    @pytest.mark.parametrize(
        "price, open_price, expected",
        [
            (101.0, 100.0, 1.0),
            (99.5, 100.0, -0.5),
            (None, 100.0, None),
            (10.0, None, None),
            (10.0, 0.0, None),
            (10.0, -1.0, None),
        ],
    )
    def test_chg_percent_boundaries(self, price, open_price, expected):
        entry = {"ticker": "X", "price": price, "open_price": open_price, "added_at": "t"}
        [row] = build_context(_view(), [entry])["watchlist"]
        assert row["chg_percent"] == expected

    async def test_empty_portfolio_and_watchlist(self, trade_env):
        ctx = build_context(await trade_env.portfolio.view(), [])
        assert ctx["cash_balance"] == 10000.0
        assert ctx["total_value"] == 10000.0
        assert ctx["positions"] == []
        assert ctx["watchlist"] == []


def _view(**extra) -> dict:
    return {
        "cash_balance": 10000.0,
        "positions_value": 0.0,
        "total_value": 10000.0,
        "unrealized_pnl": 0.0,
        "positions": [],
        **extra,
    }


EXECUTED_ROW = {
    "id": "a1",
    "role": "assistant",
    "content": "Done.",
    "actions": {
        "trades": [
            {"ticker": "NVDA", "side": "buy", "quantity": 5, "status": "executed", "price": 875.2},
            {"ticker": "TSLA", "side": "buy", "quantity": 50, "status": "failed", "error": "x"},
        ],
        "watchlist_changes": [
            {"ticker": "PYPL", "action": "add", "status": "executed"},
            {"ticker": "NFLX", "action": "remove", "status": "executed"},
        ],
    },
    "created_at": "2026-10-29T00:00:00Z",
}


class TestMessages:
    def test_order_and_two_separate_system_messages(self):
        history = [
            {"role": "user", "content": "hi", "actions": None},
            {"role": "assistant", "content": "hello", "actions": None},
        ]
        messages = build_messages(build_context(_view(), []), history, "buy 1 AAPL")
        assert [m["role"] for m in messages] == ["system", "system", "user", "assistant", "user"]
        assert messages[0] == {"role": "system", "content": SYSTEM_PROMPT}
        assert messages[1]["content"].startswith("Portfolio context (JSON):\n")
        assert "buy 1 AAPL" not in messages[1]["content"]
        assert messages[-1] == {"role": "user", "content": "buy 1 AAPL"}
        assert all(set(m) == {"role", "content"} for m in messages)

    def test_first_chat_has_three_messages(self):
        messages = build_messages(build_context(_view(), []), [], "hello")
        assert len(messages) == 3
        assert messages[0]["content"] == SYSTEM_PROMPT

    def test_context_message_is_json_with_non_ascii_intact(self):
        ctx = build_context(_view(), [])
        ctx["note"] = "Café ⚠️"
        content = build_messages(ctx, [], "x")[1]["content"]
        assert "Café ⚠️" in content
        payload = json.loads(content.removeprefix("Portfolio context (JSON):\n"))
        assert payload["note"] == "Café ⚠️"
        assert payload["positions"] == []

    def test_replay_executed_actions_as_text(self):
        assert replay_content(EXECUTED_ROW) == (
            "Done.\n[executed: add PYPL; remove NFLX; buy 5 NVDA @ $875.20]"
        )

    def test_replay_without_executed_actions_is_content(self):
        failed_only = {
            **EXECUTED_ROW,
            "actions": {"trades": [EXECUTED_ROW["actions"]["trades"][1]], "watchlist_changes": []},
        }
        assert replay_content(failed_only) == "Done."
        assert replay_content({**EXECUTED_ROW, "actions": None}) == "Done."
        assert replay_content({"role": "user", "content": "buy", "actions": None}) == "buy"

    def test_history_never_carries_action_json(self):
        messages = build_messages(build_context(_view(), []), [EXECUTED_ROW], "next")
        for m in messages[2:]:
            assert '"trades"' not in m["content"]
            assert "watchlist_changes" not in m["content"]


class TestServicePrompt:
    async def test_first_chat_prompt(self, trade_env, fake_llm):
        client = fake_llm()
        await chat_service(trade_env, client).handle("  hello  ")
        [messages] = client.calls
        assert len(messages) == 3
        assert messages[-1] == {"role": "user", "content": "hello"}
        ctx = json.loads(messages[1]["content"].removeprefix("Portfolio context (JSON):\n"))
        assert ctx["positions"] == []
        assert ctx["cash_balance"] == 10000.0

    async def test_window_is_last_20_of_25_oldest_first(self, trade_env, fake_llm):
        client = fake_llm()
        service = chat_service(trade_env, client)
        for i in range(25):
            service._insert("user" if i % 2 == 0 else "assistant", f"m{i}", None)
        await service.handle("new text")
        [messages] = client.calls
        assert HISTORY_LIMIT == 20
        assert len(messages) == 2 + 20 + 1
        assert [m["content"] for m in messages[2:-1]] == [f"m{i}" for i in range(5, 25)]
        assert [m["content"] for m in messages].count("new text") == 1
        assert messages[-1] == {"role": "user", "content": "new text"}

    async def test_context_matches_view_at_call_time(self, trade_env, fake_llm):
        trade_env.price("AAPL", 190.50)
        await trade_env.trades.execute("AAPL", 2, "buy")
        client = fake_llm()
        await chat_service(trade_env, client).handle("Analyze my portfolio")
        ctx = json.loads(client.calls[0][1]["content"].removeprefix("Portfolio context (JSON):\n"))
        view = await trade_env.portfolio.view()
        assert ctx["positions"] == view["positions"]
        assert ctx["cash_balance"] == view["cash_balance"] == 9619.0

    async def test_executed_turn_replays_as_text(self, trade_env, fake_llm):
        trade_env.price("AAPL", 190.50)
        buy = json.dumps(
            {"message": "Buying.", "trades": [{"ticker": "AAPL", "side": "buy", "quantity": 1}]}
        )
        client = fake_llm(replies=[buy])
        service = chat_service(trade_env, client)
        await service.handle("buy one")
        await service.handle("thanks")
        second = client.calls[1]
        assert second[2] == {"role": "user", "content": "buy one"}
        assert second[3] == {
            "role": "assistant",
            "content": "Buying.\n[executed: buy 1 AAPL @ $190.50]",
        }
