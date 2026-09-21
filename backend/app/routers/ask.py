from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.agents.ask_hr import AskError, compile_plan, describe, plan_search, search
from app.db import get_db
from app.llm.client import LLMClient, LLMValidationError, get_llm
from app.models import Job

router = APIRouter(prefix="/api", tags=["ask-hr"])


class AskRequest(BaseModel):
    question: str = Field(min_length=3, max_length=300)
    job_id: int | None = None  # the job the recruiter is looking at, if any


class ResultRow(BaseModel):
    id: int
    name: str
    headline: str | None
    location: str | None
    years: float
    skills: list[str]
    stage: str
    score: float | None
    verdict: str | None


class AskResponse(BaseModel):
    understood: str | None  # the search, in plain words
    refusal: str | None
    total: int
    results: list[ResultRow]
    job: dict | None = None


@router.post("/ask", response_model=AskResponse)
def ask_hr(body: AskRequest, db: Session = Depends(get_db), llm: LLMClient = Depends(get_llm)):
    """Search the candidate pool with a plain-English question. Read-only, and never returns contact details."""
    jobs = {j.id: j.title for j in db.scalars(select(Job).order_by(Job.id.desc()))}
    question = " ".join(body.question.split())
    try:
        plan = plan_search(question=question, jobs=jobs, current_job_id=body.job_id, llm=llm)
    except LLMValidationError:  # the model kept proposing filters that do not exist, which is a refusal, not a crash
        return AskResponse(understood=None, refusal="I can only search candidates by skills, experience, stage, location, title, score and panel verdict.", total=0, results=[])
    try:
        filters = compile_plan(plan, jobs, body.job_id)
    except AskError as exc:
        return AskResponse(understood=None, refusal=str(exc), total=0, results=[])

    rows, total = search(db, filters)
    job = {"id": filters.job_id, "title": jobs[filters.job_id]} if filters.job_id else None
    return AskResponse(understood=describe(filters, job["title"] if job else None), refusal=None, total=total,
                       results=[ResultRow(**r) for r in rows], job=job)
