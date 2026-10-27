"""SQLite persistence: connection helper, schema creation and seeding (PLAN §7)."""

from __future__ import annotations

import logging
import sqlite3
from collections.abc import Iterator
from contextlib import closing, contextmanager
from datetime import UTC, datetime
from pathlib import Path

from .seed import DEFAULT_CASH, DEFAULT_USER_ID, DEFAULT_WATCHLIST, seed

logger = logging.getLogger(__name__)

SCHEMA_PATH = Path(__file__).with_name("schema.sql")

__all__ = [
    "DEFAULT_CASH",
    "DEFAULT_USER_ID",
    "DEFAULT_WATCHLIST",
    "SCHEMA_PATH",
    "Database",
    "now_iso",
]


def now_iso() -> str:
    """Current time as an ISO 8601 UTC string, e.g. 2026-10-09T14:03:22Z."""
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


class Database:
    """Opens one connection per unit of work on the SQLite file at `path`.

    Connections use explicit transactions (`isolation_level=None`), so writes go
    through `transaction()`, which runs BEGIN IMMEDIATE ... COMMIT or ROLLBACK.
    All methods are blocking; call them from async code via `asyncio.to_thread`.
    """

    def __init__(self, path: str) -> None:
        self._path = path

    @property
    def path(self) -> str:
        return self._path

    def connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._path, timeout=5.0, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA busy_timeout=5000")
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        """Yield a connection inside BEGIN IMMEDIATE; commit on success, roll back on error."""
        with closing(self.connect()) as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                yield conn
            except BaseException:
                conn.execute("ROLLBACK")
                raise
            conn.execute("COMMIT")

    def init(self) -> None:
        """Create the schema and seed defaults. Idempotent; safe on every startup."""
        Path(self._path).resolve().parent.mkdir(parents=True, exist_ok=True)
        with closing(self.connect()) as conn:
            conn.execute("PRAGMA journal_mode=WAL")
            # executescript commits implicitly, so it is used only here, outside transaction()
            conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
        with self.transaction() as conn:
            if seed(conn, now_iso()):
                logger.info("Database: seeded default user and watchlist")

    def tracked_tickers(self, user_id: str = DEFAULT_USER_ID) -> list[str]:
        """Watchlist ∪ held positions (PLAN §6), watchlist first, de-duplicated in order."""
        with closing(self.connect()) as conn:
            watched = conn.execute(
                "SELECT ticker FROM watchlist WHERE user_id = ? ORDER BY added_at, rowid",
                (user_id,),
            ).fetchall()
            held = conn.execute(
                "SELECT ticker FROM positions WHERE user_id = ? ORDER BY rowid",
                (user_id,),
            ).fetchall()
        return list(dict.fromkeys(row["ticker"] for row in [*watched, *held]))
