import json

from app.models import PanelReview
from tests.test_api_screening import events, ok_review, seed
from tests.test_matcher import GOOD_QUOTE
from tests.test_panel import MODERATOR_JSON, persona_json


def answer(kwargs):
    """Fake LLM for the whole flow: matcher review, three panelists, moderator."""
    text = json.dumps(kwargs["messages"])
    if "You chair a three-person hiring panel" in text:
        return MODERATOR_JSON
    if "Your role: TECH LEAD" in text:
        return persona_json(88)
    if "Your role: HR MANAGER" in text:
        return persona_json(72)
    if "Your role: HIRING MANAGER" in text:
        return persona_json(80)
    return ok_review(kwargs)


def screened(api, session_factory, count=2):
    client, fake = api(answer)
    job_id = seed(session_factory, count=count)
    client.post(f"/api/jobs/{job_id}/screen")
    matches = client.get(f"/api/jobs/{job_id}/matches").json()
    return client, fake, job_id, matches


def test_panel_streams_each_panelist_then_the_moderator_and_saves(api, session_factory):
    client, _, _, matches = screened(api, session_factory)
    match_id = matches[0]["id"]

    evs = events(client.post(f"/api/matches/{match_id}/panel"))
    kinds = [e["type"] for e in evs]

    assert kinds[0] == "panel_start" and kinds.count("persona") == 3 and kinds[-2:] == ["panel", "done"]
    assert kinds.index("status") > max(i for i, k in enumerate(kinds) if k == "persona")  # moderator comes last
    assert evs[-1] == {"type": "done", "completed": 1, "failed": 0}

    panel = client.get(f"/api/matches/{match_id}/panel").json()
    assert panel["verdict"] == "hire" and panel["consensus_score"] == 80.0 and panel["agreement"] == "moderate"
    assert panel["spread"] == 16.0
    assert [r["persona"] for r in panel["reviews"]] == ["tech_lead", "hr_manager", "hiring_manager"]
    assert [r["label"] for r in panel["reviews"]] == ["Tech Lead", "HR Manager", "Hiring Manager"]
    assert panel["reviews"][0]["evidence"][0]["quote"] == GOOD_QUOTE
    assert panel["summary"] == "The panel likes the candidate." and panel["disagreements"][0]["topic"] == "Level"
    assert panel["probe_questions"] == ["How do you tune a slow query?"]  # duplicates across panelists collapse


def test_the_verdict_shows_up_on_the_ranked_matches(api, session_factory):
    client, _, job_id, matches = screened(api, session_factory)
    assert all(m["panel"] is None for m in matches)
    client.post(f"/api/matches/{matches[0]['id']}/panel")

    ranked = client.get(f"/api/jobs/{job_id}/matches").json()
    reviewed = next(m for m in ranked if m["id"] == matches[0]["id"])
    assert reviewed["panel"] == {"verdict": "hire", "consensus_score": 80.0, "agreement": "moderate"}
    assert next(m for m in ranked if m["id"] == matches[1]["id"])["panel"] is None


def test_running_the_panel_again_replaces_the_old_result(api, session_factory):
    client, _, _, matches = screened(api, session_factory)
    match_id = matches[0]["id"]
    client.post(f"/api/matches/{match_id}/panel")
    client.post(f"/api/matches/{match_id}/panel")
    with session_factory() as db:
        assert db.query(PanelReview).filter_by(match_id=match_id).count() == 4  # 3 panelists + moderator


def test_panel_for_the_top_candidates_of_a_job(api, session_factory):
    client, _, job_id, matches = screened(api, session_factory, count=3)
    evs = events(client.post(f"/api/jobs/{job_id}/panel?top=2"))

    started = [e["match_id"] for e in evs if e["type"] == "panel_start"]
    assert started == [m["id"] for m in matches[:2]]  # the two best, in rank order
    assert [e["index"] for e in evs if e["type"] == "panel_start"] == [1, 2]
    assert evs[-1] == {"type": "done", "completed": 2, "failed": 0}
    ranked = client.get(f"/api/jobs/{job_id}/matches").json()
    assert [m["panel"] is not None for m in ranked] == [True, True, False]


def test_a_failed_panel_is_reported_and_saves_nothing_but_others_continue(api, session_factory):
    calls = {"tech": 0}

    def flaky(kwargs):
        text = json.dumps(kwargs["messages"])
        if "Your role: TECH LEAD" in text:
            calls["tech"] += 1
            if calls["tech"] <= 3:  # the first attempt and both repair retries all fail
                return "this is not json"  # the first candidate's tech lead never produces valid output
        return answer(kwargs)

    client, _ = api(flaky)
    job_id = seed(session_factory, count=2)
    client.post(f"/api/jobs/{job_id}/screen")
    evs = events(client.post(f"/api/jobs/{job_id}/panel?top=2"))

    assert [e["type"] for e in evs].count("panel_error") == 1
    assert evs[-1] == {"type": "done", "completed": 1, "failed": 1}
    ranked = client.get(f"/api/jobs/{job_id}/matches").json()
    assert sorted(m["panel"] is not None for m in ranked) == [False, True]


def test_panel_endpoints_handle_missing_things(api, session_factory):
    client, _ = api(answer)
    assert client.get("/api/matches/999/panel").status_code == 404
    assert client.post("/api/matches/999/panel").status_code == 404
    assert client.post("/api/jobs/999/panel").status_code == 404
    job_id = seed(session_factory, count=1)
    assert client.post(f"/api/jobs/{job_id}/panel").status_code == 409  # nothing screened yet
    assert client.post(f"/api/jobs/{job_id}/panel?top=0").status_code == 422


def test_no_panel_yet_is_null_not_an_error(api, session_factory):
    client, _, _, matches = screened(api, session_factory, count=1)
    response = client.get(f"/api/matches/{matches[0]['id']}/panel")
    assert response.status_code == 200 and response.json() is None


def test_deleting_a_candidate_removes_their_panel(api, session_factory):
    client, _, _, matches = screened(api, session_factory, count=1)
    client.post(f"/api/matches/{matches[0]['id']}/panel")
    client.delete(f"/api/candidates/{matches[0]['candidate']['id']}")
    with session_factory() as db:
        assert db.query(PanelReview).count() == 0
