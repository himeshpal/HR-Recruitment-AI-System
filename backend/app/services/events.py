"""A tiny in-memory event bus: what the agents are doing right now.

`LLMClient` publishes one event when a call starts and one when it finishes or fails, so the Live Agent Graph
shows real activity and cannot show anything that did not happen. Events are only kept in memory (a ring buffer
of the latest few hundred, so a page opened mid-run can catch up); the durable record is the `AgentRun` table.

Privacy: the preview of an agent's output ("what it is thinking") is only included for agents that never see
who a candidate is. The Resume Parser reads the raw resume, so its output is never previewed.
"""

import asyncio
import itertools
import json
import threading
from collections import deque
from datetime import datetime, timezone
from typing import Any

BUFFER_SIZE = 300
PREVIEW_CHARS = 220

# Agents whose input and output are free of the candidate's identity (the Bias Shield anonymises resumes first,
# and the Outreach agent is only ever given placeholders).
PREVIEW_ALLOWED_PREFIXES = (
    "jd_", "matcher", "panel_", "interview_", "qa_bot", "ask_hr", "skill_coach", "outreach_",
)


def may_preview(agent: str) -> bool:
    return agent.startswith(PREVIEW_ALLOWED_PREFIXES)


# The field of a JSON reply that reads like the agent's own words, most telling first.
_WORDS = ("summary", "reasoning", "feedback", "answer", "next_step", "body", "understood", "subject")


def _readable(text: str) -> str:
    """Agents reply in JSON. Show what a person would want to read: the prose field if there is one,
    otherwise a compact 'key: value' line of the simple fields."""
    try:
        data = json.loads(text)
    except ValueError:
        return text
    if not isinstance(data, dict):
        return text
    for key in _WORDS:
        if isinstance(data.get(key), str) and data[key].strip():
            return data[key]
    parts = []
    for key, value in data.items():
        if isinstance(value, (str, int, float, bool)):
            parts.append(f"{key.replace('_', ' ')}: {value}")
        elif isinstance(value, list):
            parts.append(f"{key.replace('_', ' ')}: {len(value)}")
    return " · ".join(parts) or text


def preview_of(agent: str, text: str) -> str | None:
    """A short, single-line excerpt of an agent's output, or None if this agent may not be previewed."""
    if not may_preview(agent) or not text:
        return None
    flat = " ".join(_readable(text).split())
    return flat if len(flat) <= PREVIEW_CHARS else flat[: PREVIEW_CHARS - 1].rstrip() + "…"


class EventBus:
    def __init__(self, size: int = BUFFER_SIZE):
        self._lock = threading.Lock()
        self._seq = itertools.count(1)
        self._recent: deque[dict[str, Any]] = deque(maxlen=size)
        self._subscribers: list[tuple[asyncio.AbstractEventLoop, asyncio.Queue]] = []

    def publish(self, type_: str, **fields: Any) -> dict[str, Any]:
        """Record an event and hand it to every live subscriber. Safe to call from any thread."""
        event = {"seq": next(self._seq), "type": type_, "at": datetime.now(timezone.utc).isoformat(), **fields}
        with self._lock:
            self._recent.append(event)
            targets = list(self._subscribers)
        for loop, queue in targets:
            try:
                loop.call_soon_threadsafe(queue.put_nowait, event)
            except RuntimeError:  # that page's loop has gone away; it will be removed when it unsubscribes
                pass
        return event

    def recent(self, after: int = 0) -> list[dict[str, Any]]:
        with self._lock:
            return [e for e in self._recent if e["seq"] > after]

    def subscribe(self) -> asyncio.Queue:
        """Call from the event loop that will read the queue."""
        queue: asyncio.Queue = asyncio.Queue(maxsize=1000)
        with self._lock:
            self._subscribers.append((asyncio.get_running_loop(), queue))
        return queue

    def unsubscribe(self, queue: asyncio.Queue) -> None:
        with self._lock:
            self._subscribers = [(l, q) for l, q in self._subscribers if q is not queue]

    @property
    def subscriber_count(self) -> int:
        with self._lock:
            return len(self._subscribers)


bus = EventBus()
