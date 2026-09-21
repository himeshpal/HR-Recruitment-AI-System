import json
import logging
from collections.abc import Callable, Iterator
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.agents.jd_generator import JobRequirements, extract_requirements
from app.agents.matcher import WEIGHTS, MatchResult, match_candidate, quote_in_text
from app.agents.resume_parser import ParsedProfile
from app.db import get_db, get_session_factory
from app.llm.client import LLMClient, LLMError, get_llm
from app.models import Candidate, Job, Match
from app.services.anonymizer import anonymize_resume
from app.services.embeddings import Embedder, get_embedder
from app.services.panel_store import PanelSummary, summary_from_rows

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["screening"])

MAX_WORKERS = 3  # parallel LLM calls; kept low for the free-tier rate limit


class EvidenceOut(BaseModel):
    claim: str
    quote: str
    in_original: bool | None = None  # only set on the detail view


class SkillDetailOut(BaseModel):
    skill: str
    kind: Literal["must", "nice"]
    status: Literal["demonstrated", "listed", "missing"]


class CandidateBrief(BaseModel):
    id: int
    name: str
    email: str
    headline: str | None
    location: str | None
    years: float
    stage: str


class MatchOut(BaseModel):
    id: int
    job_id: int
    overall_score: float
    breakdown: dict[str, float | None]
    weights: dict[str, float]  # how much each breakdown signal counts toward overall_score
    strengths: list[str]
    gaps: list[str]
    summary: str
    confidence: float
    dropped_quotes: int
    skill_details: list[SkillDetailOut]
    evidence: list[EvidenceOut]
    candidate: CandidateBrief
    panel: PanelSummary | None = None  # set once the panel has reviewed this candidate


class MatchDetail(MatchOut):
    resume_text: str  # the original
    anonymized_text: str  # exactly what the AI was allowed to see


def _brief(c: Candidate) -> CandidateBrief:
    profile = c.parsed_profile or {}
    return CandidateBrief(
        id=c.id, name=c.name, email=c.email, headline=profile.get("headline"),
        location=profile.get("location"), years=profile.get("total_years_experience", 0.0), stage=c.stage,
    )


def _match_out(m: Match, candidate: Candidate) -> dict:
    return {
        "id": m.id, "job_id": m.job_id, "overall_score": m.overall_score, "breakdown": m.breakdown or {}, "weights": WEIGHTS,
        "strengths": m.strengths or [], "gaps": m.gaps or [], "summary": m.summary or "",
        "confidence": m.confidence or 0.0, "dropped_quotes": m.dropped_quotes or 0,
        "skill_details": m.skill_details or [], "evidence": m.evidence or [],
        "candidate": _brief(candidate),
        "panel": summary_from_rows(m.panel_reviews),
    }


def _save_match(db: Session, job_id: int, candidate_id: int, result: MatchResult) -> Match:
    match = db.scalar(select(Match).where(Match.job_id == job_id, Match.candidate_id == candidate_id))
    if match is None:
        match = Match(job_id=job_id, candidate_id=candidate_id)
        db.add(match)
    match.overall_score = result.overall_score
    match.breakdown = result.breakdown
    match.evidence = [e.model_dump() for e in result.evidence]
    match.strengths = result.strengths
    match.gaps = result.gaps
    match.summary = result.summary
    match.confidence = result.confidence
    match.dropped_quotes = result.dropped_quotes
    match.skill_details = [{"skill": s.skill, "kind": s.kind, "status": s.status} for s in result.skill_details]
    candidate = db.get(Candidate, candidate_id)
    if candidate.stage == "applied":
        candidate.stage = "screened"
    db.commit()
    return match


def _sse(event: dict) -> str:
    return f"data: {json.dumps(event, default=str)}\n\n"


def _screen_events(job_id: int, force: bool, llm: LLMClient, embedder: Embedder,
                   session_factory: Callable[[], Session]) -> Iterator[str]:
    yield _sse({"type": "status", "message": "Reading the job requirements…"})
    with session_factory() as db:
        job = db.get(Job, job_id)
        title, description = job.title, dict(job.description or {})
    if not description.get("requirements"):
        try:
            requirements = extract_requirements(description["markdown"], llm)
        except LLMError as exc:
            yield _sse({"type": "error", "message": str(exc)})
            return
        with session_factory() as db:
            job = db.get(Job, job_id)
            job.description = {"markdown": description["markdown"], "requirements": requirements.model_dump()}
            db.commit()
    else:
        requirements = JobRequirements(**description["requirements"])

    with session_factory() as db:
        already = set(db.scalars(select(Match.candidate_id).where(Match.job_id == job_id)))
        candidates = [
            (c.id, c.resume_text, c.parsed_profile)
            for c in db.scalars(select(Candidate).order_by(Candidate.id))
            if force or c.id not in already
        ]
    yield _sse({"type": "start", "total": len(candidates), "skipped": 0 if force else len(already)})
    if not candidates:
        yield _sse({"type": "done", "matched": 0, "failed": 0})
        return

    yield _sse({"type": "status", "message": "Loading the embedding model (the first run downloads it)…"})
    try:
        embedder.ensure_loaded()
    except Exception as exc:
        logger.exception("embedding model failed to load")
        yield _sse({"type": "error", "message": f"Could not load the embedding model: {exc}"})
        return

    def score(item: tuple[int, str, dict | None]) -> MatchResult:
        _, text, profile = item
        if not profile:
            raise ValueError("this candidate has no parsed profile")
        return match_candidate(job_title=title, requirements=requirements, profile=ParsedProfile(**profile),
                               resume_text=text, llm=llm, embedder=embedder)

    pool = ThreadPoolExecutor(max_workers=MAX_WORKERS)
    matched = failed = 0
    try:
        futures = {pool.submit(score, item): item[0] for item in candidates}
        for done, future in enumerate(as_completed(futures), start=1):
            candidate_id = futures[future]
            try:
                result = future.result()
            except (LLMError, ValueError) as exc:
                failed += 1
                yield _sse({"type": "candidate_error", "candidate_id": candidate_id, "message": str(exc)})
            except Exception:
                logger.exception("screening candidate %s failed", candidate_id)
                failed += 1
                yield _sse({"type": "candidate_error", "candidate_id": candidate_id,
                            "message": "Unexpected error while scoring this candidate."})
            else:
                with session_factory() as db:
                    match = _save_match(db, job_id, candidate_id, result)
                    payload = _match_out(match, db.get(Candidate, candidate_id))
                matched += 1
                yield _sse({"type": "match", "match": MatchOut(**payload).model_dump()})
            yield _sse({"type": "progress", "done": done, "total": len(candidates)})
    finally:
        pool.shutdown(wait=False, cancel_futures=True)  # the client may have disconnected mid-run
    yield _sse({"type": "done", "matched": matched, "failed": failed})


@router.post("/jobs/{job_id}/screen")
def screen_job(
    job_id: int,
    force: bool = False,
    db: Session = Depends(get_db),
    llm: LLMClient = Depends(get_llm),
    embedder: Embedder = Depends(get_embedder),
    session_factory: Callable[[], Session] = Depends(get_session_factory),
):
    """Score every not-yet-screened candidate against the job; streams progress as server-sent events."""
    job = db.get(Job, job_id)
    if job is None:
        raise HTTPException(404, "Job not found")
    if not (job.description or {}).get("markdown", "").strip():
        raise HTTPException(409, "This job has no description yet. Generate or write one first.")
    return StreamingResponse(
        _screen_events(job_id, force, llm, embedder, session_factory),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/jobs/{job_id}/matches", response_model=list[MatchOut])
def list_matches(job_id: int, db: Session = Depends(get_db)):
    """Ranked best-first."""
    if db.get(Job, job_id) is None:
        raise HTTPException(404, "Job not found")
    rows = db.scalars(
        select(Match).where(Match.job_id == job_id).options(joinedload(Match.candidate), selectinload(Match.panel_reviews))
        .order_by(Match.overall_score.desc(), Match.id)
    )
    return [_match_out(m, m.candidate) for m in rows]


@router.get("/matches/{match_id}", response_model=MatchDetail)
def get_match(match_id: int, db: Session = Depends(get_db)):
    match = db.get(Match, match_id)
    if match is None:
        raise HTTPException(404, "Match not found")
    candidate = match.candidate
    anonymized = anonymize_resume(candidate.resume_text, ParsedProfile(**candidate.parsed_profile))
    out = _match_out(match, candidate)
    # Quotes are verified against the anonymised text; tell the viewer which also exist in the original.
    out["evidence"] = [
        {**e, "in_original": quote_in_text(e["quote"], candidate.resume_text)} for e in out["evidence"]
    ]
    return MatchDetail(**out, resume_text=candidate.resume_text, anonymized_text=anonymized)
