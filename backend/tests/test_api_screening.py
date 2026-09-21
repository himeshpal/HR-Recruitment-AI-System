import json

from app.models import Candidate, Job
from tests.test_matcher import GOOD_QUOTE, RESUME as ASHA_RESUME

REQS = {"must_have_skills": ["Python", "FastAPI"], "nice_to_have_skills": [], "min_years_experience": 2,
        "education": None, "responsibilities": ["Build APIs"]}


def profile(name, skills, years_start="2020-01", years_end="2022-12"):
    return {
        "name": name, "email": f"{name.split()[0].lower()}@example.com", "phone": None, "location": "Pune",
        "headline": "Engineer", "skills": skills, "education": [], "certifications": [],
        "experience": [{"title": "Engineer", "company": "Acme", "start": years_start, "end": years_end,
                        "highlights": ["Built REST APIs in Python and FastAPI serving 10k users"]}],
        "total_years_experience": 3.0,
    }


def seed(session_factory, requirements=True, count=2):
    with session_factory() as db:
        job = Job(title="Backend Engineer", brief="b", status="ready",
                  description={"markdown": "# Backend Engineer", "requirements": REQS if requirements else None})
        db.add(job)
        for i in range(count):
            db.add(Candidate(name=f"Cand{i} Test", email=f"c{i}@example.com",
                             resume_text=ASHA_RESUME + f"\nSide project number {i}",
                             parsed_profile=profile(f"Cand{i} Test", ["Python", "FastAPI"]), stage="applied"))
        db.commit()
        return job.id


def ok_review(kwargs):
    """Fake LLM reply for the matcher: a fixed, valid review that cites a real quote."""
    return json.dumps({
        "skills_score": 70, "experience_score": 70, "domain_fit_score": 70, "strengths": ["APIs"], "gaps": [],
        "evidence": [{"claim": "APIs", "quote": GOOD_QUOTE}], "summary": "ok", "confidence": 0.7,
    })


def events(response):
    return [json.loads(l[6:]) for l in response.text.splitlines() if l.startswith("data: ")]


def test_screening_streams_progress_saves_matches_and_moves_candidates(api, session_factory):
    client, fake = api(ok_review)
    job_id = seed(session_factory)

    evs = events(client.post(f"/api/jobs/{job_id}/screen"))
    kinds = [e["type"] for e in evs]

    assert kinds[0] == "status" and "start" in kinds and kinds[-1] == "done"
    assert kinds.count("match") == 2 and kinds.count("progress") == 2
    assert next(e for e in evs if e["type"] == "start")["total"] == 2
    assert evs[-1] == {"type": "done", "matched": 2, "failed": 0}
    with session_factory() as db:
        assert {c.stage for c in db.query(Candidate)} == {"screened"}


def test_matches_are_ranked_best_first(api, session_factory):
    def answer(kwargs):
        s = 90 if "Side project number 1" in json.dumps(kwargs["messages"]) else 40
        return json.dumps({"skills_score": s, "experience_score": s, "domain_fit_score": s, "strengths": [],
                           "gaps": [], "evidence": [{"claim": "c", "quote": GOOD_QUOTE}], "summary": "s",
                           "confidence": 0.5})

    client, _ = api(answer)
    job_id = seed(session_factory)
    client.post(f"/api/jobs/{job_id}/screen")

    ranked = client.get(f"/api/jobs/{job_id}/matches").json()
    assert [m["overall_score"] for m in ranked] == sorted((m["overall_score"] for m in ranked), reverse=True)
    assert ranked[0]["overall_score"] > ranked[1]["overall_score"]
    first = ranked[0]
    assert first["candidate"]["email"] == "c1@example.com"  # the one the fake LLM rated 90
    assert {"skills", "semantic", "experience", "ai_review"} <= set(first["breakdown"])
    assert first["weights"] == {"skills": 0.3, "semantic": 0.1, "experience": 0.2, "ai_review": 0.4}
    assert first["skill_details"][0] == {"skill": "Python", "kind": "must", "status": "demonstrated"}
    assert first["candidate"]["name"].startswith("Cand")


def test_rescreening_only_scores_new_candidates_unless_forced(api, session_factory):
    client, fake = api(ok_review)
    job_id = seed(session_factory)
    client.post(f"/api/jobs/{job_id}/screen")
    calls_after_first = len(fake.completions.calls)

    again = events(client.post(f"/api/jobs/{job_id}/screen"))
    assert next(e for e in again if e["type"] == "start") == {"type": "start", "total": 0, "skipped": 2}
    assert len(fake.completions.calls) == calls_after_first

    with session_factory() as db:
        db.add(Candidate(name="New Person", email="n@example.com", resume_text=ASHA_RESUME,
                         parsed_profile=profile("New Person", ["Python"])))
        db.commit()
    third = events(client.post(f"/api/jobs/{job_id}/screen"))
    assert third[-1] == {"type": "done", "matched": 1, "failed": 0}
    assert len(client.get(f"/api/jobs/{job_id}/matches").json()) == 3

    forced = events(client.post(f"/api/jobs/{job_id}/screen?force=true"))
    assert forced[-1]["matched"] == 3
    assert len(client.get(f"/api/jobs/{job_id}/matches").json()) == 3  # updated in place, no duplicates


def test_requirements_are_extracted_on_the_fly_when_missing(api, session_factory):
    def answer(kwargs):
        if "hiring requirements" in json.dumps(kwargs["messages"]):
            return json.dumps(REQS)
        return ok_review(kwargs)

    client, _ = api(answer)
    job_id = seed(session_factory, requirements=False, count=1)
    assert events(client.post(f"/api/jobs/{job_id}/screen"))[-1]["matched"] == 1
    assert client.get(f"/api/jobs/{job_id}").json()["requirements"]["must_have_skills"] == ["Python", "FastAPI"]


def test_one_failing_candidate_does_not_stop_the_others(api, session_factory):
    client, _ = api(ok_review)
    job_id = seed(session_factory)
    with session_factory() as db:
        broken = db.query(Candidate).first()
        broken.parsed_profile = None  # e.g. a legacy row that was never parsed
        db.commit()

    evs = events(client.post(f"/api/jobs/{job_id}/screen"))
    assert [e["type"] for e in evs].count("candidate_error") == 1
    assert evs[-1] == {"type": "done", "matched": 1, "failed": 1}


def test_llm_failure_for_a_candidate_is_reported_not_raised(api, session_factory):
    client, _ = api(lambda kwargs: "this is not json")
    job_id = seed(session_factory, count=1)
    evs = events(client.post(f"/api/jobs/{job_id}/screen"))
    error = next(e for e in evs if e["type"] == "candidate_error")
    assert "ReviewOutput" in error["message"] and evs[-1]["failed"] == 1


def test_job_without_a_description_or_missing_job(api, session_factory):
    client, _ = api()
    with session_factory() as db:
        empty = Job(title="Empty", brief="")
        db.add(empty)
        db.commit()
        empty_id = empty.id
    assert client.post(f"/api/jobs/{empty_id}/screen").status_code == 409
    assert client.post("/api/jobs/999/screen").status_code == 404
    assert client.get("/api/jobs/999/matches").status_code == 404


def test_match_detail_returns_original_and_anonymised_text_and_flags_quotes(api, session_factory):
    client, _ = api(ok_review)
    job_id = seed(session_factory, count=1)
    client.post(f"/api/jobs/{job_id}/screen")
    match_id = client.get(f"/api/jobs/{job_id}/matches").json()[0]["id"]

    detail = client.get(f"/api/matches/{match_id}").json()
    assert "asha@example.com" in detail["resume_text"]
    assert "asha@example.com" not in detail["anonymized_text"] and "[EMAIL]" in detail["anonymized_text"]
    assert detail["evidence"][0]["in_original"] is True
    assert client.get("/api/matches/999999").status_code == 404


def test_stage_endpoint_validates_and_persists(api, session_factory):
    client, _ = api()
    job_id = seed(session_factory, count=1)
    cid = client.get("/api/candidates").json()[0]["id"]
    assert client.patch(f"/api/candidates/{cid}/stage", json={"stage": "interview"}).json()["stage"] == "interview"
    assert client.get(f"/api/candidates/{cid}").json()["stage"] == "interview"
    assert client.patch(f"/api/candidates/{cid}/stage", json={"stage": "hired-lol"}).status_code == 422
    assert client.patch("/api/candidates/9999/stage", json={"stage": "offer"}).status_code == 404


def test_deleting_a_candidate_or_job_removes_their_matches(api, session_factory):
    client, _ = api(ok_review)
    job_id = seed(session_factory)
    client.post(f"/api/jobs/{job_id}/screen")
    cid = client.get(f"/api/jobs/{job_id}/matches").json()[0]["candidate"]["id"]
    client.delete(f"/api/candidates/{cid}")
    assert len(client.get(f"/api/jobs/{job_id}/matches").json()) == 1
    client.delete(f"/api/jobs/{job_id}")
    assert client.get(f"/api/jobs/{job_id}/matches").status_code == 404
