from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.agents.resume_parser import ParsedProfile, parse_resume
from app.db import get_db
from app.llm.client import LLMClient, get_llm
from app.models import Candidate
from app.services.resume_text import MAX_BYTES, ResumeFileError, extract_resume_text

router = APIRouter(prefix="/api/candidates", tags=["candidates"])


class CandidateOut(BaseModel):
    id: int
    name: str
    email: str
    stage: str
    profile: ParsedProfile | None
    created_at: datetime


class CandidateDetail(CandidateOut):
    resume_text: str


def _out(c: Candidate) -> dict:
    return {
        "id": c.id, "name": c.name, "email": c.email, "stage": c.stage,
        "profile": ParsedProfile(**c.parsed_profile) if c.parsed_profile else None,
        "created_at": c.created_at,
    }


@router.get("", response_model=list[CandidateOut])
def list_candidates(db: Session = Depends(get_db)):
    return [_out(c) for c in db.scalars(select(Candidate).order_by(Candidate.id.desc()))]


@router.get("/{candidate_id}", response_model=CandidateDetail)
def get_candidate(candidate_id: int, db: Session = Depends(get_db)):
    candidate = db.get(Candidate, candidate_id)
    if candidate is None:
        raise HTTPException(404, "Candidate not found")
    return {**_out(candidate), "resume_text": candidate.resume_text}


@router.post("/upload", response_model=CandidateOut, status_code=201)
def upload_resume(file: UploadFile, db: Session = Depends(get_db),
                  llm: LLMClient = Depends(get_llm)):
    """Read one resume file, parse it with the Resume Parser agent and save the candidate."""
    data = file.file.read(MAX_BYTES + 1)
    try:
        text = extract_resume_text(file.filename or "", data)
    except ResumeFileError as exc:
        raise HTTPException(422, str(exc)) from exc

    existing = db.scalar(select(Candidate).where(Candidate.resume_text == text))
    if existing is not None:
        raise HTTPException(409, f"This resume was already uploaded (candidate #{existing.id}, {existing.name}).")

    profile = parse_resume(text, llm)
    candidate = Candidate(
        name=profile.name, email=profile.email or "", resume_text=text,
        parsed_profile=profile.model_dump(), stage="applied",
    )
    db.add(candidate)
    db.commit()
    return _out(candidate)


class StageUpdate(BaseModel):
    stage: Literal["applied", "screened", "interview", "offer", "rejected"]


@router.patch("/{candidate_id}/stage", response_model=CandidateOut)
def set_stage(candidate_id: int, body: StageUpdate, db: Session = Depends(get_db)):
    """Move a candidate along the hiring pipeline (used by the Kanban board)."""
    candidate = db.get(Candidate, candidate_id)
    if candidate is None:
        raise HTTPException(404, "Candidate not found")
    candidate.stage = body.stage
    db.commit()
    return _out(candidate)


@router.delete("/{candidate_id}", status_code=204)
def delete_candidate(candidate_id: int, db: Session = Depends(get_db)):
    candidate = db.get(Candidate, candidate_id)
    if candidate is None:
        raise HTTPException(404, "Candidate not found")
    db.delete(candidate)
    db.commit()
