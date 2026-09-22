"""Phase 6: seed a clean, realistic demo dataset for the report and the demo video.

Builds one job ("Backend Engineer", not tagged "(Phase N check)" so it survives running the other check
scripts and looks presentable) with all 10 sample candidates screened, and tells a small honest story:

  - Aarav Mehta   (clear top match) -> panel-reviewed, given a full AI interview, sent an invite then an
                    offer email, moved through the pipeline to Offer.
  - Priya Nair,
    Meera Reddy   -> panel-reviewed alongside Aarav (a real hire/maybe/no-hire debate, not three easy yeses).
  - Rohan Das     -> a rejection email with real skill-gap feedback, plus a Skill-Gap Coach roadmap; moved
                    to Rejected.
  - Vikram Joshi  -> moved to Rejected without an email, the way a recruiter does a quick bulk pass.
  - Everyone else stays at Screened, so the pipeline board and the funnel both show a realistic spread.

Idempotent: re-running it deletes and rebuilds only the "Backend Engineer" demo job, and reuses whichever
candidates already exist. Needs the backend running and a configured Groq key; several calls are new
(the job title differs from the cached check jobs), so this makes real, billed API calls.
"""

import json
import sys
import time
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.phase2_check import GOLDEN, SAMPLES, ensure_candidates, sse  # noqa: E402

API = "http://localhost:8000"
JOB_TITLE = "Backend Engineer"
SENDER = "Priya Shah"


def log(msg: str) -> None:
    print(f"  {msg}")


def fresh_job(client: httpx.Client, markdown: str) -> dict:
    for job in client.get("/api/jobs").json():
        if job["title"] == JOB_TITLE:
            client.delete(f"/api/jobs/{job['id']}")
    created = client.post("/api/jobs", json={"title": JOB_TITLE, "brief": "backend"}).json()
    client.put(f"/api/jobs/{created['id']}", json={"markdown": markdown}).raise_for_status()
    analysed = client.post(f"/api/jobs/{created['id']}/analyze")
    analysed.raise_for_status()
    return analysed.json()


def screen(client: httpx.Client, job_id: int) -> None:
    for event in sse(client, f"/api/jobs/{job_id}/screen?force=true"):
        if event["type"] == "error":
            raise SystemExit(f"screening failed: {event}")
        if event["type"] == "candidate_error":
            log(f"! candidate {event['candidate_id']}: {event['message']}")


def panel(client: httpx.Client, job_id: int, top: int) -> None:
    for event in sse(client, f"/api/jobs/{job_id}/panel?top={top}"):
        if event["type"] == "error":
            raise SystemExit(f"panel failed: {event}")


def run_full_interview(client: httpx.Client, candidate_id: int, job_id: int) -> dict:
    interview = client.post("/api/interviews", json={"candidate_id": candidate_id, "job_id": job_id}).json()
    while interview["status"] != "completed":
        suggestion = client.post(f"/api/interviews/{interview['id']}/suggest-answer?quality=strong", timeout=120).json()
        interview = client.post(f"/api/interviews/{interview['id']}/answer", json={"text": suggestion["text"]}, timeout=120).json()
    return interview


def draft(client: httpx.Client, candidate_id: int, **body) -> dict:
    message = client.post(f"/api/candidates/{candidate_id}/messages", json=body, timeout=120).json()
    if "detail" in message and "id" not in message:
        raise SystemExit(f"draft failed: {message}")
    return message


def send(client: httpx.Client, message_id: int) -> None:
    client.post(f"/api/messages/{message_id}/status", json={"status": "sent"}).raise_for_status()


def stage(client: httpx.Client, candidate_id: int, value: str) -> None:
    client.patch(f"/api/candidates/{candidate_id}/stage", json={"stage": value}).raise_for_status()


def by_name(matches: list[dict], name: str) -> dict:
    return next(m for m in matches if m["candidate"]["name"] == name)


def main() -> int:
    jobs_def = {j["key"]: j for j in json.loads((GOLDEN / "jobs.json").read_text(encoding="utf-8"))}
    truth = json.loads((SAMPLES / "ground_truth.json").read_text(encoding="utf-8"))
    markdown = jobs_def["backend"]["markdown"]

    with httpx.Client(base_url=API, timeout=180) as client:
        if not client.get("/health").json()["llm"]["api_key_configured"]:
            print("No LLM key configured; set GROQ_API_KEY in .env first.")
            return 2

        print("1. Candidates")
        ensure_candidates(client, truth)

        print(f"2. Job: {JOB_TITLE!r}")
        job = fresh_job(client, markdown)

        print("3. Screening (fresh calls: this job's title is new, so nothing is cached)")
        started = time.perf_counter()
        screen(client, job["id"])
        log(f"done in {time.perf_counter() - started:.0f}s")

        matches = client.get(f"/api/jobs/{job['id']}/matches").json()
        matches.sort(key=lambda m: -m["overall_score"])
        for m in matches:
            log(f"{round(m['overall_score']):>3}  {m['candidate']['name']}")
        top3 = matches[:3]
        aarav, rohan, vikram = by_name(matches, "Aarav Mehta"), by_name(matches, "Rohan Das"), by_name(matches, "Vikram Joshi")

        print(f"4. Panel review: {[m['candidate']['name'] for m in top3]}")
        panel(client, job["id"], top=3)

        print("5. Aarav Mehta: invite -> AI interview -> offer")
        start = "2026-10-06T15:30:00"
        invite = draft(
            client, aarav["candidate"]["id"], job_id=job["id"], kind="invite", sender_name=SENDER,
            interview={
                "starts_at": f"{start}+05:30", "duration_minutes": 45, "mode": "video",
                "location": "https://meet.example.com/backend-role-aarav",
                "time_label": "Tuesday 6 October, 3:30 pm IST",
            },
        )
        send(client, invite["id"])
        log(f"invite drafted and sent (message {invite['id']})")
        interview = run_full_interview(client, aarav["candidate"]["id"], job["id"])
        log(f"interview completed: overall {round(interview['scorecard']['overall'])}, recommendation {interview['scorecard']['recommendation']}")
        offer = draft(
            client, aarav["candidate"]["id"], job_id=job["id"], kind="offer", sender_name=SENDER,
            offer={"salary": "INR 22 LPA", "start_date": "17 November 2026", "reply_by": "31 October 2026"},
        )
        send(client, offer["id"])
        stage(client, aarav["candidate"]["id"], "offer")
        log(f"offer drafted and sent (message {offer['id']}); stage -> offer")

        print("6. Rohan Das: rejection with skill-gap feedback, plus a learning roadmap")
        reject = draft(
            client, rohan["candidate"]["id"], job_id=job["id"], kind="reject", sender_name=SENDER, include_gaps=True,
        )
        send(client, reject["id"])
        roadmap = client.post(f"/api/matches/{rohan['id']}/coach", timeout=120).json()
        stage(client, rohan["candidate"]["id"], "rejected")
        log(f"rejection sent (message {reject['id']}); roadmap: {len(roadmap['steps'])} steps, {roadmap['total_weeks']} weeks; stage -> rejected")

        print("7. Vikram Joshi: moved to Rejected without an email (a quick bulk pass)")
        stage(client, vikram["candidate"]["id"], "rejected")

        print("\nDemo dataset ready.")
        print(f"  Job: {JOB_TITLE} (id {job['id']})")
        print(f"  Offer:    Aarav Mehta (candidate {aarav['candidate']['id']})")
        print(f"  Rejected: Rohan Das (candidate {rohan['candidate']['id']}), Vikram Joshi (candidate {vikram['candidate']['id']})")
        print("  Everyone else: Screened, with Priya Nair and Meera Reddy also panel-reviewed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
