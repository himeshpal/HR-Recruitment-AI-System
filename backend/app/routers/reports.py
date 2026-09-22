import re

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Interview, Match
from app.services.panel_store import panel_from_rows
from app.services.report import build_report

router = APIRouter(prefix="/api", tags=["reports"])


@router.get("/matches/{match_id}/report.pdf")
def report(match_id: int, blind: bool = Query(True), db: Session = Depends(get_db)):
    """A PDF summary of one candidate for one job. Blind by default: pass `blind=false` to include name and email."""
    match = db.get(Match, match_id)
    if match is None:
        raise HTTPException(404, "Match not found")
    interview = db.scalars(
        select(Interview)
        .where(Interview.candidate_id == match.candidate_id, Interview.job_id == match.job_id, Interview.status == "completed")
        .order_by(Interview.id.desc())
    ).first()
    pdf = build_report(match, panel_from_rows(match.id, match.panel_reviews), interview, blind=blind)
    stem = f"candidate-{match.candidate_id}" if blind else re.sub(r"[^A-Za-z0-9]+", "-", match.candidate.name).strip("-").lower() or f"candidate-{match.candidate_id}"
    return Response(pdf, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{stem}-report.pdf"'})
