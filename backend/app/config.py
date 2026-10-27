"""Application settings read from the environment (and ../.env in local dev)."""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

# backend/app/config.py -> parents[0]=app, [1]=backend, [2]=repo root
REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DB_PATH = REPO_ROOT / "db" / "finally.db"
# backend/static locally; /app/static in Docker (backend is copied to /app)
DEFAULT_STATIC_DIR = Path(__file__).resolve().parents[1] / "static"

LOG_FORMAT = "%(asctime)s %(levelname)s %(name)s: %(message)s"


@dataclass(frozen=True, slots=True)
class Settings:
    """Process configuration.

    Holds no secrets in this phase. Any secret field added later must use
    `field(repr=False)` so a logged or printed Settings never leaks it.
    """

    db_path: str
    static_dir: str
    dev_cors_origin: str | None = None

    @classmethod
    def from_env(cls, env_file: Path | None = None) -> Settings:
        """Load `.env` (if present) without overriding the real environment, then read settings.

        Empty values are treated as unset, so an empty `DB_PATH=` falls back to the
        default instead of resolving to a path outside the data volume (PLAN §5).
        """
        load_dotenv(env_file or REPO_ROOT / ".env", override=False)
        return cls(
            db_path=_env("DB_PATH") or str(DEFAULT_DB_PATH),
            static_dir=_env("STATIC_DIR") or str(DEFAULT_STATIC_DIR),
            dev_cors_origin=_env("DEV_CORS_ORIGIN"),
        )


def _env(name: str) -> str | None:
    """Return the stripped environment value, or None when unset or blank."""
    value = os.environ.get(name, "").strip()
    return value or None


def configure_logging() -> None:
    """Send INFO lifecycle logs (app, market, db) to stderr.

    uvicorn configures only its own loggers; without this, app INFO logs are dropped.
    A no-op if the root logger already has handlers.
    """
    logging.basicConfig(level=logging.INFO, format=LOG_FORMAT)
