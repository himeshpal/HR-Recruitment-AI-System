import asyncio
import io
import json
import threading

import pdfplumber
import pytest

from app.models import AgentRun, Candidate, Interview, Match
from app.routers.agents import event_stream
from app.routers.evaluation import load_evaluation
from app.services.events import bus
from tests.test_api_screening import ok_review, seed


@pytest.fixture
def screened(api, session_factory):
    client, fake = api(ok_review)
    job_id = seed(session_factory, count=3)
    client.post(f"/api/jobs/{job_id}/screen")
    match_id = client.get(f"/api/jobs/{job_id}/matches").json()[0]["id"]
    return client, session_factory, job_id, match_id


# ---------- the dashboard funnel ----------

def test_funnel_counts_distinct_candidates_at_each_step(api, session_factory):
    client, _ = api(ok_review)
    job_id = seed(session_factory, count=3)
    steps = lambda: {s["key"]: s["count"] for s in client.get("/api/dashboard").json()["funnel"]}
    assert steps() == {"applied": 3, "screened": 0, "panel": 0, "interviewed": 0, "offer": 0}

    client.post(f"/api/jobs/{job_id}/screen")
    assert steps()["screened"] == 3
    client.post(f"/api/jobs/{job_id}/screen?force=true")  # screening again must not count anyone twice
    assert steps()["screened"] == 3


def test_panel_interview_offer_and_rejected_are_counted_from_the_data(screened):
    client, sf, job_id, match_id = screened
    with sf() as db:
        match = db.get(Match, match_id)
        from app.models import PanelReview

        db.add(PanelReview(match_id=match_id, persona="tech_lead", score=80.0, reasoning="x"))
        db.add(Interview(candidate_id=match.candidate_id, job_id=job_id, status="completed"))
        db.add(Interview(candidate_id=match.candidate_id, job_id=job_id, status="completed"))  # a second one: still one person
        other = db.query(Candidate).filter(Candidate.id != match.candidate_id).all()
        other[0].stage, other[1].stage = "offer", "rejected"
        db.add(Interview(candidate_id=other[0].id, job_id=job_id, status="in_progress"))  # unfinished: not counted
        db.commit()
    data = client.get("/api/dashboard").json()
    steps = {s["key"]: s["count"] for s in data["funnel"]}
    assert steps == {"applied": 3, "screened": 3, "panel": 1, "interviewed": 1, "offer": 1}
    assert data["rejected"] == 1 and data["jobs"] == 1 and data["candidates"] == 3
    assert all(s["help"] for s in data["funnel"])


# ---------- agent activity ----------

def test_activity_and_stats_come_from_the_recorded_runs_and_hide_identity_aware_output(api, session_factory):
    client, _ = api([])
    with session_factory() as db:
        db.add_all([
            AgentRun(agent="resume_parser", model="m", output='{"name": "Aarav Mehta", "email": "aarav@example.com"}', tokens=100, latency_ms=900),
            AgentRun(agent="matcher", model="m", output='{"summary": "Strong Python."}', tokens=200, latency_ms=1100),
            AgentRun(agent="matcher", model="m", output="cached one", tokens=0, latency_ms=0, cached=True),
        ])
        db.commit()
    activity = client.get("/api/agents/activity?limit=10").json()
    assert [r["agent"] for r in activity] == ["matcher", "matcher", "resume_parser"]  # newest first
    parser = activity[-1]
    assert parser["preview"] is None and "Aarav" not in json.dumps(activity)
    assert "Strong Python" in activity[1]["preview"]

    stats = client.get("/api/agents/stats").json()
    assert (stats["calls"], stats["cached"], stats["tokens"]) == (3, 1, 300)
    matcher = next(a for a in stats["agents"] if a["agent"] == "matcher")
    assert (matcher["calls"], matcher["cached"], matcher["avg_latency_ms"]) == (2, 1, 1100)  # speed ignores the cache hit
    assert client.get("/api/agents/activity?limit=0").status_code == 422


def test_recent_events_endpoint_returns_the_buffer_after_a_point(api):
    client, _ = api([])
    first = bus.publish("start", call_id="a", agent="matcher", model="m")
    bus.publish("finish", call_id="a", agent="matcher", model="m", tokens=1, latency_ms=2, cached=False, preview=None)
    events = client.get(f"/api/agents/recent?after={first['seq']}").json()
    assert [e["type"] for e in events][:1] == ["finish"]


def test_the_stream_catches_up_then_delivers_live_events_and_cleans_up():
    async def scenario():
        before = bus.publish("start", call_id="s1", agent="qa_bot", model="m")
        stream = event_stream(after=before["seq"] - 1)
        first = json.loads((await stream.__anext__()).removeprefix("data: "))  # the catch-up event
        threading.Thread(target=lambda: bus.publish("finish", call_id="s1", agent="qa_bot", model="m")).start()
        second = json.loads((await asyncio.wait_for(stream.__anext__(), 5)).removeprefix("data: "))
        subscribed = bus.subscriber_count
        await stream.aclose()
        return first, second, subscribed, bus.subscriber_count

    first, second, during, after = asyncio.run(scenario())
    assert first["type"] == "start" and second["type"] == "finish" and second["call_id"] == "s1"
    assert during >= 1 and after == during - 1


# ---------- the PDF report ----------

def pdf_text(data: bytes) -> str:
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        return "\n".join(page.extract_text() or "" for page in pdf.pages)


def test_the_report_is_blind_by_default(screened):
    client, sf, _, match_id = screened
    response = client.get(f"/api/matches/{match_id}/report.pdf")
    assert response.status_code == 200 and response.headers["content-type"] == "application/pdf"
    assert response.content.startswith(b"%PDF") and "candidate-" in response.headers["content-disposition"]
    text = pdf_text(response.content)
    with sf() as db:
        match = db.get(Match, match_id)
        name, email, cid = match.candidate.name, match.candidate.email, match.candidate_id
    assert f"Candidate #{cid}" in text and "match score" in text.lower() and "evidence from the resume" in text.lower()
    assert name not in text and email not in text


def test_the_named_report_includes_identity_and_the_real_score(screened):
    client, sf, _, match_id = screened
    with sf() as db:
        match = db.get(Match, match_id)
        name, email, score = match.candidate.name, match.candidate.email, round(match.overall_score)
    text = pdf_text(client.get(f"/api/matches/{match_id}/report.pdf?blind=false").content)
    assert name in text and email in text and str(score) in text


def test_the_report_survives_awkward_text(screened):
    client, sf, _, match_id = screened
    with sf() as db:
        match = db.get(Match, match_id)
        match.summary = "Great “quotes” — dashes… and 日本語 " + "x" * 300  # curly quotes, non-Latin text, one very long word
        match.strengths = ["•" * 10, "ok"]
        db.commit()
    response = client.get(f"/api/matches/{match_id}/report.pdf")
    assert response.status_code == 200 and "Great" in pdf_text(response.content)


def test_the_report_includes_panel_and_scorecard_when_they_exist(screened):
    client, sf, job_id, match_id = screened
    with sf() as db:
        from app.models import PanelReview

        match = db.get(Match, match_id)
        db.add(PanelReview(match_id=match_id, persona="moderator", score=71.0, reasoning="They mostly agree.",
                           extra={"verdict": "hire", "consensus_score": 71.0, "agreement": "high", "spread": 4.0, "summary": "They mostly agree.",
                                 "disagreements": [], "key_risks": ["Little cloud work"], "next_step": "Interview", "probe_questions": []}))
        db.add(Interview(candidate_id=match.candidate_id, job_id=job_id, status="completed",
                         scorecard={"overall": 82.0, "recommendation": "strong", "competencies": {"technical": 8.0}, "communication": 7.0,
                                    "weights": {}, "questions": [], "summary": "Solid answers.", "strengths": [], "concerns": []}))
        db.commit()
    text = pdf_text(client.get(f"/api/matches/{match_id}/report.pdf").content)
    assert "panel review" in text.lower() and "ai interview scorecard" in text.lower() and "Solid answers." in text


def test_a_missing_match_is_a_404(api):
    client, _ = api([])
    assert client.get("/api/matches/999/report.pdf").status_code == 404


# ---------- the evaluation summary ----------

def test_evaluation_reads_saved_check_results(tmp_path):
    path = tmp_path / "checks.json"
    path.write_text(json.dumps({
        "phase2": {"title": "Screening", "ran_at": "2026-09-22T10:00:00", "checks": [
            {"name": "Ranking beats the baseline", "passed": True, "detail": "6 of 6"},
            {"name": "Injection ignored", "passed": False}]},
        "phase1": {"title": "Foundation", "ran_at": "2026-09-21T10:00:00", "checks": [{"name": "Parses", "passed": True}]},
    }), encoding="utf-8")
    result = load_evaluation(path)
    assert [p.key for p in result.phases] == ["phase1", "phase2"]  # in phase order
    assert (result.passed, result.total) == (2, 3)
    assert result.phases[1].passed == 1 and result.phases[1].checks[1].detail == ""


@pytest.mark.parametrize("content", [None, "not json", ""])
def test_evaluation_with_no_usable_file_is_empty_not_an_error(tmp_path, content):
    path = tmp_path / "checks.json"
    if content is not None:
        path.write_text(content, encoding="utf-8")
    assert load_evaluation(path).total == 0


def test_the_evaluation_endpoint_responds(api):
    client, _ = api([])
    body = client.get("/api/evaluation").json()
    assert set(body) == {"phases", "passed", "total"}
