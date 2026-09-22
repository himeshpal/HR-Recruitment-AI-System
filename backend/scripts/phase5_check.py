"""Phase 5 validation: live agent events, the dashboard funnel and PDF reports, against the real AI.

Pass criteria, written before the first run:
  live events  - 1. every 'finish' event on the live stream matches exactly one new AgentRun row
                 2. every uncached 'finish' was preceded by a 'start' with the same call id
                 3. a genuinely new question shows start -> finish, not cached, with a latency above zero
                 3b. three NEW questions sent at the same moment each get their own start -> finish pair
                 4. screening the job produced at least one 'matcher' finish per candidate, and a panel run for
                    the top 3 candidates produced 9 panelist finishes and 3 moderator finishes
                 5. no candidate's name, email or phone appears anywhere in the stream or the activity log
                 6. the Resume Parser never has a preview
  funnel       - 7. every step of /api/dashboard equals an independent recount from the raw APIs
  PDF reports  - 8. for every candidate screened for the job: the blind PDF contains no name or email of ANY
                    candidate and contains "Candidate #id"
                 9. the named PDF contains the candidate's name and email
                10. the score printed in the PDF equals the score from the API

Needs the backend running. Results are saved to backend/data/eval/phase5.json and checks.json.
"""

import io
import json
import re
import sys
import threading
import time
from pathlib import Path

import httpx
import pdfplumber

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.eval_store import save_checks  # noqa: E402
from scripts.phase2_check import (  # noqa: E402
    API, DATA, GOLDEN, SAMPLES, check, ensure_candidates, results, screen, setup_jobs, sse,
)

OUT = DATA / "eval" / "phase5.json"


class StreamReader(threading.Thread):
    """Follows /api/agents/stream on its own connection and keeps every raw line, exactly as the browser would see it."""

    def __init__(self, after: int):
        super().__init__(daemon=True)
        self.after, self.lines, self.events, self.response = after, [], [], None
        self._client = httpx.Client(base_url=API, timeout=httpx.Timeout(30.0, read=None))

    def run(self) -> None:
        try:
            with self._client.stream("GET", f"/api/agents/stream?after={self.after}") as response:
                self.response = response
                for line in response.iter_lines():
                    self.lines.append(line)
                    if line.startswith("data: "):
                        self.events.append(json.loads(line[6:]))
        except (httpx.HTTPError, RuntimeError):
            pass  # closed by stop()

    def stop(self) -> None:
        try:
            if self.response is not None:
                self.response.close()
            self._client.close()
        except Exception:
            pass


def pdf_text(data: bytes) -> str:
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        return "\n".join(page.extract_text() or "" for page in pdf.pages)


def calls_total(client: httpx.Client) -> int:
    return client.get("/api/agents/stats").json()["calls"]


def live_section(client, job, candidates) -> dict:
    print("\n== 1. Live agent events: the stream against the database and against the private data")
    recent = client.get("/api/agents/recent").json()
    reader = StreamReader(after=recent[-1]["seq"] if recent else 0)
    reader.start()
    time.sleep(2.0)  # let the connection open before any work starts
    before = calls_total(client)

    screen(client, job["id"])
    top3 = [m["id"] for m in sorted(client.get(f"/api/jobs/{job['id']}/matches").json(), key=lambda m: -m["overall_score"])[:3]]
    for event in sse(client, f"/api/jobs/{job['id']}/panel?top=3"):
        if event["type"] == "error":
            raise SystemExit(f"panel failed: {event}")
    fresh_question = f"Who knows Python? Please list them. (reference {int(time.time())})"
    asked = client.post("/api/ask", json={"question": fresh_question}, timeout=120).json()
    print(f"     a new question -> {asked['understood'] or asked['refusal']}")

    # Three real calls at once: each must be announced and closed under its own id.
    simultaneous = [f"Who has {skill} skills? (reference {int(time.time())}-{n})" for n, skill in enumerate(["Java", "SQL", "React"])]
    burst = [threading.Thread(target=lambda q=q: httpx.post(f"{API}/api/ask", json={"question": q}, timeout=180)) for q in simultaneous]
    mark = len(reader.events)
    for t in burst:
        t.start()
    for t in burst:
        t.join()

    time.sleep(2.5)  # events and database rows settle
    reader.stop()
    added = calls_total(client) - before
    events = reader.events
    finishes = [e for e in events if e["type"] == "finish"]
    starts = {e["call_id"] for e in events if e["type"] == "start"}
    uncached = [e for e in finishes if not e["cached"]]

    check("Every finish event on the live stream matches exactly one new database row", len(finishes) == added, f"{len(finishes)} finish events, {added} new AgentRun rows")
    missing = [e["agent"] for e in uncached if e["call_id"] not in starts]
    check("Every uncached finish had a start event with the same call id", not missing, f"{len(uncached)} uncached calls; without a start: {missing[:5]}")
    real = [e for e in finishes if e["agent"] == "ask_hr" and not e["cached"]]
    check("A new question shows a real call: start, then finish, not cached, with time spent",
          bool(real) and real[-1]["latency_ms"] > 0 and real[-1]["call_id"] in starts,
          f"latency {real[-1]['latency_ms']} ms, {real[-1]['tokens']} tokens" if real else "no uncached ask_hr call seen")

    burst_events = [e for e in events[mark:] if e["agent"] == "ask_hr"]
    burst_finishes = [e for e in burst_events if e["type"] == "finish" and not e["cached"]]
    burst_starts = [e for e in burst_events if e["type"] == "start"]
    paired = {e["call_id"] for e in burst_finishes} <= {e["call_id"] for e in burst_starts}
    check("Three new questions sent at once each get their own start and finish", len(burst_finishes) == 3 and len({e["call_id"] for e in burst_finishes}) == 3 and paired,
          f"{len(burst_starts)} starts, {len(burst_finishes)} finishes, {len({e['call_id'] for e in burst_finishes})} distinct ids")

    count = lambda prefix: sum(1 for e in finishes if e["agent"].startswith(prefix))
    check("Screening produced a matcher event for every candidate", count("matcher") >= len(candidates), f"{count('matcher')} matcher events for {len(candidates)} candidates")
    personas = sum(1 for e in finishes if e["agent"] in ("panel_tech_lead", "panel_hr_manager", "panel_hiring_manager"))
    moderators = sum(1 for e in finishes if e["agent"] == "panel_moderator")
    check("A panel run for the top 3 shows 9 panelist events and 3 moderator events", (personas, moderators) == (9, 3), f"{personas} panelists, {moderators} moderators")

    # Privacy: search everything the browser could see for anything that identifies a candidate.
    raw = "\n".join(reader.lines) + "\n" + json.dumps(client.get("/api/agents/activity?limit=200").json())
    leaks = []
    for c in candidates:
        for secret in filter(None, [c["name"], c["email"], c.get("phone")]):
            if secret.lower() in raw.lower():
                leaks.append(secret)
    check("No candidate name, email or phone appears in the stream or the activity log", not leaks, f"found {leaks[:3]}" if leaks else f"searched {len(raw):,} characters for {len(candidates)} people")
    parser_previews = [r["preview"] for r in client.get("/api/agents/activity?limit=200").json() if r["agent"] == "resume_parser" and r["preview"]]
    check("The Resume Parser never has a preview", not parser_previews)
    return {"events": len(events), "finishes": len(finishes), "uncached": len(uncached), "new_rows": added, "top3": top3}


def funnel_section(client) -> dict:
    print("\n== 2. Dashboard funnel vs an independent recount")
    candidates = client.get("/api/candidates").json()
    jobs = client.get("/api/jobs").json()
    screened, panel, interviewed = set(), set(), set()
    for job in jobs:
        for m in client.get(f"/api/jobs/{job['id']}/matches").json():
            screened.add(m["candidate"]["id"])
            if m.get("panel"):
                panel.add(m["candidate"]["id"])
        for c in candidates:
            for i in client.get(f"/api/interviews?candidate_id={c['id']}&job_id={job['id']}").json():
                if i["status"] == "completed":
                    interviewed.add(c["id"])
    expected = {"applied": len(candidates), "screened": len(screened), "panel": len(panel), "interviewed": len(interviewed),
                "offer": sum(1 for c in candidates if c["stage"] == "offer")}
    board = client.get("/api/dashboard").json()
    got = {s["key"]: s["count"] for s in board["funnel"]}
    check("Every funnel step equals an independent recount", got == expected, f"dashboard {got}; recount {expected}")
    check("Jobs, candidates and rejected match the raw lists", (board["jobs"], board["candidates"], board["rejected"]) == (len(jobs), len(candidates), sum(1 for c in candidates if c["stage"] == "rejected")))
    return {"funnel": got}


def pdf_section(client, job, candidates) -> dict:
    print("\n== 3. PDF reports: blind by default, the right score, identity only when asked")
    matches = client.get(f"/api/jobs/{job['id']}/matches").json()
    secrets = [(c["name"], c["email"]) for c in candidates]
    blind_ok = named_ok = score_ok = 0
    problems = []
    for m in matches:
        cid, mid = m["candidate"]["id"], m["id"]
        blind = client.get(f"/api/matches/{mid}/report.pdf")
        named = client.get(f"/api/matches/{mid}/report.pdf?blind=false")
        b_text, n_text = pdf_text(blind.content), pdf_text(named.content)
        leaked = [s for pair in secrets for s in pair if s and s in b_text]
        blind_ok += blind.content.startswith(b"%PDF") and f"Candidate #{cid}" in b_text and not leaked
        if leaked or f"Candidate #{cid}" not in b_text:
            problems.append(f"blind #{cid}: leaked {leaked[:2]}")
        named_ok += m["candidate"]["name"] in n_text and m["candidate"]["email"] in n_text
        shown = re.search(r"MATCH SCORE\s+(\d+)", n_text)
        score_ok += bool(shown) and int(shown.group(1)) == round(m["overall_score"])
    total = len(matches)
    check("Every blind PDF says 'Candidate #id' and names nobody", blind_ok == total, f"{blind_ok}/{total}; {problems[:2]}")
    check("Every named PDF contains the name and email", named_ok == total, f"{named_ok}/{total}")
    check("The score in every PDF equals the score from the API", score_ok == total, f"{score_ok}/{total}")
    return {"pdfs": total}


def main() -> int:
    jobs_def = json.loads((GOLDEN / "jobs.json").read_text(encoding="utf-8"))
    truth = json.loads((SAMPLES / "ground_truth.json").read_text(encoding="utf-8"))
    try:
        with httpx.Client(base_url=API, timeout=180) as client:
            if not client.get("/health").json()["llm"]["api_key_configured"]:
                print("No LLM key configured; set GROQ_API_KEY in .env first.")
                return 2
            print("== 0. Setup: candidates and a job (mostly cached)")
            ensure_candidates(client, truth)
            jobs = setup_jobs(client, [j for j in jobs_def if j["key"] == "backend"])
            job = jobs["backend"]
            candidates = client.get("/api/candidates").json()
            report = {"live": live_section(client, job, candidates)}
            report["funnel"] = funnel_section(client)
            report["pdf"] = pdf_section(client, job, candidates)
    except httpx.ConnectError:
        print(f"Cannot reach {API}. Start the backend first:  .venv\\Scripts\\python -m uvicorn app.main:app")
        return 2

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, indent=2), encoding="utf-8")
    save_checks("phase5", "Live agents, dashboard and reports", results)
    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed   (results saved to {OUT.relative_to(DATA.parent)})")
    for name, _, detail in failed:
        print(f"  FAILED: {name} {detail}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
