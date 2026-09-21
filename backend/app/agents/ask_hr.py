"""Ask-HR: search the candidate pool in plain English.

The model only fills in a search plan from a fixed menu of filters. It never writes SQL or code.
This module then validates the plan strictly and runs it as ordinary Python over the candidate data:
  * there is no operation that changes data, and no way to express one;
  * results never contain emails, phone numbers or addresses, whatever was asked;
  * no filter exists for age, gender or the other protected characteristics.
Anything the plan cannot express is refused with a reason.
"""

from dataclasses import dataclass, field
from typing import Literal

from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.llm.client import LLMClient
from app.llm.safety import UNTRUSTED_RULE, wrap_untrusted
from app.models import STAGES, Candidate, Match
from app.prompts import load_prompt
from app.services.panel_store import summary_from_rows
from app.services.skills import mentions, normalize_skill

FieldName = Literal["skill", "skills_any", "min_years", "max_years", "stage", "location", "headline", "min_score", "max_score", "verdict"]
VERDICTS = {"hire", "maybe", "no_hire"}
MAX_LIMIT = 25
SCOPED_TO_JOB = {"min_score", "max_score", "verdict"}


class Condition(BaseModel):
    field: FieldName
    value: str | float | int | list[str]


class Plan(BaseModel):
    """What the model is asked to produce."""

    conditions: list[Condition] = Field(default_factory=list, max_length=12)
    sort_by: Literal["score", "years", "recent"] | None = None
    direction: Literal["desc", "asc"] = "desc"
    limit: int = 10
    job_id: int | None = None
    refusal: str | None = None


class AskError(ValueError):
    """The plan cannot be run; the message is safe to show the recruiter."""


@dataclass
class Filters:
    skills_all: list[str] = field(default_factory=list)
    skills_any: list[str] = field(default_factory=list)
    min_years: float | None = None
    max_years: float | None = None
    stages: set[str] = field(default_factory=set)
    location: str | None = None
    headline: str | None = None
    min_score: float | None = None
    max_score: float | None = None
    verdicts: set[str] = field(default_factory=set)
    sort_by: str | None = None
    direction: str = "desc"
    limit: int = 10
    job_id: int | None = None


def _text(value, name: str, longest: int = 60) -> str:
    if isinstance(value, list):
        value = value[0] if len(value) == 1 else None
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > longest:
        raise AskError(f"I couldn't understand the value for the {name} filter.")
    return value.strip()


def _number(value, name: str, low: float, high: float) -> float:
    try:
        number = float(value if not isinstance(value, list) else value[0])
    except (TypeError, ValueError, IndexError):
        raise AskError(f"I couldn't understand the number for the {name} filter.") from None
    if not low <= number <= high:
        raise AskError(f"The {name} filter must be between {low:g} and {high:g}.")
    return number


def _names(value, name: str, allowed: set[str]) -> set[str]:
    items = value if isinstance(value, list) else [value]
    chosen = {str(i).strip().lower().replace(" ", "_") for i in items}
    unknown = chosen - allowed
    if unknown or not chosen:
        raise AskError(f"Unknown {name} {', '.join(sorted(unknown)) or '(none)'}. Choose from: {', '.join(sorted(allowed))}.")
    return chosen


def compile_plan(plan: Plan, valid_jobs: dict[int, str], current_job_id: int | None) -> Filters:
    """Turn the model's plan into validated filters, or raise AskError with the reason."""
    if plan.refusal and plan.refusal.strip():
        raise AskError(plan.refusal.strip())

    f = Filters(sort_by=plan.sort_by, direction=plan.direction, limit=max(1, min(MAX_LIMIT, int(plan.limit))))
    for c in plan.conditions:
        if c.field == "skill":
            f.skills_all.append(_text(c.value, "skill", 50))
        elif c.field == "skills_any":
            items = c.value if isinstance(c.value, list) else [c.value]
            f.skills_any += [_text(i, "skill", 50) for i in items[:6]]
        elif c.field == "min_years":
            f.min_years = _number(c.value, "minimum years", 0, 60)
        elif c.field == "max_years":
            f.max_years = _number(c.value, "maximum years", 0, 60)
        elif c.field == "stage":
            f.stages |= _names(c.value, "stage", set(STAGES))
        elif c.field == "location":
            f.location = _text(c.value, "location", 60).lower()
        elif c.field == "headline":
            f.headline = _text(c.value, "job title", 60).lower()
        elif c.field == "min_score":
            f.min_score = _number(c.value, "minimum score", 0, 100)
        elif c.field == "max_score":
            f.max_score = _number(c.value, "maximum score", 0, 100)
        elif c.field == "verdict":
            f.verdicts |= _names(c.value, "verdict", VERDICTS)

    needs_job = f.sort_by == "score" or any(c.field in SCOPED_TO_JOB for c in plan.conditions)
    job_id = plan.job_id if plan.job_id in valid_jobs else None
    if plan.job_id is not None and job_id is None:
        raise AskError("I couldn't find that job.")
    job_id = job_id or (current_job_id if current_job_id in valid_jobs else None)
    if needs_job and job_id is None:
        raise AskError("Which job do you mean? Scores and panel verdicts belong to a job, for example: “for the Backend Engineer job”.")
    f.job_id = job_id if needs_job else None
    return f


def describe(f: Filters, job_title: str | None) -> str:
    """The plan in plain words, shown to the recruiter so they can see how their question was understood."""
    parts = []
    if f.skills_all:
        parts.append("with " + " and ".join(f.skills_all))
    if f.skills_any:
        parts.append("with any of " + ", ".join(f.skills_any))
    if f.min_years is not None and f.max_years is not None:
        parts.append(f"with {f.min_years:g} to {f.max_years:g} years of experience")
    elif f.min_years is not None:
        parts.append(f"with at least {f.min_years:g} years of experience")
    elif f.max_years is not None:
        parts.append(f"with at most {f.max_years:g} years of experience")
    if f.stages:
        parts.append("in stage " + " or ".join(s for s in STAGES if s in f.stages))
    if f.location:
        parts.append(f"located in {f.location}")
    if f.headline:
        parts.append(f"whose title mentions “{f.headline}”")
    if f.min_score is not None:
        parts.append(f"scoring at least {f.min_score:g} for {job_title}")
    if f.max_score is not None:
        parts.append(f"scoring at most {f.max_score:g} for {job_title}")
    if f.verdicts:
        parts.append("with panel verdict " + " or ".join(sorted(f.verdicts)) + f" for {job_title}")
    sorting = {"score": "best match first" if f.direction == "desc" else "lowest match first",
               "years": "most experience first" if f.direction == "desc" else "least experience first",
               "recent": "newest first" if f.direction == "desc" else "oldest first"}.get(f.sort_by or "")
    text = "Candidates " + (", ".join(parts) if parts else "(everyone)")
    return text + (f", sorted {sorting}" if sorting else "") + f", up to {f.limit}"


def plan_search(*, question: str, jobs: dict[int, str], current_job_id: int | None, llm: LLMClient) -> Plan:
    job_lines = "\n".join(f"- id {i}: {t}" for i, t in jobs.items()) or "- (no jobs yet)"
    user = (f"JOBS\n{job_lines}\n\nCURRENT JOB: {current_job_id if current_job_id in jobs else 'none'}\n\n"
            f"QUESTION\n{wrap_untrusted('question', question)}")
    system = load_prompt("ask_hr") + "\n\n" + UNTRUSTED_RULE.format(tag="question")
    return llm.chat_json([{"role": "system", "content": system}, {"role": "user", "content": user}],
                         Plan, agent="ask_hr", tier="small", reasoning_effort="low")


def _has_skill(profile: dict, skill: str) -> bool:
    wanted, _ = normalize_skill(skill)
    listed = {normalize_skill(s)[0] for s in profile.get("skills", [])}
    if wanted in listed:
        return True
    text = "\n".join([job.get("title") or "" for job in profile.get("experience", [])]
                     + [h for job in profile.get("experience", []) for h in job.get("highlights", [])]
                     + list(profile.get("skills", []))).lower()
    return mentions(text, wanted)


def search(db: Session, f: Filters) -> tuple[list[dict], int]:
    """Run validated filters over the candidate data. Read-only; returns (rows, total matching)."""
    scores: dict[int, tuple[float, str | None]] = {}
    if f.job_id is not None:
        rows = db.scalars(select(Match).where(Match.job_id == f.job_id).options(selectinload(Match.panel_reviews)))
        for m in rows:
            panel = summary_from_rows(m.panel_reviews)
            scores[m.candidate_id] = (m.overall_score, panel.verdict if panel else None)

    records = []
    for c in db.scalars(select(Candidate)):
        profile = c.parsed_profile or {}
        score, verdict = scores.get(c.id, (None, None))
        years = float(profile.get("total_years_experience", 0.0))
        if f.min_years is not None and years < f.min_years:
            continue
        if f.max_years is not None and years > f.max_years:
            continue
        if f.stages and c.stage not in f.stages:
            continue
        if f.location and f.location not in (profile.get("location") or "").lower():
            continue
        if f.headline and f.headline not in (profile.get("headline") or "").lower():
            continue
        if any(not _has_skill(profile, s) for s in f.skills_all):
            continue
        if f.skills_any and not any(_has_skill(profile, s) for s in f.skills_any):
            continue
        if f.job_id is not None and (f.min_score is not None or f.max_score is not None or f.verdicts or f.sort_by == "score"):
            if score is None:
                continue  # never screened for this job
            if f.min_score is not None and score < f.min_score:
                continue
            if f.max_score is not None and score > f.max_score:
                continue
            if f.verdicts and verdict not in f.verdicts:
                continue
        records.append({
            "id": c.id, "name": c.name, "headline": profile.get("headline"), "location": profile.get("location"),
            "years": years, "skills": profile.get("skills", [])[:8], "stage": c.stage,
            "score": score, "verdict": verdict,
        })

    key = {"score": lambda r: r["score"] if r["score"] is not None else -1.0, "years": lambda r: r["years"],
           "recent": lambda r: r["id"]}.get(f.sort_by or "recent", lambda r: r["id"])
    records.sort(key=key, reverse=(f.direction == "desc"))
    return records[: f.limit], len(records)
