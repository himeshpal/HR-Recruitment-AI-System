"""Matcher agent: score one candidate against one job and explain why.

Four independent signals are blended in code (not by the model), so the result is explainable:
  skills      deterministic coverage of the job's skills: demonstrated > listed only > missing
  semantic    local-embedding similarity between the job and the best parts of the resume
  experience  years against the job's minimum, counted only as far as the experience is relevant
              (years of unrelated work must not earn credit)
  ai_review   the LLM's rubric judgement of a resume it sees only in anonymised form

Every evidence quote the LLM cites must appear verbatim in the resume it was shown; quotes that
do not are re-requested once and then dropped, so nothing invented is ever displayed.
"""

import json
import re
from dataclasses import dataclass, field

from pydantic import BaseModel, Field

from app.agents.jd_generator import JobRequirements
from app.agents.resume_parser import ParsedProfile
from app.llm.client import LLMClient
from app.llm.safety import UNTRUSTED_RULE, wrap_untrusted
from app.prompts import load_prompt
from app.services.anonymizer import anonymize_resume
from app.services.embeddings import Embedder, semantic_score
from app.services.skills import SkillDetail, assess_skills

# Blend weights, fixed in advance. A component that cannot be computed is dropped and the rest renormalised.
WEIGHTS = {"skills": 0.30, "semantic": 0.10, "experience": 0.20, "ai_review": 0.40}
# Inside the AI review. The experience_score line is not blended here: it is the relevance factor that
# gates the years-of-experience signal, so each judgement is used exactly once.
REVIEW_WEIGHTS = {"skills_score": 0.60, "domain_fit_score": 0.40}
MIN_QUOTE_CHARS = 12
MAX_RESUME_CHARS = 12_000


class Evidence(BaseModel):
    claim: str
    quote: str


class ReviewOutput(BaseModel):
    """What the LLM is asked to produce."""

    skills_score: float = Field(ge=0, le=100)
    experience_score: float = Field(ge=0, le=100)
    domain_fit_score: float = Field(ge=0, le=100)
    strengths: list[str] = Field(default_factory=list)
    gaps: list[str] = Field(default_factory=list)
    evidence: list[Evidence] = Field(default_factory=list)
    summary: str
    confidence: float = Field(ge=0, le=1)


@dataclass
class MatchResult:
    overall_score: float
    breakdown: dict[str, float | None]
    skill_details: list[SkillDetail]
    strengths: list[str]
    gaps: list[str]
    evidence: list[Evidence]
    summary: str
    confidence: float
    dropped_quotes: int
    reviewed_text: str  # exactly what the LLM saw
    review_scores: dict[str, float] = field(default_factory=dict)


def _canon(text: str) -> str:
    """Normalise for verbatim checks: case, whitespace, and typographic quotes/dashes."""
    text = text.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    text = re.sub(r"[–—−]", "-", text)
    return re.sub(r"\s+", " ", text).strip().lower()


def quote_in_text(quote: str, text: str) -> bool:
    return len(quote.strip()) >= MIN_QUOTE_CHARS and _canon(quote) in _canon(text)


def _split_evidence(evidence: list[Evidence], text: str) -> tuple[list[Evidence], list[Evidence]]:
    valid = [e for e in evidence if quote_in_text(e.quote, text)]
    invalid = [e for e in evidence if not quote_in_text(e.quote, text)]
    return valid, invalid


def job_brief(title: str, req: JobRequirements) -> str:
    return json.dumps(
        {
            "title": title,
            "must_have_skills": req.must_have_skills,
            "nice_to_have_skills": req.nice_to_have_skills,
            "minimum_years_experience": req.min_years_experience,
            "main_duties": req.responsibilities,
        },
        indent=2,
    )


def _chunks(profile: ParsedProfile) -> list[str]:
    """Identity-free pieces of the profile to compare against the job."""
    chunks = [profile.headline or "", f"Skills: {', '.join(profile.skills)}" if profile.skills else ""]
    for job in profile.experience:
        chunks.append(f"{job.title}. " + " ".join(job.highlights))
    return chunks


def _years_score(years: float, minimum: int) -> float | None:
    if minimum <= 0:
        return None  # the job sets no bar, so years say nothing
    return round(100 * min(1.0, years / minimum), 1)


def _review(job_title: str, req: JobRequirements, years: float, text: str, llm: LLMClient) -> tuple[ReviewOutput, int]:
    """Ask for the review, and re-ask once if it cites quotes that are not in the resume."""
    messages = [
        {"role": "system", "content": load_prompt("matcher") + "\n\n" + UNTRUSTED_RULE.format(tag="resume")},
        {
            "role": "user",
            "content": (
                f"JOB\n{job_brief(job_title, req)}\n\n"
                f"VERIFIED FACTS\nTotal years of professional experience, calculated from the dates: {years}\n\n"
                f"RESUME\n{wrap_untrusted('resume', text)}"
            ),
        },
    ]
    review = llm.chat_json(messages, ReviewOutput, agent="matcher", tier="large", reasoning_effort="low")
    valid, invalid = _split_evidence(review.evidence, text)
    if invalid:
        listing = "\n".join(f'- "{e.quote}"' for e in invalid)
        retry = [
            *messages,
            {"role": "assistant", "content": review.model_dump_json()},
            {
                "role": "user",
                "content": "These quotes are not copied word for word from the resume, so they were rejected:\n"
                f"{listing}\nReturn the same JSON again, replacing them with exact quotes from the resume "
                "(or removing them if the resume has no such evidence).",
            },
        ]
        review = llm.chat_json(retry, ReviewOutput, agent="matcher", tier="large", reasoning_effort="low")
        valid, invalid = _split_evidence(review.evidence, text)
    review.evidence = valid
    return review, len(invalid)


def _blend(components: dict[str, float | None]) -> float:
    available = {k: v for k, v in components.items() if v is not None}
    total_weight = sum(WEIGHTS[k] for k in available)
    return round(sum(WEIGHTS[k] * v for k, v in available.items()) / total_weight, 1)


def match_candidate(
    *,
    job_title: str,
    requirements: JobRequirements,
    profile: ParsedProfile,
    resume_text: str,
    llm: LLMClient,
    embedder: Embedder,
    anonymize: bool = True,
) -> MatchResult:
    """`anonymize=False` exists only so the fairness test can measure what the Bias Shield prevents."""
    text = (anonymize_resume(resume_text, profile) if anonymize else resume_text)[:MAX_RESUME_CHARS]

    skill_details, skills = assess_skills(requirements.must_have_skills, requirements.nice_to_have_skills, profile)
    query = " ".join(
        [job_title, "Skills:", ", ".join(requirements.must_have_skills), "Duties:", ". ".join(requirements.responsibilities)]
    )
    semantic = semantic_score(embedder, query, _chunks(profile))
    years = _years_score(profile.total_years_experience, requirements.min_years_experience)

    review, dropped = _review(job_title, requirements, profile.total_years_experience, text, llm)
    review_scores = {k: getattr(review, k) for k in (*REVIEW_WEIGHTS, "experience_score")}
    ai_review = round(sum(REVIEW_WEIGHTS[k] * review_scores[k] for k in REVIEW_WEIGHTS), 1)
    experience = None if years is None else round(years * review.experience_score / 100, 1)

    components = {"skills": skills, "semantic": semantic, "experience": experience, "ai_review": ai_review}
    return MatchResult(
        overall_score=_blend(components),
        breakdown=components,
        skill_details=skill_details,
        strengths=review.strengths[:4],
        gaps=review.gaps[:4],
        evidence=review.evidence,
        summary=review.summary,
        confidence=review.confidence,
        dropped_quotes=dropped,
        reviewed_text=text,
        review_scores=review_scores,
    )
