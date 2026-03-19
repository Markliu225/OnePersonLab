from __future__ import annotations

from pathlib import Path

from dotenv import load_dotenv


def load_project_env(project_root: Path) -> None:
    """Load project environment files with .env taking precedence over .env.example."""
    load_dotenv(project_root / ".env", override=False)
    load_dotenv(project_root / ".env.example", override=False)
