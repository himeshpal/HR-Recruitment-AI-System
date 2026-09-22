"""Saves each check script's pass/fail list to data/eval/checks.json, which the app's Evaluation tab reads."""

import json
from datetime import datetime
from pathlib import Path

CHECKS_FILE = Path(__file__).resolve().parents[1] / "data" / "eval" / "checks.json"


def save_checks(key: str, title: str, results: list[tuple[str, bool, str]]) -> None:
    try:
        data = json.loads(CHECKS_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        data = {}
    data[key] = {
        "title": title,
        "ran_at": datetime.now().isoformat(timespec="seconds"),
        "checks": [{"name": name, "passed": bool(ok), "detail": detail} for name, ok, detail in results],
    }
    CHECKS_FILE.parent.mkdir(parents=True, exist_ok=True)
    CHECKS_FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")
