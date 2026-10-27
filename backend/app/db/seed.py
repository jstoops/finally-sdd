"""Default seed data: the single user and the default watchlist (PLAN §7)."""

from __future__ import annotations

import sqlite3
import uuid

DEFAULT_USER_ID = "default"
DEFAULT_CASH = 10000.0
DEFAULT_WATCHLIST = ("AAPL", "GOOGL", "MSFT", "AMZN", "TSLA", "NVDA", "META", "JPM", "V", "NFLX")


def seed(conn: sqlite3.Connection, now: str) -> bool:
    """Seed the default user, and the default watchlist only when the user is new.

    Seed once (user decision A1): the watchlist is inserted only when the user row
    was just created, so a default ticker the user removed stays removed after a
    restart. Run inside one transaction so a first start is all-or-nothing.
    Returns True when the default user and watchlist were inserted.
    """
    cur = conn.execute(
        "INSERT OR IGNORE INTO users_profile (id, cash_balance, created_at) VALUES (?, ?, ?)",
        (DEFAULT_USER_ID, DEFAULT_CASH, now),
    )
    if cur.rowcount != 1:
        return False
    conn.executemany(
        "INSERT OR IGNORE INTO watchlist (id, user_id, ticker, added_at) VALUES (?, ?, ?, ?)",
        [(str(uuid.uuid4()), DEFAULT_USER_ID, ticker, now) for ticker in DEFAULT_WATCHLIST],
    )
    return True
