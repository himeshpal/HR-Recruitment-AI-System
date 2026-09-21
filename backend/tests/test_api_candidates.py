import io
import json

from docx import Document

PROFILE = {
    "name": "Asha Verma", "email": "asha@example.com", "phone": None, "location": "Pune",
    "headline": "Backend Engineer", "skills": ["Python", "FastAPI"],
    "experience": [{"title": "Engineer", "company": "Acme", "start": "2020-01", "end": "2022-12"}],
    "education": [], "certifications": [],
}


def resume_docx(text="Asha Verma - asha@example.com. Backend engineer, five years of Python and FastAPI.") -> bytes:
    doc = Document()
    doc.add_paragraph(text)
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def upload(client, data=None, name="asha.docx"):
    data = resume_docx() if data is None else data
    return client.post("/api/candidates/upload", files={"file": (name, data)})


def test_upload_parses_saves_and_returns_the_candidate(api):
    client, _ = api([json.dumps(PROFILE)])
    response = upload(client)

    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "Asha Verma" and body["email"] == "asha@example.com"
    assert body["stage"] == "applied"
    assert body["profile"]["skills"] == ["Python", "FastAPI"]
    assert body["profile"]["total_years_experience"] == 3.0
    assert "resume_text" not in body  # summaries stay light; text is on the detail endpoint


def test_detail_includes_the_resume_text_and_list_shows_newest_first(api):
    client, _ = api([json.dumps(PROFILE), json.dumps({**PROFILE, "name": "Ben"})])
    first = upload(client).json()
    second = upload(client, resume_docx("Ben Carter - ben@example.com. Frontend developer with React."), "ben.docx").json()

    assert "FastAPI" in client.get(f"/api/candidates/{first['id']}").json()["resume_text"]
    assert [c["id"] for c in client.get("/api/candidates").json()] == [second["id"], first["id"]]


def test_uploading_the_same_resume_twice_is_a_409_and_costs_no_llm_call(api):
    client, fake = api([json.dumps(PROFILE)])
    assert upload(client).status_code == 201
    again = upload(client)
    assert again.status_code == 409 and "already uploaded" in again.json()["detail"]
    assert len(fake.completions.calls) == 1


def test_bad_files_are_422_with_a_readable_reason_and_no_llm_call(api):
    client, fake = api()
    assert upload(client, b"MZ\x90\x00", "virus.exe").status_code == 422
    scanned = upload(client, b"%PDF-1.4 broken", "scan.pdf")
    assert scanned.status_code == 422 and "Could not read" in scanned.json()["detail"]
    assert fake.completions.calls == []


def test_llm_failure_is_502_and_nothing_is_saved(api):
    client, _ = api(["nope"] * 3)
    response = upload(client)
    assert response.status_code == 502
    assert client.get("/api/candidates").json() == []


def test_delete_and_404s(api):
    client, _ = api([json.dumps(PROFILE)])
    candidate = upload(client).json()
    assert client.delete(f"/api/candidates/{candidate['id']}").status_code == 204
    assert client.get(f"/api/candidates/{candidate['id']}").status_code == 404
    assert client.delete(f"/api/candidates/{candidate['id']}").status_code == 404
