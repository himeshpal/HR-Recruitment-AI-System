"""Saving and loading a panel result. It lives in the existing PanelReview table:
one row per persona, plus one row with persona="moderator" holding the decision and the summary."""

from collections.abc import Iterable
from typing import Literal

from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.agents.panel import PERSONA_LABELS, PERSONAS, PanelResult
from app.models import PanelReview

MODERATOR = "moderator"


class EvidenceItem(BaseModel):
    claim: str
    quote: str


class PersonaReviewOut(BaseModel):
    persona: str
    label: str
    score: float
    stance: Literal["hire", "maybe", "no_hire"]
    reasoning: str
    strengths: list[str]
    concerns: list[str]
    evidence: list[EvidenceItem]
    probe_questions: list[str]
    dropped_quotes: int


class DisagreementOut(BaseModel):
    topic: str
    detail: str


class PanelSummary(BaseModel):
    """The short version shown on cards."""

    verdict: Literal["hire", "maybe", "no_hire"]
    consensus_score: float
    agreement: Literal["high", "moderate", "low"]


class PanelOut(PanelSummary):
    match_id: int
    spread: float
    summary: str
    disagreements: list[DisagreementOut]
    key_risks: list[str]
    next_step: str
    probe_questions: list[str]
    reviews: list[PersonaReviewOut]


def save_panel(db: Session, match_id: int, result: PanelResult) -> None:
    """Replace any earlier panel for this match with `result`."""
    db.query(PanelReview).filter(PanelReview.match_id == match_id).delete()
    for review in result.reviews:
        db.add(PanelReview(
            match_id=match_id, persona=review.persona, score=review.score, reasoning=review.reasoning,
            extra={
                "stance": review.stance, "strengths": review.strengths, "concerns": review.concerns,
                "evidence": [e.model_dump() for e in review.evidence],
                "probe_questions": review.probe_questions, "dropped_quotes": review.dropped_quotes,
            },
        ))
    decision, moderator = result.decision, result.moderator
    db.add(PanelReview(
        match_id=match_id, persona=MODERATOR, score=decision.consensus_score, reasoning=moderator.summary,
        extra={
            "verdict": decision.verdict, "agreement": decision.agreement, "spread": decision.spread,
            "disagreements": [d.model_dump() for d in moderator.disagreements],
            "key_risks": moderator.key_risks, "next_step": moderator.next_step,
            "probe_questions": result.probe_questions,
        },
    ))
    db.commit()


def summary_from_rows(rows: Iterable[PanelReview]) -> PanelSummary | None:
    moderator = next((r for r in rows if r.persona == MODERATOR), None)
    if moderator is None:
        return None
    extra = moderator.extra or {}
    return PanelSummary(verdict=extra["verdict"], consensus_score=moderator.score, agreement=extra["agreement"])


def panel_from_rows(match_id: int, rows: Iterable[PanelReview]) -> PanelOut | None:
    rows = list(rows)
    moderator = next((r for r in rows if r.persona == MODERATOR), None)
    if moderator is None:
        return None
    extra = moderator.extra or {}
    by_persona = {r.persona: r for r in rows if r.persona != MODERATOR}
    reviews = []
    for persona in PERSONAS:  # always in panel order
        row = by_persona.get(persona)
        if row is None:
            continue
        e = row.extra or {}
        reviews.append(PersonaReviewOut(
            persona=persona, label=PERSONA_LABELS[persona], score=row.score, stance=e["stance"],
            reasoning=row.reasoning, strengths=e["strengths"], concerns=e["concerns"],
            evidence=e["evidence"], probe_questions=e["probe_questions"], dropped_quotes=e["dropped_quotes"],
        ))
    return PanelOut(
        match_id=match_id, verdict=extra["verdict"], consensus_score=moderator.score, agreement=extra["agreement"],
        spread=extra["spread"], summary=moderator.reasoning, disagreements=extra["disagreements"],
        key_risks=extra["key_risks"], next_step=extra["next_step"], probe_questions=extra["probe_questions"],
        reviews=reviews,
    )
