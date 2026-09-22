import json
from pathlib import Path

from fastapi import APIRouter
from pydantic import BaseModel

from app.config import BACKEND_DIR

router = APIRouter(prefix="/api", tags=["evaluation"])

CHECKS_FILE = BACKEND_DIR / "data" / "eval" / "checks.json"


class CheckOut(BaseModel):
    name: str
    passed: bool
    detail: str = ""


class PhaseOut(BaseModel):
    key: str
    title: str
    ran_at: str
    passed: int
    total: int
    checks: list[CheckOut]


class EvaluationOut(BaseModel):
    phases: list[PhaseOut]
    passed: int
    total: int


def load_evaluation(path: Path = CHECKS_FILE) -> EvaluationOut:
    """The results the real-AI check scripts last saved. Missing or unreadable means "not run yet", not an error."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return EvaluationOut(phases=[], passed=0, total=0)
    phases = []
    for key in sorted(data):
        entry = data[key]
        checks = [CheckOut(**c) for c in entry.get("checks", [])]
        phases.append(PhaseOut(key=key, title=entry.get("title", key), ran_at=entry.get("ran_at", ""),
                               passed=sum(c.passed for c in checks), total=len(checks), checks=checks))
    return EvaluationOut(phases=phases, passed=sum(p.passed for p in phases), total=sum(p.total for p in phases))


@router.get("/evaluation", response_model=EvaluationOut)
def evaluation():
    """Validation results, shown in the app's Evaluation tab."""
    return load_evaluation()
