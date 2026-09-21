from datetime import UTC, datetime

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

STAGES = ("applied", "screened", "interview", "offer", "rejected")


def _now() -> datetime:
    return datetime.now(UTC)


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    brief: Mapped[str] = mapped_column(Text, default="")
    description: Mapped[dict | None] = mapped_column(JSON, default=None)
    status: Mapped[str] = mapped_column(String(20), default="draft")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    matches: Mapped[list["Match"]] = relationship(back_populates="job", cascade="all, delete-orphan")
    interviews: Mapped[list["Interview"]] = relationship(back_populates="job", cascade="all, delete-orphan")


class Candidate(Base):
    __tablename__ = "candidates"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    email: Mapped[str] = mapped_column(String(200), default="")
    resume_text: Mapped[str] = mapped_column(Text, default="")
    parsed_profile: Mapped[dict | None] = mapped_column(JSON, default=None)
    stage: Mapped[str] = mapped_column(String(20), default="applied")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    matches: Mapped[list["Match"]] = relationship(
        back_populates="candidate", cascade="all, delete-orphan"
    )
    interviews: Mapped[list["Interview"]] = relationship(
        back_populates="candidate", cascade="all, delete-orphan"
    )
    messages: Mapped[list["Message"]] = relationship(
        back_populates="candidate", cascade="all, delete-orphan"
    )


class Match(Base):
    __tablename__ = "matches"

    id: Mapped[int] = mapped_column(primary_key=True)
    job_id: Mapped[int] = mapped_column(ForeignKey("jobs.id"))
    candidate_id: Mapped[int] = mapped_column(ForeignKey("candidates.id"))
    overall_score: Mapped[float] = mapped_column(Float, default=0.0)
    breakdown: Mapped[dict | None] = mapped_column(JSON, default=None)
    evidence: Mapped[list | None] = mapped_column(JSON, default=None)
    strengths: Mapped[list | None] = mapped_column(JSON, default=None)
    gaps: Mapped[list | None] = mapped_column(JSON, default=None)
    summary: Mapped[str] = mapped_column(Text, default="")
    skill_details: Mapped[list | None] = mapped_column(JSON, default=None)  # per-skill: demonstrated / listed / missing
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    dropped_quotes: Mapped[int] = mapped_column(Integer, default=0)  # evidence quotes rejected as not verbatim
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    job: Mapped[Job] = relationship(back_populates="matches")
    candidate: Mapped[Candidate] = relationship(back_populates="matches")
    panel_reviews: Mapped[list["PanelReview"]] = relationship(
        back_populates="match", cascade="all, delete-orphan"
    )


class PanelReview(Base):
    __tablename__ = "panel_reviews"

    id: Mapped[int] = mapped_column(primary_key=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id"))
    persona: Mapped[str] = mapped_column(String(50))  # tech_lead | hr_manager | hiring_manager | moderator
    score: Mapped[float] = mapped_column(Float, default=0.0)
    reasoning: Mapped[str] = mapped_column(Text, default="")
    extra: Mapped[dict | None] = mapped_column(JSON, default=None)  # concerns, verdict, disagreements

    match: Mapped[Match] = relationship(back_populates="panel_reviews")


class Interview(Base):
    __tablename__ = "interviews"

    id: Mapped[int] = mapped_column(primary_key=True)
    candidate_id: Mapped[int] = mapped_column(ForeignKey("candidates.id"))
    job_id: Mapped[int] = mapped_column(ForeignKey("jobs.id"))
    transcript: Mapped[list | None] = mapped_column(JSON, default=None)
    scorecard: Mapped[dict | None] = mapped_column(JSON, default=None)
    status: Mapped[str] = mapped_column(String(20), default="in_progress")  # in_progress | completed
    questions: Mapped[list | None] = mapped_column(JSON, default=None)  # the planned questions, with answer keys
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)

    candidate: Mapped[Candidate] = relationship(back_populates="interviews")
    job: Mapped[Job] = relationship(back_populates="interviews")


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    candidate_id: Mapped[int] = mapped_column(ForeignKey("candidates.id"))
    kind: Mapped[str] = mapped_column(String(20))  # invite | reject | offer
    body: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    candidate: Mapped[Candidate] = relationship(back_populates="messages")


class AgentRun(Base):
    """One row per LLM call. Powers the dashboard's agent activity timeline."""

    __tablename__ = "agent_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    agent: Mapped[str] = mapped_column(String(50))
    model: Mapped[str] = mapped_column(String(100), default="")
    input_hash: Mapped[str] = mapped_column(String(64), default="")
    output: Mapped[str] = mapped_column(Text, default="")
    tokens: Mapped[int] = mapped_column(Integer, default=0)
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    cached: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
