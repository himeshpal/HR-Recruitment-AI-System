from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.agents.qa_bot import answer_question
from app.config import get_settings
from app.db import get_db
from app.llm.client import LLMClient, get_llm
from app.models import Job, QaEntry
from app.services.embeddings import Embedder, get_embedder
from app.services.retrieval import Chunk, chunk_markdown, load_company_info, retrieve

router = APIRouter(prefix="/api", tags=["qa"])


class QuestionIn(BaseModel):
    question: str = Field(min_length=3, max_length=500)


class SourceOut(BaseModel):
    id: str
    label: str
    excerpt: str


class QaOut(BaseModel):
    id: int
    question: str
    answer: str
    sources: list[SourceOut]
    escalated: bool
    reason: str
    resolved: bool
    created_at: datetime


class ResolveIn(BaseModel):
    resolved: bool


def get_company_info() -> tuple[str, list[Chunk]]:
    """Overridable in tests. Read on every call, so editing the file takes effect without a restart."""
    return load_company_info(get_settings().company_info_path)


def _source(chunk: Chunk) -> SourceOut:
    excerpt = chunk.text if len(chunk.text) <= 220 else chunk.text[:217].rstrip() + "…"
    return SourceOut(id=chunk.id, label=chunk.label, excerpt=excerpt)


def _out(entry: QaEntry) -> QaOut:
    return QaOut(id=entry.id, question=entry.question, answer=entry.answer,
                 sources=[SourceOut(**s) for s in entry.sources or []], escalated=entry.escalated,
                 reason=entry.reason, resolved=entry.resolved, created_at=entry.created_at)


@router.post("/jobs/{job_id}/qa", response_model=QaOut)
def ask_about_job(
    job_id: int, body: QuestionIn, db: Session = Depends(get_db), llm: LLMClient = Depends(get_llm),
    embedder: Embedder = Depends(get_embedder), company: tuple[str, list[Chunk]] = Depends(get_company_info),
):
    """Answer a candidate's question from the job description and company info, or pass it to the recruiter."""
    job = db.get(Job, job_id)
    if job is None:
        raise HTTPException(404, "Job not found")
    markdown = (job.description or {}).get("markdown", "")
    chunks = [*chunk_markdown(markdown, "job"), *company[1]]

    question = " ".join(body.question.split())
    result = answer_question(question=question, job_title=job.title,
                             retrieved=retrieve(question, chunks, embedder), llm=llm)
    entry = QaEntry(
        job_id=job.id, question=question, answer=result.answer, escalated=result.escalated, reason=result.reason,
        sources=[_source(c).model_dump() for c in result.sources],
    )
    db.add(entry)
    db.commit()
    return _out(entry)


@router.get("/jobs/{job_id}/qa", response_model=list[QaOut])
def list_questions(job_id: int, escalated_only: bool = False, db: Session = Depends(get_db)):
    """The recruiter's view: what candidates asked. `escalated_only` is the inbox of unanswered questions."""
    if db.get(Job, job_id) is None:
        raise HTTPException(404, "Job not found")
    query = select(QaEntry).where(QaEntry.job_id == job_id).order_by(QaEntry.id.desc())
    if escalated_only:
        query = query.where(QaEntry.escalated.is_(True))
    return [_out(e) for e in db.scalars(query)]


@router.patch("/qa/{entry_id}", response_model=QaOut)
def resolve_question(entry_id: int, body: ResolveIn, db: Session = Depends(get_db)):
    entry = db.get(QaEntry, entry_id)
    if entry is None:
        raise HTTPException(404, "Question not found")
    entry.resolved = body.resolved
    db.commit()
    return _out(entry)
