"""Connection helper: reads DATABASE_URL from the environment or the repo .env."""

import os
import pathlib
import re

import psycopg

DEFAULT_URL = "postgres://legacy:legacy@localhost:5434/legacy_twin"


def _load_env() -> None:
    # walk up from this file to find the repo .env (workers/pipeline/pipeline/db.py -> repo root)
    root = pathlib.Path(__file__).resolve().parents[3]
    env = root / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, value = line.partition("=")
                value = re.sub(r"\s+#.*$", "", value).strip()
                os.environ.setdefault(key.strip(), value)


def connect() -> psycopg.Connection:
    _load_env()
    return psycopg.connect(os.environ.get("DATABASE_URL", DEFAULT_URL))
