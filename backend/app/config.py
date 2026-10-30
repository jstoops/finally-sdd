"""Application settings read from the environment (and ../.env in local dev)."""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

# backend/app/config.py -> parents[0]=app, [1]=backend, [2]=repo root
REPO_ROOT = Path(__file__).resolve().parents[2]


def default_db_path(config_file: Path) -> Path:
    """Return the fallback SQLite path for the given location of this module.

    Locally (`<repo>/backend/app/config.py`) this is `<repo>/db/finally.db`. In the
    image the backend is copied to `/app`, so the "repo root" would be the filesystem
    root and the file would land at `/db/finally.db`, outside the `finally-data`
    volume mounted at `/app/db`. In that layout use `<backend>/db/finally.db`
    (`/app/db/finally.db`), the volume path, so a blank `DB_PATH=` can never lose data.
    """
    backend_dir = config_file.resolve().parents[1]
    repo_root = backend_dir.parent
    if repo_root == Path(repo_root.anchor):
        return backend_dir / "db" / "finally.db"
    return repo_root / "db" / "finally.db"


DEFAULT_DB_PATH = default_db_path(Path(__file__))
# backend/static locally; /app/static in Docker (backend is copied to /app)
DEFAULT_STATIC_DIR = Path(__file__).resolve().parents[1] / "static"

LOG_FORMAT = "%(asctime)s %(levelname)s %(name)s: %(message)s"


@dataclass(frozen=True, slots=True)
class Settings:
    """Process configuration.

    `openrouter_api_key` is the one secret field. It uses `field(repr=False)`, so a
    logged or printed Settings never leaks it; any later secret must do the same.
    """

    db_path: str
    static_dir: str
    dev_cors_origin: str | None = None
    # LLM_MOCK=true (any letter case): deterministic mock chat replies (PLAN §9)
    llm_mock: bool = False
    # OPENROUTER_API_KEY: real LLM chat when set and LLM_MOCK is not true (PLAN §5)
    openrouter_api_key: str | None = field(default=None, repr=False)

    @classmethod
    def from_env(cls, env_file: Path | None = None) -> Settings:
        """Load `.env` (if present) without overriding the real environment, then read settings.

        Empty values are treated as unset, so an empty `DB_PATH=` falls back to
        `DEFAULT_DB_PATH` (PLAN §5). In Docker, env_file values override the image's
        `ENV DB_PATH`, so docker-compose.yml also pins `DB_PATH` under `environment:`
        (which beats env_file); `default_db_path` is the second line of defence and
        resolves to the volume path `/app/db/finally.db` in the container layout.
        """
        load_dotenv(env_file or REPO_ROOT / ".env", override=False)
        return cls(
            db_path=_env("DB_PATH") or str(DEFAULT_DB_PATH),
            static_dir=_env("STATIC_DIR") or str(DEFAULT_STATIC_DIR),
            dev_cors_origin=_env("DEV_CORS_ORIGIN"),
            llm_mock=(_env("LLM_MOCK") or "").lower() == "true",
            openrouter_api_key=_env("OPENROUTER_API_KEY"),
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
