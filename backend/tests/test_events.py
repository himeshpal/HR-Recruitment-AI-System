import asyncio
import json
import threading

import openai
import pytest
from pydantic import BaseModel

from app.llm.client import LLMError, LLMValidationError
from app.services.events import EventBus, bus, may_preview, preview_of


class Answer(BaseModel):
    ok: bool


def since(seq):
    return bus.recent(after=seq)


def last_seq():
    recent = bus.recent()
    return recent[-1]["seq"] if recent else 0


# ---------- the bus ----------

def test_events_are_numbered_and_the_buffer_keeps_only_the_latest():
    small = EventBus(size=3)
    for i in range(5):
        small.publish("start", agent="matcher", n=i)
    recent = small.recent()
    assert [e["n"] for e in recent] == [2, 3, 4] and [e["seq"] for e in recent] == [3, 4, 5]
    assert [e["n"] for e in small.recent(after=4)] == [4]


def test_a_subscriber_receives_events_published_from_another_thread():
    async def scenario():
        local = EventBus()
        queue = local.subscribe()
        assert local.subscriber_count == 1
        threading.Thread(target=lambda: local.publish("finish", agent="qa_bot")).start()
        event = await asyncio.wait_for(queue.get(), timeout=5)
        local.unsubscribe(queue)
        return event, local.subscriber_count

    event, remaining = asyncio.run(scenario())
    assert event["type"] == "finish" and event["agent"] == "qa_bot" and remaining == 0


# ---------- previews never show what an identity-aware agent saw ----------

def test_only_agents_that_never_see_identity_are_previewed():
    assert preview_of("resume_parser", "Aarav Mehta aarav@example.com") is None
    for agent in ["matcher", "panel_tech_lead", "interview_evaluate", "qa_bot", "ask_hr", "skill_coach", "outreach_invite", "jd_generator"]:
        assert may_preview(agent)
    assert not may_preview("resume_parser") and not may_preview("something_new")


def test_a_preview_is_one_short_line():
    text = preview_of("matcher", "line one\n\n   line two " + "x" * 400)
    assert "\n" not in text and len(text) <= 220 and text.endswith("…")
    assert preview_of("matcher", "") is None


def test_json_replies_are_shown_as_the_words_a_person_would_read():
    assert preview_of("panel_tech_lead", json.dumps({"score": 30.0, "reasoning": "Thin on backend work.", "strengths": []})) == "Thin on backend work."
    assert preview_of("matcher", json.dumps({"skills_score": 80, "summary": "Strong Python.", "gaps": ["AWS"]})) == "Strong Python."
    assert preview_of("qa_bot", json.dumps({"answerable": True, "answer": "Three days a week.", "source_ids": ["company:1"]})) == "Three days a week."
    # No prose field: a compact line of the simple fields instead of raw JSON.
    line = preview_of("ask_hr", json.dumps({"kind": "search", "sort": "score", "conditions": [{"a": 1}, {"b": 2}]}))
    assert line == "kind: search · sort: score · conditions: 2" and "{" not in line
    assert preview_of("qa_bot", "plain text, not json") == "plain text, not json"


# ---------- the client publishes what it really does ----------

def test_a_real_call_announces_its_start_and_then_its_finish(make_llm):
    llm, _ = make_llm(["hello there"])
    mark = last_seq()
    llm.chat([{"role": "user", "content": "hi"}], agent="qa_bot")
    start, finish = [e for e in since(mark) if e["agent"] == "qa_bot"]
    assert (start["type"], finish["type"]) == ("start", "finish")
    assert start["call_id"] == finish["call_id"]
    assert finish["cached"] is False and finish["tokens"] == 10 and finish["preview"] == "hello there"


def test_a_cached_answer_is_only_a_finish_marked_cached(make_llm):
    llm, _ = make_llm(["cached text"])
    llm.chat([{"role": "user", "content": "same"}], agent="qa_bot")
    mark = last_seq()
    llm.chat([{"role": "user", "content": "same"}], agent="qa_bot")
    events = [e for e in since(mark) if e["agent"] == "qa_bot"]
    assert [e["type"] for e in events] == ["finish"] and events[0]["cached"] is True and events[0]["latency_ms"] == 0


def test_the_resume_parser_finishes_without_a_preview(make_llm):
    llm, _ = make_llm([json.dumps({"ok": True})])
    mark = last_seq()
    llm.chat_json([{"role": "user", "content": "Aarav Mehta, aarav@example.com"}], Answer, agent="resume_parser")
    finish = [e for e in since(mark) if e["type"] == "finish"][0]
    assert finish["agent"] == "resume_parser" and finish["preview"] is None


def test_a_rejected_request_announces_an_error(make_llm):
    request = openai.BadRequestError("nope", response=type("R", (), {"status_code": 400, "headers": {}, "request": None})(), body=None)
    llm, _ = make_llm([request])
    mark = last_seq()
    with pytest.raises(LLMError):
        llm.chat_json([{"role": "user", "content": "x"}], Answer, agent="matcher")
    kinds = [e["type"] for e in since(mark) if e["agent"] == "matcher"]
    assert kinds == ["start", "error"]


def test_output_that_never_validates_announces_an_error(make_llm):
    llm, _ = make_llm(["not json", "still not", "nope"])
    mark = last_seq()
    with pytest.raises(LLMValidationError):
        llm.chat_json([{"role": "user", "content": "y"}], Answer, agent="panel_tech_lead")
    events = [e for e in since(mark) if e["agent"] == "panel_tech_lead"]
    assert [e["type"] for e in events] == ["start", "error"] and "no valid Answer" in events[-1]["message"]


def test_parallel_calls_keep_their_own_ids(make_llm):
    llm, _ = make_llm(lambda kwargs: "same reply")
    mark = last_seq()
    threads = [threading.Thread(target=lambda i=i: llm.chat([{"role": "user", "content": f"q{i}"}], agent="panel_hr_manager")) for i in range(6)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    events = [e for e in since(mark) if e["agent"] == "panel_hr_manager"]
    starts = {e["call_id"] for e in events if e["type"] == "start"}
    finishes = {e["call_id"] for e in events if e["type"] == "finish"}
    assert len(starts) == 6 and starts == finishes  # every start is closed by the finish of the same call
