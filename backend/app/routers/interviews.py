from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.agents.interviewer import (
    MAX_ANSWER_CHARS, compute_scorecard, evaluate_answer, generate_questions, narrate, should_follow_up,
    simulate_answer,
)
from app.agents.jd_generator import JobRequirements, extract_requirements
from app.agents.panel import prepare_resume
from app.agents.resume_parser import ParsedProfile
from app.db import get_db
from app.llm.client import LLMClient, LLMError, get_llm
from app.models import Candidate, Interview, Job, Match
from app.services.panel_store import MODERATOR

router = APIRouter(prefix="/api/interviews", tags=["interviews"])


class InterviewCreate(BaseModel):
    candidate_id: int
    job_id: int


class AnswerIn(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_ANSWER_CHARS)


class TurnOut(BaseModel):
    role: Literal["interviewer", "candidate"]
    kind: Literal["question", "follow_up", "answer"]
    question_index: int
    text: str
    # Scores and feedback are the recruiter's view: they only appear once the interview is finished.
    content_score: float | None = None
    clarity_score: float | None = None
    feedback: str | None = None


class ProgressOut(BaseModel):
    current_question: int  # 1-based
    total_questions: int
    finished: bool


class ScorecardQuestion(BaseModel):
    index: int
    text: str
    competency: str
    score: float
    follow_up_asked: bool
    feedback: str


class ScorecardOut(BaseModel):
    overall: float
    recommendation: Literal["strong", "mixed", "weak"]
    competencies: dict[str, float]
    communication: float | None
    weights: dict[str, float]
    questions: list[ScorecardQuestion]
    summary: str
    strengths: list[str]
    concerns: list[str]
    duration_seconds: int | None = None


class CandidateLite(BaseModel):
    id: int
    name: str
    headline: str | None


class InterviewOut(BaseModel):
    id: int
    job_id: int
    job_title: str
    candidate: CandidateLite
    status: Literal["in_progress", "completed"]
    turns: list[TurnOut]
    progress: ProgressOut
    scorecard: ScorecardOut | None
    created_at: datetime
    completed_at: datetime | None


class InterviewSummary(BaseModel):
    id: int
    status: str
    created_at: datetime
    overall: float | None


def _get(db: Session, interview_id: int) -> Interview:
    interview = db.get(Interview, interview_id)
    if interview is None:
        raise HTTPException(404, "Interview not found")
    return interview


def _out(interview: Interview) -> InterviewOut:
    done = interview.status == "completed"
    turns = []
    for t in interview.transcript or []:
        hidden = {"content_score", "clarity_score", "feedback"} if not done else set()
        turns.append(TurnOut(**{k: v for k, v in t.items() if k not in hidden}))
    total = len(interview.questions or [])
    current = max((t["question_index"] for t in interview.transcript or []), default=0)
    profile = interview.candidate.parsed_profile or {}
    card = None
    if interview.scorecard:
        seconds = None
        if interview.completed_at:
            seconds = int((_aware(interview.completed_at) - _aware(interview.created_at)).total_seconds())
        card = ScorecardOut(**interview.scorecard, duration_seconds=seconds)
    return InterviewOut(
        id=interview.id, job_id=interview.job_id, job_title=interview.job.title,
        candidate=CandidateLite(id=interview.candidate.id, name=interview.candidate.name, headline=profile.get("headline")),
        status=interview.status, turns=turns,
        progress=ProgressOut(current_question=min(current + 1, total), total_questions=total, finished=done),
        scorecard=card, created_at=interview.created_at, completed_at=interview.completed_at,
    )


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=UTC)  # SQLite returns naive UTC timestamps


def _requirements(db: Session, job: Job, llm: LLMClient) -> JobRequirements:
    description = dict(job.description or {})
    if not description.get("requirements"):
        requirements = extract_requirements(description["markdown"], llm)
        job.description = {"markdown": description["markdown"], "requirements": requirements.model_dump()}
        db.commit()
        return requirements
    return JobRequirements(**description["requirements"])


def _areas_to_probe(db: Session, job_id: int, candidate_id: int) -> list[str]:
    """Doubts from the screening and the panel, so the interview tests the right things."""
    match = db.scalar(select(Match).where(Match.job_id == job_id, Match.candidate_id == candidate_id))
    if match is None:
        return []
    areas = [f"Possible gap: {g}" for g in (match.gaps or [])]
    moderator = next((r for r in match.panel_reviews if r.persona == MODERATOR), None)
    if moderator:
        areas += [f"Panel question: {q}" for q in (moderator.extra or {}).get("probe_questions", [])]
    return areas[:6]


@router.post("", response_model=InterviewOut, status_code=201)
def start_interview(body: InterviewCreate, response: Response, db: Session = Depends(get_db),
                    llm: LLMClient = Depends(get_llm)):
    """Plan the questions for a candidate and a job, and ask the first one. Resumes an unfinished interview."""
    candidate, job = db.get(Candidate, body.candidate_id), db.get(Job, body.job_id)
    if candidate is None:
        raise HTTPException(404, "Candidate not found")
    if job is None:
        raise HTTPException(404, "Job not found")
    if not candidate.parsed_profile:
        raise HTTPException(409, "This candidate has no parsed profile yet.")
    if not (job.description or {}).get("markdown", "").strip():
        raise HTTPException(409, "This job has no description yet. Generate or write one first.")

    existing = db.scalar(select(Interview).where(
        Interview.candidate_id == candidate.id, Interview.job_id == job.id, Interview.status == "in_progress"))
    if existing is not None:
        response.status_code = 200
        return _out(existing)

    profile = ParsedProfile(**candidate.parsed_profile)
    questions = generate_questions(
        job_title=job.title, requirements=_requirements(db, job, llm), years=profile.total_years_experience,
        resume_text=prepare_resume(candidate.resume_text, profile), areas_to_probe=_areas_to_probe(db, job.id, candidate.id),
        llm=llm,
    )
    interview = Interview(
        candidate_id=candidate.id, job_id=job.id, status="in_progress",
        questions=[q.model_dump() for q in questions],
        transcript=[{"role": "interviewer", "kind": "question", "question_index": 0, "text": questions[0].text}],
    )
    db.add(interview)
    if candidate.stage in ("applied", "screened"):
        candidate.stage = "interview"
    db.commit()
    return _out(interview)


@router.get("", response_model=list[InterviewSummary])
def list_interviews(candidate_id: int | None = None, job_id: int | None = None, db: Session = Depends(get_db)):
    query = select(Interview).order_by(Interview.id.desc())
    if candidate_id is not None:
        query = query.where(Interview.candidate_id == candidate_id)
    if job_id is not None:
        query = query.where(Interview.job_id == job_id)
    return [
        InterviewSummary(id=i.id, status=i.status, created_at=i.created_at,
                         overall=(i.scorecard or {}).get("overall"))
        for i in db.scalars(query)
    ]


@router.get("/{interview_id}", response_model=InterviewOut)
def get_interview(interview_id: int, db: Session = Depends(get_db)):
    return _out(_get(db, interview_id))


@router.post("/{interview_id}/answer", response_model=InterviewOut)
def answer(interview_id: int, body: AnswerIn, db: Session = Depends(get_db), llm: LLMClient = Depends(get_llm)):
    """Score the candidate's answer, then ask a follow-up, the next question, or finish with a scorecard."""
    interview = _get(db, interview_id)
    if interview.status != "in_progress":
        raise HTTPException(409, "This interview is already finished.")
    text = body.text.strip()
    if not text:
        raise HTTPException(422, "The answer is empty.")

    turns = list(interview.transcript or [])
    asked = turns[-1]
    if asked["role"] != "interviewer":
        raise HTTPException(409, "This answer was already recorded. Reload the interview.")
    questions = interview.questions
    index = asked["question_index"]
    is_follow_up = asked["kind"] == "follow_up"

    job = interview.job
    evaluation = evaluate_answer(
        job_title=job.title, requirements=_requirements(db, job, llm), question=questions[index], asked=asked["text"],
        answer=text, is_follow_up=is_follow_up, llm=llm,
    )

    db.refresh(interview)  # the LLM call took a while: make sure no other request answered in the meantime
    if len(interview.transcript or []) != len(turns):
        raise HTTPException(409, "This answer was already recorded. Reload the interview.")

    turns.append({
        "role": "candidate", "kind": "answer", "question_index": index, "text": text,
        "content_score": evaluation.content_score, "clarity_score": evaluation.clarity_score,
        "feedback": evaluation.feedback,
    })
    if should_follow_up(evaluation, is_follow_up=is_follow_up):
        turns.append({"role": "interviewer", "kind": "follow_up", "question_index": index, "text": evaluation.follow_up})
    elif index + 1 < len(questions):
        turns.append({"role": "interviewer", "kind": "question", "question_index": index + 1,
                      "text": questions[index + 1]["text"]})
    interview.transcript = turns
    db.commit()  # the answer is saved even if writing the scorecard fails below

    if turns[-1]["role"] == "candidate":
        _finish(db, interview, llm)
    return _out(interview)


def _finish(db: Session, interview: Interview, llm: LLMClient) -> None:
    numbers = compute_scorecard(interview.questions, interview.transcript)
    try:
        narrative = narrate(job_title=interview.job.title, numbers=numbers, llm=llm)
        written = {"summary": narrative.summary, "strengths": narrative.strengths, "concerns": narrative.concerns}
    except LLMError:
        written = {"summary": "The written summary could not be generated. The scores above are complete.",
                   "strengths": [], "concerns": []}
    interview.scorecard = {**numbers, **written}
    interview.status = "completed"
    interview.completed_at = datetime.now(UTC)
    db.commit()


@router.post("/{interview_id}/suggest-answer")
def suggest_answer(interview_id: int, quality: Literal["strong", "weak"] = "strong", db: Session = Depends(get_db),
                   llm: LLMClient = Depends(get_llm)) -> dict:
    """Demo helper: an AI writes a sample answer to the current question, so the interview can be tried without typing."""
    interview = _get(db, interview_id)
    if interview.status != "in_progress":
        raise HTTPException(409, "This interview is already finished.")
    candidate, job = interview.candidate, interview.job
    profile = ParsedProfile(**candidate.parsed_profile)
    text = simulate_answer(
        job_title=job.title, requirements=_requirements(db, job, llm),
        background=prepare_resume(candidate.resume_text, profile), question_text=interview.transcript[-1]["text"],
        quality=quality, llm=llm,
    )
    return {"text": text[:MAX_ANSWER_CHARS]}
