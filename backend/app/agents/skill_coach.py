"""Skill-Gap Coach: a learning roadmap for the skills a candidate did not show.

The list of gaps comes from real data (the Matcher's per-skill results), not from the model. The model
only writes the plan for those gaps, and this module checks that:
  * every step is about a real gap, and every missing required skill has a step,
  * there are no web links (a model can invent links that do not exist),
  * the total time is added up here rather than trusted from the model.
"""

import re
from typing import Literal

from pydantic import BaseModel, Field

from app.llm.client import LLMClient, LLMError
from app.llm.safety import UNTRUSTED_RULE, wrap_untrusted
from app.prompts import load_prompt

MAX_GAPS = 6
_URL = re.compile(r"https?://|www\.|\.com\b|\.org\b|\.io\b", re.IGNORECASE)


class Resource(BaseModel):
    title: str
    kind: Literal["docs", "course", "book", "practice"]
    search_terms: str


class Step(BaseModel):
    skill: str
    why: str
    actions: list[str] = Field(min_length=1)
    practice_project: str
    weeks: int = Field(ge=1, le=8)
    resources: list[Resource] = Field(default_factory=list)
    milestone: str


class RoadmapDraft(BaseModel):
    """What the model is asked to produce."""

    summary: str
    steps: list[Step] = Field(min_length=1)


class CoachError(LLMError):
    """The model could not produce a roadmap that passes the checks."""


def find_gaps(skill_details: list[dict]) -> list[dict]:
    """Skills to work on, most important first: missing must-haves, then listed-only must-haves, then nice-to-haves."""
    def rank(item: dict) -> int:
        return (0 if item["kind"] == "must" else 2) + (0 if item["status"] == "missing" else 1)

    gaps = [
        {"skill": s["skill"], "kind": s["kind"], "status": s["status"]}
        for s in skill_details if s["status"] != "demonstrated"
    ]
    return sorted(gaps, key=rank)[:MAX_GAPS]  # sorted() is stable, so the job's own order is kept within a rank


def _canon(skill: str) -> str:
    return re.sub(r"\s+", " ", skill.strip().lower())


def check_roadmap(draft: RoadmapDraft, gaps: list[dict]) -> list[str]:
    issues: list[str] = []
    allowed = {_canon(g["skill"]) for g in gaps}
    steps_for = {_canon(s.skill) for s in draft.steps}
    extra = steps_for - allowed
    if extra:
        issues.append("These steps are not for a listed gap: " + ", ".join(sorted(extra)) + ".")
    missing = [g["skill"] for g in gaps if g["kind"] == "must" and _canon(g["skill"]) not in steps_for]
    if missing:
        issues.append("Every required skill needs a step. Missing: " + ", ".join(missing) + ".")
    text = " ".join([draft.summary] + [f"{s.why} {s.practice_project} {s.milestone} " + " ".join(s.actions)
                                       + " ".join(f"{r.title} {r.search_terms}" for r in s.resources) for s in draft.steps])
    if _URL.search(text):
        issues.append("Do not include web addresses or links; give resource names and search terms.")
    return issues


def finalise(draft: RoadmapDraft, gaps: list[dict]) -> dict:
    """The stored roadmap: steps in priority order, trimmed, with the total computed here."""
    order = {_canon(g["skill"]): i for i, g in enumerate(gaps)}
    steps = sorted((s for s in draft.steps if _canon(s.skill) in order), key=lambda s: order[_canon(s.skill)])
    seen: set[str] = set()
    kept = []
    for step in steps:
        if _canon(step.skill) in seen:
            continue
        seen.add(_canon(step.skill))
        kept.append({**step.model_dump(), "actions": step.actions[:4], "resources": [r.model_dump() for r in step.resources[:3]],
                     "priority": "high" if next(g for g in gaps if _canon(g["skill"]) == _canon(step.skill))["kind"] == "must" else "medium"})
    return {
        "summary": draft.summary.strip(), "steps": kept, "total_weeks": sum(s["weeks"] for s in kept),
        "covers_all_required": all(g["kind"] != "must" or _canon(g["skill"]) in seen for g in gaps),
    }


def build_roadmap(*, job_title: str, years: float, gaps: list[dict], llm: LLMClient) -> dict:
    if not gaps:
        raise CoachError("There are no skill gaps to plan for. This candidate showed every required skill.")
    lines = "\n".join(
        f"{i + 1}. {g['skill']} ({'required' if g['kind'] == 'must' else 'nice to have'}; "
        f"{'missing completely' if g['status'] == 'missing' else 'listed but not shown in real work'})"
        for i, g in enumerate(gaps)
    )
    user = f"JOB: {job_title}\nCANDIDATE EXPERIENCE: {years} years\n\nSKILL GAPS\n{wrap_untrusted('gaps', lines)}"
    system = load_prompt("coach") + "\n\n" + UNTRUSTED_RULE.format(tag="gaps")
    messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]

    draft = llm.chat_json(messages, RoadmapDraft, agent="skill_coach", tier="large", reasoning_effort="low")
    issues = check_roadmap(draft, gaps)
    if issues:
        retry = [*messages, {"role": "assistant", "content": draft.model_dump_json()},
                 {"role": "user", "content": "That roadmap has problems:\n" + "\n".join(f"- {i}" for i in issues)
                  + "\nReturn the corrected JSON."}]
        draft = llm.chat_json(retry, RoadmapDraft, agent="skill_coach", tier="large", reasoning_effort="low")
        issues = check_roadmap(draft, gaps)
        if issues:
            raise CoachError("The roadmap could not be written safely: " + " ".join(issues))
    return finalise(draft, gaps)
