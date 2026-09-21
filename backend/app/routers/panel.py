import json
import logging
from collections.abc import Callable, Iterator
from concurrent.futures import ThreadPoolExecutor, as_completed

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.agents.jd_generator import JobRequirements
from app.agents.panel import (
    PERSONA_LABELS, PERSONAS, PanelResult, PersonaReview, collect_probes, decide, moderate, prepare_resume, review_as,
)
from app.agents.resume_parser import ParsedProfile
from app.db import get_db, get_session_factory
from app.llm.client import LLMClient, LLMError, get_llm
from app.models import Job, Match
from app.services.panel_store import PanelOut, PersonaReviewOut, panel_from_rows, save_panel

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["panel"])


def _sse(event: dict) -> str:
    return f"data: {json.dumps(event, default=str)}\n\n"


def _review_out(review: PersonaReview) -> dict:
    return PersonaReviewOut(
        persona=review.persona, label=PERSONA_LABELS[review.persona], score=review.score, stance=review.stance,
        reasoning=review.reasoning, strengths=review.strengths, concerns=review.concerns,
        evidence=[e.model_dump() for e in review.evidence], probe_questions=review.probe_questions,
        dropped_quotes=review.dropped_quotes,
    ).model_dump()


def _panel_stream(match_ids: list[int], llm: LLMClient, session_factory: Callable[[], Session]) -> Iterator[str]:
    completed = failed = 0
    for index, match_id in enumerate(match_ids, start=1):
        with session_factory() as db:
            match = db.get(Match, match_id)
            job = db.get(Job, match.job_id)
            candidate = match.candidate
            title = job.title
            requirements = (job.description or {}).get("requirements")
            profile_data, resume_text = candidate.parsed_profile, candidate.resume_text
        if not requirements or not profile_data:
            failed += 1
            yield _sse({"type": "panel_error", "match_id": match_id, "message": "This candidate or job is not ready for review."})
            continue

        profile = ParsedProfile(**profile_data)
        reqs = JobRequirements(**requirements)
        text = prepare_resume(resume_text, profile)
        yield _sse({"type": "panel_start", "match_id": match_id, "index": index, "total": len(match_ids)})

        pool = ThreadPoolExecutor(max_workers=len(PERSONAS))
        reviews: dict[str, PersonaReview] = {}
        try:
            futures = {
                pool.submit(review_as, p, job_title=title, requirements=reqs, years=profile.total_years_experience,
                            text=text, llm=llm): p
                for p in PERSONAS
            }
            for future in as_completed(futures):
                review = future.result()
                reviews[review.persona] = review
                yield _sse({"type": "persona", "match_id": match_id, "review": _review_out(review)})
            ordered = [reviews[p] for p in PERSONAS]
            decision = decide(ordered)
            yield _sse({"type": "status", "match_id": match_id, "message": "The moderator is writing the summary…"})
            result = PanelResult(ordered, decision, moderate(ordered, decision, job_title=title, llm=llm), collect_probes(ordered))
        except LLMError as exc:
            failed += 1
            yield _sse({"type": "panel_error", "match_id": match_id, "message": str(exc)})
            continue
        except Exception:
            logger.exception("panel for match %s failed", match_id)
            failed += 1
            yield _sse({"type": "panel_error", "match_id": match_id, "message": "Unexpected error during the panel review."})
            continue
        finally:
            pool.shutdown(wait=False, cancel_futures=True)

        with session_factory() as db:
            save_panel(db, match_id, result)
            panel = panel_from_rows(match_id, db.get(Match, match_id).panel_reviews)
        completed += 1
        yield _sse({"type": "panel", "match_id": match_id, "panel": panel.model_dump()})
    yield _sse({"type": "done", "completed": completed, "failed": failed})


def _stream_response(events: Iterator[str]) -> StreamingResponse:
    return StreamingResponse(events, media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/matches/{match_id}/panel")
def run_panel_for_match(match_id: int, db: Session = Depends(get_db), llm: LLMClient = Depends(get_llm),
                        session_factory: Callable[[], Session] = Depends(get_session_factory)):
    """Run (or re-run) the panel for one screened candidate. Streams each panelist as they finish."""
    if db.get(Match, match_id) is None:
        raise HTTPException(404, "Match not found")
    return _stream_response(_panel_stream([match_id], llm, session_factory))


@router.post("/jobs/{job_id}/panel")
def run_panel_for_top_candidates(
    job_id: int, top: int = Query(3, ge=1, le=10), db: Session = Depends(get_db),
    llm: LLMClient = Depends(get_llm), session_factory: Callable[[], Session] = Depends(get_session_factory),
):
    """Run the panel for the `top` best-scoring candidates of a job, one after another."""
    if db.get(Job, job_id) is None:
        raise HTTPException(404, "Job not found")
    ids = list(db.scalars(select(Match.id).where(Match.job_id == job_id)
                          .order_by(Match.overall_score.desc(), Match.id).limit(top)))
    if not ids:
        raise HTTPException(409, "Screen the candidates for this job first.")
    return _stream_response(_panel_stream(ids, llm, session_factory))


@router.get("/matches/{match_id}/panel", response_model=PanelOut | None)
def get_panel(match_id: int, db: Session = Depends(get_db)):
    """The saved panel review, or null if none has been run yet."""
    match = db.get(Match, match_id)
    if match is None:
        raise HTTPException(404, "Match not found")
    return panel_from_rows(match_id, match.panel_reviews)
