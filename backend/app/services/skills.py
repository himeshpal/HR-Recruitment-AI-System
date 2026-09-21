"""Deterministic skill matching: which required skills does a candidate really show?

Three outcomes per skill, so a keyword-stuffed skills list earns less than real experience:
  demonstrated - the skill appears in the candidate's job titles or achievements (full credit)
  listed       - it appears only in the skills list (half credit; quarter if marked "basic")
  missing      - not found
"""

import re
from dataclasses import dataclass
from typing import Literal, Protocol

Status = Literal["demonstrated", "listed", "missing"]
Kind = Literal["must", "nice"]

CREDIT = {"demonstrated": 1.0, "listed": 0.5, "missing": 0.0}
BASIC_CREDIT = 0.25
MUST_WEIGHT = 0.85  # nice-to-have skills can add at most 15% on top

# alias -> canonical name (both sides lower case)
_ALIASES = {
    "js": "javascript", "ecmascript": "javascript",
    "ts": "typescript",
    "node": "node.js", "nodejs": "node.js", "node js": "node.js",
    "react.js": "react", "reactjs": "react", "react js": "react",
    "next": "next.js", "nextjs": "next.js",
    "vue.js": "vue", "vuejs": "vue",
    "postgres": "postgresql", "psql": "postgresql",
    "mongo": "mongodb",
    "k8s": "kubernetes",
    "amazon web services": "aws",
    "gcp": "google cloud", "google cloud platform": "google cloud",
    "ms excel": "excel", "microsoft excel": "excel",
    "powerbi": "power bi",
    "restful apis": "rest apis", "restful api": "rest apis", "rest api": "rest apis", "rest": "rest apis",
    "ci/cd pipelines": "ci/cd", "cicd": "ci/cd",
    "ml": "machine learning",
    "sklearn": "scikit-learn",
}
_QUALIFIER = re.compile(r"\((?:basic|beginner|familiar|learning|elementary)[^)]*\)", re.IGNORECASE)


class _HasExperience(Protocol):
    skills: list[str]
    experience: list


@dataclass(frozen=True)
class SkillDetail:
    skill: str
    kind: Kind
    status: Status


def normalize_skill(raw: str) -> tuple[str, bool]:
    """Return (canonical lower-case name, is_basic_level)."""
    basic = bool(_QUALIFIER.search(raw))
    text = _QUALIFIER.sub("", raw).lower().strip(" .,;:-")
    text = re.sub(r"\s+", " ", text)
    return _ALIASES.get(text, text), basic


def _variants(canonical: str) -> list[str]:
    """The canonical name plus every alias that maps to it, longest first."""
    names = {canonical} | {alias for alias, target in _ALIASES.items() if target == canonical}
    return sorted(names, key=len, reverse=True)


def mentions(text: str, canonical: str) -> bool:
    """Whole-word search that copes with names like C++, Node.js and CI/CD."""
    return any(
        re.search(rf"(?<![a-z0-9+#]){re.escape(v)}(?![a-z0-9+#])", text)
        for v in _variants(canonical)
    )


def _demonstrated_text(profile: _HasExperience) -> str:
    parts: list[str] = []
    for job in profile.experience:
        parts.append(job.title or "")
        parts.extend(job.highlights)
    return "\n".join(parts).lower()


def assess_skills(must: list[str], nice: list[str], profile: _HasExperience) -> tuple[list[SkillDetail], float | None]:
    """Per-skill outcome plus an overall 0-100 skill-coverage score (None if the job lists no skills)."""
    proven = _demonstrated_text(profile)
    listed = {}
    for raw in profile.skills:
        name, basic = normalize_skill(raw)
        listed[name] = listed.get(name, True) and basic  # basic only if every mention is marked basic

    details: list[SkillDetail] = []
    credits: dict[Kind, list[float]] = {"must": [], "nice": []}
    for kind, skills in (("must", must), ("nice", nice)):
        for raw in skills:
            name, _ = normalize_skill(raw)
            if not name:
                continue
            if mentions(proven, name):
                status: Status = "demonstrated"
                credit = CREDIT[status]
            elif any(mentions(l, name) or mentions(name, l) for l in listed):
                status = "listed"
                only_basic = all(is_basic for l, is_basic in listed.items() if mentions(l, name) or mentions(name, l))
                credit = BASIC_CREDIT if only_basic else CREDIT[status]
            else:
                status, credit = "missing", 0.0
            details.append(SkillDetail(raw, kind, status))
            credits[kind].append(credit)

    if not credits["must"] and not credits["nice"]:
        return details, None
    must_avg = sum(credits["must"]) / len(credits["must"]) if credits["must"] else None
    nice_avg = sum(credits["nice"]) / len(credits["nice"]) if credits["nice"] else None
    if must_avg is None:
        score = nice_avg
    elif nice_avg is None:
        score = must_avg
    else:
        score = MUST_WEIGHT * must_avg + (1 - MUST_WEIGHT) * nice_avg
    return details, round(100 * score, 1)
