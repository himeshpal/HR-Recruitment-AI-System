"""Panel Recommender: three independent reviewers and a moderator.

Three personas (Tech Lead, HR Manager, Hiring Manager) review the same anonymised resume on their own.
The consensus score, agreement level and verdict are decided by fixed rules in code, so the outcome
cannot be talked into anything by a resume or by the model. A moderator LLM then explains the outcome
and the disagreements in plain language.

As in the Matcher, every evidence quote must appear verbatim in the resume the panelist saw; quotes
that do not are dropped (and counted).
"""

import json
from dataclasses import dataclass, field
from typing import Literal

from pydantic import BaseModel, Field

from app.agents.jd_generator import JobRequirements
from app.agents.matcher import MAX_RESUME_CHARS, Evidence, job_brief, quote_in_text
from app.agents.resume_parser import ParsedProfile
from app.llm.client import LLMClient
from app.llm.safety import UNTRUSTED_RULE, wrap_untrusted
from app.prompts import load_prompt
from app.services.anonymizer import anonymize_resume

Persona = Literal["tech_lead", "hr_manager", "hiring_manager"]
Stance = Literal["hire", "maybe", "no_hire"]
Verdict = Literal["hire", "maybe", "no_hire"]
Agreement = Literal["high", "moderate", "low"]

PERSONAS: tuple[Persona, ...] = ("tech_lead", "hr_manager", "hiring_manager")
PERSONA_LABELS: dict[str, str] = {"tech_lead": "Tech Lead", "hr_manager": "HR Manager", "hiring_manager": "Hiring Manager"}

# Decision rules (fixed in advance, applied in code).
HIRE_AT = 70  # a panelist at or above this leans hire; a consensus at or above it can be a hire
NO_HIRE_BELOW = 45  # a panelist below this leans no-hire
HIGH_AGREEMENT_SPREAD = 15
MODERATE_AGREEMENT_SPREAD = 30

PERSONA_TIER = "large"
MODERATOR_TIER = "small"  # a separate model, and so a separate token budget, from the personas


class PersonaOutput(BaseModel):
    """What one persona is asked to produce."""

    score: float = Field(ge=0, le=100)
    reasoning: str
    strengths: list[str] = Field(default_factory=list)
    concerns: list[str] = Field(default_factory=list)
    evidence: list[Evidence] = Field(default_factory=list)
    probe_questions: list[str] = Field(default_factory=list)


class Disagreement(BaseModel):
    topic: str
    detail: str


class ModeratorOutput(BaseModel):
    summary: str
    disagreements: list[Disagreement] = Field(default_factory=list)
    key_risks: list[str] = Field(default_factory=list)
    next_step: str


@dataclass
class PersonaReview:
    persona: str
    score: float
    stance: Stance
    reasoning: str
    strengths: list[str]
    concerns: list[str]
    evidence: list[Evidence]
    probe_questions: list[str]
    dropped_quotes: int


@dataclass
class Decision:
    consensus_score: float
    spread: float
    agreement: Agreement
    verdict: Verdict


@dataclass
class PanelResult:
    reviews: list[PersonaReview]
    decision: Decision
    moderator: ModeratorOutput
    probe_questions: list[str] = field(default_factory=list)


def stance_for(score: float) -> Stance:
    if score >= HIRE_AT:
        return "hire"
    return "no_hire" if score < NO_HIRE_BELOW else "maybe"


def decide(reviews: list[PersonaReview]) -> Decision:
    """The panel's outcome from the reviewers' scores alone. Pure rules, no LLM."""
    scores = [r.score for r in reviews]
    consensus = round(sum(scores) / len(scores), 1)
    spread = round(max(scores) - min(scores), 1)
    doubters = sum(s < NO_HIRE_BELOW for s in scores)
    if doubters >= 2 or consensus < NO_HIRE_BELOW:
        verdict: Verdict = "no_hire"
    elif consensus >= HIRE_AT and doubters == 0:
        verdict = "hire"
    else:
        verdict = "maybe"
    agreement: Agreement = (
        "high" if spread <= HIGH_AGREEMENT_SPREAD else "moderate" if spread <= MODERATE_AGREEMENT_SPREAD else "low"
    )
    return Decision(consensus, spread, agreement, verdict)


def prepare_resume(resume_text: str, profile: ParsedProfile, anonymize: bool = True) -> str:
    """The text every panelist sees. Anonymised once and shared, so they all judge the same thing."""
    return (anonymize_resume(resume_text, profile) if anonymize else resume_text)[:MAX_RESUME_CHARS]


def review_as(
    persona: Persona, *, job_title: str, requirements: JobRequirements, years: float, text: str, llm: LLMClient
) -> PersonaReview:
    system = "\n\n".join(
        [load_prompt(f"panel_{persona}"), load_prompt("panel_common"), UNTRUSTED_RULE.format(tag="resume")]
    )
    user = (
        f"JOB\n{job_brief(job_title, requirements)}\n\n"
        f"VERIFIED FACTS\nTotal years of professional experience, calculated from the dates: {years}\n\n"
        f"RESUME\n{wrap_untrusted('resume', text)}"
    )
    out = llm.chat_json(
        [{"role": "system", "content": system}, {"role": "user", "content": user}],
        PersonaOutput, agent=f"panel_{persona}", tier=PERSONA_TIER, reasoning_effort="low",
    )
    valid = [e for e in out.evidence if quote_in_text(e.quote, text)]
    return PersonaReview(
        persona=persona, score=out.score, stance=stance_for(out.score), reasoning=out.reasoning,
        strengths=out.strengths[:3], concerns=out.concerns[:3], evidence=valid,
        probe_questions=out.probe_questions[:2], dropped_quotes=len(out.evidence) - len(valid),
    )


def moderate(reviews: list[PersonaReview], decision: Decision, *, job_title: str, llm: LLMClient) -> ModeratorOutput:
    panel = [
        {"panelist": PERSONA_LABELS[r.persona], "score": r.score, "reasoning": r.reasoning,
         "strengths": r.strengths, "concerns": r.concerns}
        for r in reviews
    ]
    facts = (
        f"JOB: {job_title}\n\nDECISION FACTS (decided by rules, do not change)\n"
        f"consensus score: {decision.consensus_score}\nspread between highest and lowest score: {decision.spread}\n"
        f"agreement: {decision.agreement}\nverdict: {decision.verdict}"
    )
    messages = [
        {"role": "system", "content": load_prompt("panel_moderator") + "\n\n" + UNTRUSTED_RULE.format(tag="reviews")},
        {"role": "user", "content": f"{facts}\n\nREVIEWS\n{wrap_untrusted('reviews', json.dumps(panel, indent=1))}"},
    ]
    out = llm.chat_json(messages, ModeratorOutput, agent="panel_moderator", tier=MODERATOR_TIER, reasoning_effort="low")
    out.disagreements = out.disagreements[:3]
    out.key_risks = out.key_risks[:3]
    return out


def collect_probes(reviews: list[PersonaReview]) -> list[str]:
    """All the panelists' interview questions, without duplicates, in panel order."""
    seen: set[str] = set()
    probes: list[str] = []
    for review in reviews:
        for question in review.probe_questions:
            key = question.strip().lower()
            if key and key not in seen:
                seen.add(key)
                probes.append(question.strip())
    return probes


def run_panel(
    *, job_title: str, requirements: JobRequirements, profile: ParsedProfile, resume_text: str,
    llm: LLMClient, anonymize: bool = True,
) -> PanelResult:
    """Convenience for scripts and tests: personas in parallel, then the moderator."""
    from concurrent.futures import ThreadPoolExecutor

    text = prepare_resume(resume_text, profile, anonymize)
    with ThreadPoolExecutor(max_workers=len(PERSONAS)) as pool:
        futures = [
            pool.submit(review_as, p, job_title=job_title, requirements=requirements,
                        years=profile.total_years_experience, text=text, llm=llm)
            for p in PERSONAS
        ]
        reviews = [f.result() for f in futures]
    decision = decide(reviews)
    return PanelResult(reviews, decision, moderate(reviews, decision, job_title=job_title, llm=llm), collect_probes(reviews))
