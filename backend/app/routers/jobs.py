import json
from collections.abc import Callable, Iterator
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.agents.jd_generator import JobRequirements, extract_requirements, stream_jd
from app.db import get_db, get_session_factory
from app.llm.client import LLMClient, LLMError, get_llm
from app.models import Job
from app.services.inclusive_language import LanguageFlag, check_inclusive_language

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


class JobCreate(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    brief: str = Field(default="", max_length=3000)


class JobUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=2, max_length=200)
    markdown: str | None = Field(default=None, max_length=30_000)


class JobOut(BaseModel):
    id: int
    title: str
    brief: str
    status: str
    markdown: str | None
    requirements: JobRequirements | None
    created_at: datetime


class LanguageCheckIn(BaseModel):
    text: str = Field(max_length=30_000)


def _to_out(job: Job) -> JobOut:
    desc = job.description or {}
    reqs = desc.get("requirements")
    return JobOut(
        id=job.id, title=job.title, brief=job.brief, status=job.status,
        markdown=desc.get("markdown"),
        requirements=JobRequirements(**reqs) if reqs else None,
        created_at=job.created_at,
    )


def _get_job(db: Session, job_id: int) -> Job:
    job = db.get(Job, job_id)
    if job is None:
        raise HTTPException(404, "Job not found")
    return job


@router.get("", response_model=list[JobOut])
def list_jobs(db: Session = Depends(get_db)):
    return [_to_out(j) for j in db.scalars(select(Job).order_by(Job.id.desc()))]


@router.post("", response_model=JobOut, status_code=201)
def create_job(body: JobCreate, db: Session = Depends(get_db)):
    job = Job(title=body.title.strip(), brief=body.brief.strip())
    db.add(job)
    db.commit()
    return _to_out(job)


@router.post("/check-language", response_model=list[LanguageFlag])
def check_language(body: LanguageCheckIn):
    return check_inclusive_language(body.text)


@router.get("/{job_id}", response_model=JobOut)
def get_job(job_id: int, db: Session = Depends(get_db)):
    return _to_out(_get_job(db, job_id))


@router.put("/{job_id}", response_model=JobOut)
def update_job(job_id: int, body: JobUpdate, db: Session = Depends(get_db)):
    job = _get_job(db, job_id)
    if body.title is not None:
        job.title = body.title.strip()
    if body.markdown is not None:
        # Edited text makes any earlier requirements stale, so they are cleared until re-analysed.
        job.description = {"markdown": body.markdown, "requirements": None}
        job.status = "ready" if body.markdown.strip() else "draft"
    db.commit()
    return _to_out(job)


@router.delete("/{job_id}", status_code=204)
def delete_job(job_id: int, db: Session = Depends(get_db)):
    db.delete(_get_job(db, job_id))
    db.commit()


@router.post("/{job_id}/analyze", response_model=JobOut)
def analyze_job(job_id: int, db: Session = Depends(get_db), llm: LLMClient = Depends(get_llm)):
    """Extract structured requirements from the saved job description."""
    job = _get_job(db, job_id)
    markdown = (job.description or {}).get("markdown")
    if not markdown or not markdown.strip():
        raise HTTPException(409, "Write or generate a job description first.")
    requirements = extract_requirements(markdown, llm)
    job.description = {"markdown": markdown, "requirements": requirements.model_dump()}
    db.commit()
    return _to_out(job)


def _sse(event: dict) -> str:
    return f"data: {json.dumps(event)}\n\n"


def _generate_events(job_id: int, title: str, brief: str, llm: LLMClient,
                     session_factory: Callable[[], Session]) -> Iterator[str]:
    parts: list[str] = []
    try:
        for piece in stream_jd(title, brief, llm):
            parts.append(piece)
            yield _sse({"type": "token", "text": piece})
    except LLMError as exc:
        yield _sse({"type": "error", "message": str(exc)})
        return

    markdown = "".join(parts).strip()
    if not markdown:
        yield _sse({"type": "error", "message": "The model returned an empty description. Try again."})
        return

    # The request's DB session may already be closed while streaming, so open our own.
    with session_factory() as db:
        job = db.get(Job, job_id)
        if job is not None:
            job.description = {"markdown": markdown, "requirements": None}
            job.status = "ready"
            db.commit()
    yield _sse({"type": "done", "markdown": markdown})


@router.post("/{job_id}/generate")
def generate_job_description(
    job_id: int,
    db: Session = Depends(get_db),
    llm: LLMClient = Depends(get_llm),
    session_factory: Callable[[], Session] = Depends(get_session_factory),
):
    """Stream a generated job description as server-sent events (token / done / error)."""
    job = _get_job(db, job_id)
    return StreamingResponse(
        _generate_events(job.id, job.title, job.brief, llm, session_factory),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
