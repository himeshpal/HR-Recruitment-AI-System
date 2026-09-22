import asyncio
import json
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import AgentRun
from app.services.events import bus, preview_of

router = APIRouter(prefix="/api/agents", tags=["agents"])

HEARTBEAT_SECONDS = 15


class RunOut(BaseModel):
    id: int
    agent: str
    model: str
    tokens: int
    latency_ms: int
    cached: bool
    created_at: str
    preview: str | None  # only for agents that never see a candidate's identity


class AgentStat(BaseModel):
    agent: str
    calls: int
    cached: int
    tokens: int
    avg_latency_ms: int  # over real (uncached) calls only


class Stats(BaseModel):
    calls: int
    cached: int
    tokens: int
    agents: list[AgentStat]


def _sse(event: dict) -> str:
    return f"data: {json.dumps(event)}\n\n"


async def event_stream(after: int, request: Request | None = None) -> AsyncIterator[str]:
    """What the agents did since event `after`, then everything new as it happens."""
    queue = bus.subscribe()
    try:
        seen = after
        for event in bus.recent(after=after):  # the catch-up may overlap with what is already queued
            seen = event["seq"]
            yield _sse(event)
        while request is None or not await request.is_disconnected():
            try:
                event = await asyncio.wait_for(queue.get(), timeout=HEARTBEAT_SECONDS)
            except asyncio.TimeoutError:
                yield ": keep-alive\n\n"
                continue
            if event["seq"] > seen:
                seen = event["seq"]
                yield _sse(event)
    finally:
        bus.unsubscribe(queue)


@router.get("/stream")
async def stream(request: Request, after: int = Query(0, ge=0)):
    """Live agent activity as server-sent events. Pass `after` (the last seq you saw) to catch up."""
    return StreamingResponse(
        event_stream(after, request),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/recent")
def recent(after: int = Query(0, ge=0)) -> list[dict]:
    """The latest events still held in memory (the same events the stream sends)."""
    return bus.recent(after=after)


@router.get("/activity", response_model=list[RunOut])
def activity(limit: int = Query(30, ge=1, le=200), db: Session = Depends(get_db)):
    """The most recent agent calls from the database, newest first."""
    rows = db.scalars(select(AgentRun).order_by(AgentRun.id.desc()).limit(limit))
    return [
        RunOut(id=r.id, agent=r.agent, model=r.model, tokens=r.tokens, latency_ms=r.latency_ms, cached=r.cached,
               created_at=r.created_at.isoformat(), preview=preview_of(r.agent, r.output))
        for r in rows
    ]


@router.get("/stats", response_model=Stats)
def stats(db: Session = Depends(get_db)):
    """Calls, cache hits, tokens and typical speed per agent."""
    cached = func.sum(case((AgentRun.cached.is_(True), 1), else_=0))
    real_latency = func.avg(case((AgentRun.cached.is_(False), AgentRun.latency_ms)))
    rows = db.execute(
        select(AgentRun.agent, func.count(), cached, func.coalesce(func.sum(AgentRun.tokens), 0), real_latency)
        .group_by(AgentRun.agent).order_by(func.count().desc())
    ).all()
    agents = [AgentStat(agent=a, calls=c, cached=int(k or 0), tokens=int(t), avg_latency_ms=int(l or 0)) for a, c, k, t, l in rows]
    return Stats(calls=sum(a.calls for a in agents), cached=sum(a.cached for a in agents),
                 tokens=sum(a.tokens for a in agents), agents=agents)
