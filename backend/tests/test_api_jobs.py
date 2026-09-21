import json

import httpx
import openai

REQS = {
    "must_have_skills": ["Python", "FastAPI"], "nice_to_have_skills": ["Docker"],
    "min_years_experience": 2, "education": None, "responsibilities": ["Build APIs"],
}


def new_job(client, title="Backend Engineer", brief="2 years Python"):
    return client.post("/api/jobs", json={"title": title, "brief": brief}).json()


def sse_events(response) -> list[dict]:
    return [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: ")]


def test_create_list_get_delete(api):
    client, _ = api()
    job = new_job(client)
    assert job["status"] == "draft" and job["markdown"] is None and job["requirements"] is None
    assert [j["id"] for j in client.get("/api/jobs").json()] == [job["id"]]
    assert client.get(f"/api/jobs/{job['id']}").json()["title"] == "Backend Engineer"
    assert client.delete(f"/api/jobs/{job['id']}").status_code == 204
    assert client.get(f"/api/jobs/{job['id']}").status_code == 404


def test_validation_rejects_a_missing_title(api):
    client, _ = api()
    assert client.post("/api/jobs", json={"title": "", "brief": "x"}).status_code == 422


def test_generate_streams_tokens_then_done_and_saves(api):
    client, fake = api([["## About", " the role\n", "Build APIs."]])
    job = new_job(client)

    response = client.post(f"/api/jobs/{job['id']}/generate")
    events = sse_events(response)

    assert response.headers["content-type"].startswith("text/event-stream")
    assert [e["type"] for e in events] == ["token", "token", "token", "done"]
    assert events[-1]["markdown"] == "## About the role\nBuild APIs."
    saved = client.get(f"/api/jobs/{job['id']}").json()
    assert saved["markdown"] == "## About the role\nBuild APIs." and saved["status"] == "ready"
    prompt = fake.completions.calls[0]["messages"][-1]["content"]
    assert "Backend Engineer" in prompt and "2 years Python" in prompt


def test_generate_reports_llm_failure_as_an_error_event_and_saves_nothing(api):
    response = httpx.Response(429, request=httpx.Request("POST", "http://x/v1"))
    err = openai.RateLimitError("slow down", response=response, body=None)
    client, _ = api([err] * 4)
    job = new_job(client)

    events = sse_events(client.post(f"/api/jobs/{job['id']}/generate"))

    assert [e["type"] for e in events] == ["error"]
    assert client.get(f"/api/jobs/{job['id']}").json()["markdown"] is None


def test_generate_rejects_an_empty_model_reply(api):
    client, _ = api([[]])
    job = new_job(client)
    events = sse_events(client.post(f"/api/jobs/{job['id']}/generate"))
    assert events[-1]["type"] == "error" and "empty" in events[-1]["message"]


def test_generate_unknown_job_is_404(api):
    client, _ = api()
    assert client.post("/api/jobs/999/generate").status_code == 404


def test_update_saves_markdown_and_clears_stale_requirements(api):
    client, _ = api([json.dumps(REQS)])
    job = new_job(client)
    client.put(f"/api/jobs/{job['id']}", json={"markdown": "# Role\nPython"})
    analysed = client.post(f"/api/jobs/{job['id']}/analyze").json()
    assert analysed["requirements"]["must_have_skills"] == ["Python", "FastAPI"]

    edited = client.put(f"/api/jobs/{job['id']}", json={"markdown": "# Role\nPython and Go"}).json()
    assert edited["requirements"] is None and edited["markdown"].endswith("Go")


def test_update_can_rename_without_touching_the_description(api):
    client, _ = api([json.dumps(REQS)])
    job = new_job(client)
    client.put(f"/api/jobs/{job['id']}", json={"markdown": "# Role"})
    client.post(f"/api/jobs/{job['id']}/analyze")
    renamed = client.put(f"/api/jobs/{job['id']}", json={"title": "Senior Backend Engineer"}).json()
    assert renamed["title"] == "Senior Backend Engineer" and renamed["requirements"] is not None


def test_analyze_needs_a_description_first(api):
    client, _ = api()
    job = new_job(client)
    assert client.post(f"/api/jobs/{job['id']}/analyze").status_code == 409


def test_analyze_llm_failure_becomes_502_with_a_message(api):
    client, _ = api(["not json"] * 3)
    job = new_job(client)
    client.put(f"/api/jobs/{job['id']}", json={"markdown": "# Role\nPython"})
    response = client.post(f"/api/jobs/{job['id']}/analyze")
    assert response.status_code == 502 and "JobRequirements" in response.json()["detail"]


def test_check_language_endpoint(api):
    client, _ = api()
    flags = client.post("/api/jobs/check-language", json={"text": "We want a ninja."}).json()
    assert [f["phrase"] for f in flags] == ["ninja"]
    assert client.post("/api/jobs/check-language", json={"text": "Welcome, everyone."}).json() == []
