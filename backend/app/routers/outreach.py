from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.agents.outreach import EmailDraft, Kind, draft_email, fill, render, unresolved_fields
from app.config import get_settings
from app.db import get_db
from app.llm.client import LLMClient, get_llm
from app.models import Candidate, Job, Match, Message
from app.services.ics import build_ics
from app.services.retrieval import load_company_info

router = APIRouter(prefix="/api", tags=["outreach"])

MODE_LABEL = {"video": "video call", "phone": "phone call", "onsite": "in-person interview"}


class InterviewDetails(BaseModel):
    starts_at: datetime
    duration_minutes: int = Field(default=45, ge=15, le=240)
    mode: Literal["video", "phone", "onsite"] = "video"
    location: str = Field(default="", max_length=300)
    time_label: str = Field(min_length=3, max_length=120)  # the time as the recruiter wants it written in the email

    @field_validator("starts_at")
    @classmethod
    def _needs_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError("starts_at must include a timezone, for example 2026-10-01T15:30:00+05:30")
        return value


class OfferDetails(BaseModel):
    salary: str = Field(default="", max_length=100)
    start_date: str = Field(default="", max_length=60)
    reply_by: str = Field(default="", max_length=60)


class DraftRequest(BaseModel):
    job_id: int
    kind: Kind
    sender_name: str = Field(default="", max_length=80)
    interview: InterviewDetails | None = None
    offer: OfferDetails | None = None
    feedback_points: list[str] = Field(default_factory=list, max_length=5)
    include_gaps: bool = False  # for rejections: add the candidate's real skill gaps as gentle feedback

    @field_validator("feedback_points")
    @classmethod
    def _short_points(cls, points: list[str]) -> list[str]:
        return [p.strip()[:200] for p in points if p.strip()]


class EditRequest(BaseModel):
    subject: str = Field(min_length=1, max_length=120)
    body: str = Field(min_length=1, max_length=1800)

    @field_validator("subject")
    @classmethod
    def _one_line(cls, value: str) -> str:
        if "\n" in value or "\r" in value:
            raise ValueError("The subject must be a single line")
        return value.strip()


class StatusRequest(BaseModel):
    status: Literal["draft", "sent"]


class MessageOut(BaseModel):
    id: int
    candidate_id: int
    job_id: int | None
    kind: Kind
    status: Literal["draft", "sent"]
    subject: str  # with {{first_name}} still a placeholder, so blind mode can hide the name
    body: str
    rendered_subject: str  # with the real first name
    rendered_body: str
    unresolved_fields: list[str]  # bracketed details the recruiter still has to fill in
    has_ics: bool
    candidate_email: str
    created_at: datetime


def _first_name(candidate: Candidate) -> str:
    return candidate.name.split()[0] if candidate.name.split() else "there"


def _out(message: Message, candidate: Candidate) -> MessageOut:
    first = _first_name(candidate)
    return MessageOut(
        id=message.id, candidate_id=candidate.id, job_id=message.job_id, kind=message.kind, status=message.status,
        subject=message.subject, body=message.body, rendered_subject=render(message.subject, first),
        rendered_body=render(message.body, first), unresolved_fields=unresolved_fields(message.subject, message.body),
        has_ics=message.kind == "invite" and bool((message.extra or {}).get("starts_at")),
        candidate_email=candidate.email, created_at=message.created_at,
    )


def _gap_points(db: Session, job_id: int, candidate_id: int) -> list[str]:
    """Real, checkable feedback: required skills the candidate did not show in their work."""
    match = db.scalar(select(Match).where(Match.job_id == job_id, Match.candidate_id == candidate_id))
    if match is None:
        return []
    return [f"Hands-on experience with {s['skill']} in real projects"
            for s in (match.skill_details or []) if s["kind"] == "must" and s["status"] != "demonstrated"]


def _get_message(db: Session, message_id: int) -> Message:
    message = db.get(Message, message_id)
    if message is None:
        raise HTTPException(404, "Message not found")
    return message


@router.post("/candidates/{candidate_id}/messages", response_model=MessageOut, status_code=201)
def draft_message(candidate_id: int, body: DraftRequest, db: Session = Depends(get_db), llm: LLMClient = Depends(get_llm)):
    """Draft an email for a candidate. The AI never sees the candidate's name, the schedule or the salary."""
    candidate, job = db.get(Candidate, candidate_id), db.get(Job, body.job_id)
    if candidate is None:
        raise HTTPException(404, "Candidate not found")
    if job is None:
        raise HTTPException(404, "Job not found")
    if body.kind == "invite" and body.interview is None:
        raise HTTPException(422, "An invitation needs the interview details (time, length and format).")

    company, _ = load_company_info(get_settings().company_info_path)
    facts: list[str] = []
    if body.kind == "invite":
        facts = [f"Interview format: {MODE_LABEL[body.interview.mode]}", f"Interview length: {body.interview.duration_minutes} minutes"]
    points = list(body.feedback_points)
    if body.kind == "reject" and body.include_gaps:
        points += _gap_points(db, job.id, candidate.id)

    draft: EmailDraft = draft_email(kind=body.kind, job_title=job.title, company=company, facts=facts,
                                    feedback_points=points[:5], llm=llm)
    values = {"sender_name": body.sender_name.strip()}
    extra = None
    if body.interview:
        i = body.interview
        values |= {"interview_time": i.time_label.strip(), "duration": f"{i.duration_minutes} minutes",
                   "mode": MODE_LABEL[i.mode], "location": i.location.strip()}
        extra = {"starts_at": i.starts_at.isoformat(), "duration_minutes": i.duration_minutes, "mode": i.mode,
                 "location": i.location.strip(), "time_label": i.time_label.strip()}
    if body.offer:
        values |= {"salary": body.offer.salary.strip(), "start_date": body.offer.start_date.strip(),
                   "reply_by": body.offer.reply_by.strip()}

    message = Message(candidate_id=candidate.id, job_id=job.id, kind=body.kind, status="draft",
                      subject=fill(draft.subject.strip(), values), body=fill(draft.body.strip(), values), extra=extra)
    db.add(message)
    db.commit()
    return _out(message, candidate)


@router.get("/candidates/{candidate_id}/messages", response_model=list[MessageOut])
def list_messages(candidate_id: int, job_id: int | None = None, db: Session = Depends(get_db)):
    candidate = db.get(Candidate, candidate_id)
    if candidate is None:
        raise HTTPException(404, "Candidate not found")
    query = select(Message).where(Message.candidate_id == candidate_id).order_by(Message.id.desc())
    if job_id is not None:
        query = query.where(Message.job_id == job_id)
    return [_out(m, candidate) for m in db.scalars(query)]


@router.put("/messages/{message_id}", response_model=MessageOut)
def edit_message(message_id: int, body: EditRequest, db: Session = Depends(get_db)):
    message = _get_message(db, message_id)
    message.subject, message.body = body.subject, body.body
    db.commit()
    return _out(message, message.candidate)


@router.post("/messages/{message_id}/status", response_model=MessageOut)
def set_status(message_id: int, body: StatusRequest, db: Session = Depends(get_db)):
    """Emails are never sent by this app; the recruiter sends them and marks them as sent here."""
    message = _get_message(db, message_id)
    message.status = body.status
    db.commit()
    return _out(message, message.candidate)


@router.delete("/messages/{message_id}", status_code=204)
def delete_message(message_id: int, db: Session = Depends(get_db)):
    db.delete(_get_message(db, message_id))
    db.commit()


@router.get("/messages/{message_id}/invite.ics")
def invite_file(message_id: int, db: Session = Depends(get_db)) -> Response:
    """The calendar invitation for an interview email."""
    message = _get_message(db, message_id)
    details = message.extra or {}
    if message.kind != "invite" or not details.get("starts_at"):
        raise HTTPException(404, "This message has no calendar invitation.")
    job = db.get(Job, message.job_id) if message.job_id else None
    company, _ = load_company_info(get_settings().company_info_path)
    mode = MODE_LABEL.get(details.get("mode", ""), "interview")
    title = job.title if job else "Interview"
    ics = build_ics(
        uid=f"interview-{message.id}@airecruiter", starts_at=datetime.fromisoformat(details["starts_at"]),
        duration_minutes=details["duration_minutes"], summary=f"Interview: {title} at {company}",
        description=f"{mode.capitalize()} for the {title} role at {company}. {details.get('time_label', '')}".strip(),
        location=details.get("location", ""), attendee_email=message.candidate.email,
    )
    return Response(ics, media_type="text/calendar; charset=utf-8",
                    headers={"Content-Disposition": 'attachment; filename="interview-invite.ics"'})
