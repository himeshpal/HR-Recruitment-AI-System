from functools import lru_cache
from pathlib import Path

_DIR = Path(__file__).parent


@lru_cache
def load_prompt(name: str) -> str:
    """Read app/prompts/<name>.md (one prompt file per agent)."""
    return (_DIR / f"{name}.md").read_text(encoding="utf-8").strip()
