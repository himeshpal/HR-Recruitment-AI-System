from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import distinct, func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Candidate, Interview, Job, Match, PanelReview

router = APIRouter(prefix="/api", tags=["dashboard"])


class FunnelStep(BaseModel):
    key: str
    label: str
    count: int
    help: str


class Dashboard(BaseModel):
    jobs: int
    candidates: int
    rejected: int
    funnel: list[FunnelStep]


@router.get("/dashboard", response_model=Dashboard)
def dashboard(db: Session = Depends(get_db)):
    """The hiring funnel. Every step counts distinct candidates, and each definition is shown in the UI.

    The last step is where the recruiter moved the candidate, so it is not forced to be smaller than the
    steps before it: a recruiter can move someone to Offer without an AI interview.
    """
    def count(query) -> int:
        return db.scalar(query) or 0

    total = count(select(func.count(Candidate.id)))
    screened = count(select(func.count(distinct(Match.candidate_id))))
    panel = count(
        select(func.count(distinct(Match.candidate_id))).join(PanelReview, PanelReview.match_id == Match.id)
    )
    interviewed = count(select(func.count(distinct(Interview.candidate_id))).where(Interview.status == "completed"))
    offers = count(select(func.count(Candidate.id)).where(Candidate.stage == "offer"))
    funnel = [
        FunnelStep(key="applied", label="Applied", count=total, help="Every uploaded candidate."),
        FunnelStep(key="screened", label="Screened", count=screened, help="Scored against at least one job."),
        FunnelStep(key="panel", label="Panel reviewed", count=panel, help="Reviewed by the three-person AI panel."),
        FunnelStep(key="interviewed", label="Interviewed", count=interviewed, help="Finished an AI interview."),
        FunnelStep(key="offer", label="Offer", count=offers, help="Moved to the Offer stage by a recruiter."),
    ]
    return Dashboard(
        jobs=count(select(func.count(Job.id))),
        candidates=total,
        rejected=count(select(func.count(Candidate.id)).where(Candidate.stage == "rejected")),
        funnel=funnel,
    )
