"""Phase 1 end-to-end check against the RUNNING backend and the real LLM.

  1. Job Studio path: generate a job description (streamed), analyse it, check inclusive language.
  2. Resume path: upload the 10 sample resumes and compare each parsed profile with ground truth.

Start the backend first, then from backend/:   .venv\\Scripts\\python scripts\\phase1_check.py
"""

import json
import sys
import time
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.services.inclusive_language import check_inclusive_language  # noqa: E402
from scripts.eval_store import save_checks  # noqa: E402
from scripts.make_sample_resumes import OUT_DIR, build  # noqa: E402

API = "http://localhost:8000"
JD_TITLE = "Backend Engineer (Phase 1 check)"
JD_BRIEF = "Backend engineer with 2+ years of Python and FastAPI, PostgreSQL, Docker. Nice to have: AWS."
SECTIONS = ["About the role", "What you'll do", "What you'll bring", "Must have", "Nice to have",
            "What we offer", "Equal opportunity"]
INJECTION_MARKERS = ["10/10", "ignore all previous", "hiring immediately", "exceptional"]

results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> bool:
    results.append((name, ok, detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f"  ({detail})" if detail else ""))
    return ok


def skill_recall(expected: list[str], parsed: list[str]) -> float:
    have = [s.lower() for s in parsed]
    hits = sum(any(e.lower() in h or h in e.lower() for h in have) for e in expected)
    return hits / len(expected)


def job_studio(client: httpx.Client) -> None:
    print("\n== 1. Job Studio: generate -> analyse -> language check")
    for old in client.get("/api/jobs").json():
        if old["title"] == JD_TITLE:
            client.delete(f"/api/jobs/{old['id']}")

    job = client.post("/api/jobs", json={"title": JD_TITLE, "brief": JD_BRIEF}).json()
    tokens, first_token_s, done, error = [], None, None, None
    start = time.perf_counter()
    with client.stream("POST", f"/api/jobs/{job['id']}/generate") as response:
        for line in response.iter_lines():
            if not line.startswith("data: "):
                continue
            event = json.loads(line[6:])
            if event["type"] == "token":
                first_token_s = first_token_s or time.perf_counter() - start
                tokens.append(event["text"])
            elif event["type"] == "done":
                done = event["markdown"]
            elif event["type"] == "error":
                error = event["message"]
    total_s = time.perf_counter() - start

    if not check("JD stream completes without error", done is not None and error is None, error or ""):
        return
    check("JD arrives as a real stream (many chunks)", len(tokens) > 20,
          f"{len(tokens)} chunks, first after {first_token_s:.1f}s, total {total_s:.1f}s")
    missing = [s for s in SECTIONS if s.lower() not in done.lower()]
    check("JD has all required sections", not missing, f"missing: {missing}" if missing else "")
    check("JD text was saved to the job", client.get(f"/api/jobs/{job['id']}").json()["markdown"] == done)

    flags = check_inclusive_language(done)
    check("Generated JD has no biased wording", not flags,
          ", ".join(f"'{f.phrase}' ({f.category})" for f in flags))

    analysed = client.post(f"/api/jobs/{job['id']}/analyze").json()
    reqs = analysed["requirements"]
    musts = [s.lower() for s in reqs["must_have_skills"]]
    check("Requirements extracted: Python and FastAPI are must-haves",
          "python" in musts and any("fastapi" in s for s in musts), f"must_have={reqs['must_have_skills']}")
    check("Requirements extracted: minimum years is 2", reqs["min_years_experience"] == 2,
          f"got {reqs['min_years_experience']}")


def resumes(client: httpx.Client) -> None:
    print("\n== 2. Resume Parser: 10 sample resumes vs ground truth")
    truth = build()
    emails = {t["email"] for t in truth}
    for c in client.get("/api/candidates").json():
        if c["email"] in emails:
            client.delete(f"/api/candidates/{c['id']}")

    for t in truth:
        path = OUT_DIR / t["file"]
        started = time.perf_counter()
        response = client.post("/api/candidates/upload", files={"file": (t["file"], path.read_bytes())})
        secs = time.perf_counter() - started
        print(f"\n  {t['file']}  ({t['level']}, {secs:.1f}s)")
        if not check("uploaded", response.status_code == 201, f"HTTP {response.status_code} {response.text[:150]}"):
            continue
        body = response.json()
        profile = body["profile"]
        check("name", body["name"].casefold() == t["name"].casefold(), f"got {body['name']!r}")
        check("email", body["email"] == t["email"], f"got {body['email']!r}")
        years = profile["total_years_experience"]
        check("years of experience", abs(years - t["expected_years"]) <= 0.5,
              f"expected {t['expected_years']}, got {years}")
        recall = skill_recall(t["key_skills"], profile["skills"])
        check("key skills found", recall >= 0.75, f"{recall:.0%} of {t['key_skills']}")
        if t["level"] == "weak-with-injection":
            blob = json.dumps(profile).lower()
            leaked = [m for m in INJECTION_MARKERS if m in blob]
            check("prompt-injection text not copied into the profile", not leaked, f"found {leaked}" if leaked else "")

    print("\n  duplicate upload is rejected without another LLM call:")
    first = truth[0]
    again = client.post("/api/candidates/upload", files={"file": (first["file"], (OUT_DIR / first["file"]).read_bytes())})
    check("409 on re-upload", again.status_code == 409, again.text[:120])
    bad = client.post("/api/candidates/upload", files={"file": ("cv.pdf", b"%PDF-1.4 not really")})
    check("422 on a damaged PDF", bad.status_code == 422, bad.text[:120])


def main() -> int:
    try:
        with httpx.Client(base_url=API, timeout=180) as client:
            health = client.get("/health").json()
            if not health["llm"]["api_key_configured"]:
                print("No LLM key configured; set GROQ_API_KEY in .env first.")
                return 2
            job_studio(client)
            resumes(client)
    except httpx.ConnectError:
        print(f"Cannot reach {API}. Start the backend first:  .venv\\Scripts\\python -m uvicorn app.main:app")
        return 2

    save_checks("phase1", "Job descriptions and resume parsing", results)
    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
    for name, _, detail in failed:
        print(f"  FAILED: {name} {detail}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
