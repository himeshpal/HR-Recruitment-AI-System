from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.agents.skill_coach import CoachError, build_roadmap, find_gaps
from app.db import get_db
from app.llm.client import LLMClient, get_llm
from app.models import Match

router = APIRouter(prefix="/api", tags=["coach"])


class ResourceOut(BaseModel):
    title: str
    kind: str
    search_terms: str


class StepOut(BaseModel):
    skill: str
    priority: str
    why: str
    actions: list[str]
    practice_project: str
    weeks: int
    resources: list[ResourceOut]
    milestone: str


class RoadmapOut(BaseModel):
    summary: str
    steps: list[StepOut]
    total_weeks: int
    covers_all_required: bool


def _match(db: Session, match_id: int) -> Match:
    match = db.get(Match, match_id)
    if match is None:
        raise HTTPException(404, "Match not found")
    return match


@router.get("/matches/{match_id}/coach", response_model=RoadmapOut | None)
def get_roadmap(match_id: int, db: Session = Depends(get_db)):
    """The saved learning roadmap, or null if none has been made yet."""
    return _match(db, match_id).roadmap


@router.post("/matches/{match_id}/coach", response_model=RoadmapOut)
def make_roadmap(match_id: int, db: Session = Depends(get_db), llm: LLMClient = Depends(get_llm)):
    """Write (or rewrite) a learning roadmap for the skills this candidate did not show for the job."""
    match = _match(db, match_id)
    gaps = find_gaps(match.skill_details or [])
    if not gaps:
        raise HTTPException(409, "This candidate showed every skill the job asks for, so there is nothing to coach.")
    profile = match.candidate.parsed_profile or {}
    try:
        roadmap = build_roadmap(job_title=match.job.title, years=profile.get("total_years_experience", 0.0), gaps=gaps, llm=llm)
    except CoachError as exc:
        raise HTTPException(502, str(exc)) from exc
    match.roadmap = roadmap
    db.commit()
    return roadmap
