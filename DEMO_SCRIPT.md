# Demo script (5 minutes)

A live walkthrough for presenting the project. It uses the seeded demo dataset (`backend/scripts/seed_demo.py`),
one job called **Backend Engineer** with all 10 sample candidates already screened, so the demo doesn't spend
time waiting on real AI calls it has already made once. Two moments in the middle *are* live AI calls (Ask-HR
and the Live Agents graph), to prove the system is real and not a slideshow.

**If the live demo breaks:** `docs/video/demo.webm` is a recorded backup of this exact walkthrough, and
`docs/screenshots/{light,dark}/` has a still image of every screen it mentions, numbered in order.

## Before you start

```
cd backend  && .venv\Scripts\python -m uvicorn app.main:app --port 8000
cd frontend && npm run dev
```

Then, once, to make sure the dataset looks like this script (safe to re-run any time; it re-seeds fresh):

```
cd backend && .venv\Scripts\python scripts\seed_demo.py
```

Open `http://localhost:3000`, in a browser wide enough to show the sidebar (about 1400px). Turn dark mode
off or on to match your room, either looks fine.

---

## 0:00 – Dashboard (20s)

**Say:** "This is an AI recruitment system with seven agents, from writing the job description to sending the
offer. Every number on this page is real: it's a live query against the database, not a mock."

**Do:** Land on `/`. Point at the four stat cards, then the **Hiring funnel** — 10 applied, 10 screened, 3
panel-reviewed, 1 interviewed, 1 offer. "That last box is today's story."

## 0:20 – The job (25s)

**Say:** "It starts with a job description. This one was written by the JD Generator agent, streamed token by
token, then a second agent extracted the required skills into a structured list — that's what powers the
scoring later."

**Do:** Click **Jobs**, open **Backend Engineer**. Point at the requirement chips (Python, FastAPI, PostgreSQL,
Docker) under the title.

## 0:45 – Screening (40s)

**Say:** "Ten candidates, one click. Each resume is anonymised — the Bias Shield strips the name, gender clues
and school before any AI sees it — matched against the job, and scored with cited evidence, not just a
number."

**Do:** Click **Screening**. Point out:
- the ranked cards, scores and "Strong fit / Weak fit" labels;
- **Candidate #11** at 97, clearly ahead of the field;
- the **Blind mode** switch — turn it off for a second to show real names appear, then back on.

Click into Candidate #11 (Aarav Mehta). On the **Evaluation** tab, point at the score breakdown (skills,
semantic fit, experience, AI review) and one evidence quote highlighted in the résumé.

## 1:25 – The panel debate (40s)

**Say:** "For the top candidates, three AI personas — a tech lead, an HR manager, a hiring manager — each
review the résumé independently and score it. A moderator then explains where they agree and where they
don't. The hire/no-hire decision itself is a fixed rule in code, not the AI's opinion, so it can't be talked
into a different answer."

**Do:** Open the **Panel** tab. Show the consensus score, the verdict badge, and scroll to one panelist's
independent reasoning. Mention: "The other two candidates on the panel, Priya Nair and Meera Reddy, were
reviewed the same way and came back No Hire — you can see all three side by side on the Compare page."

*(Optional, if time allows: `/compare?job=<id>&ids=<aarav>,<priya>,<meera>` — the bar chart and radar make the
gap obvious at a glance.)*

## 2:05 – The AI interview (45s)

**Say:** "Strong candidates go through a five-question AI interview. Each answer is scored for content and
clarity; a thin answer earns exactly one follow-up question. When it's done, code computes every number on
the scorecard — the AI only writes the summary."

**Do:** Open the **Interview** tab, then follow it to the full interview page. Scroll to the scorecard: overall
score, the five competency bars, strengths and concerns, and the question-by-question breakdown.

## 2:50 – Outreach and the coach (45s)

**Say:** "Once a decision is made, the system drafts the email — but the AI never sees the candidate's name;
placeholders are filled in by code, so it can't invent a time, a salary or a link. Watch what happens for our
two outcomes."

**Do:** Back on Aarav's card, open **Outreach**. Show the sent **invite** (with the interview time and a
calendar file) and the sent **offer** (with the salary you typed in, kept in `[brackets]` for anything you
didn't). Then open **Rohan Das** (a real "no" from this run) and show his **Outreach** tab: a rejection that
mentions his actual skill gaps, plus the **Skill-Gap Coach**'s learning roadmap underneath.

## 3:35 – It's actually live (40s)

**Say:** "Everything so far already happened — now let's watch it happen."

**Do:** Open **Live agents**. Click **Send a test question**. Narrate as the Ask-HR node lights up, the edge
animates, and the feed shows the real answer with its latency and token count. "That box on the right is the
agent's own words, streamed the moment the call finishes — except for the Resume Parser, which reads raw
résumés, so its output is never shown or logged."

Then press **Ctrl+K** anywhere, type "Who has FastAPI experience?", and show the result linking straight to
that candidate.

## 4:15 – Proof, not promises (30s)

**Say:** "None of these numbers are hand-picked. Every claim on this page comes from a script that calls the
real model, the real database, and checks the answer against ground truth I wrote down before running it."

**Do:** Open **Evaluation**. Point at **127 of 127 real-AI checks passing**, expand one phase to show individual
checks with their real numbers (e.g. "6 of 6 candidate pairs ranked correctly", "0 candidate names leaked").

## 4:45 – Close (15s)

**Say:** "Ten candidates in, one clear hire, one honest rejection with a path forward, and a full audit trail
— all from a job description and a folder of résumés." Return to **Dashboard**.

---

## If something goes wrong

- **The backend or a model call is slow/down:** narrate over `docs/video/demo.webm` instead — it's the same
  script, recorded end to end (about 70 seconds; pause it between beats to talk).
- **A specific screen misbehaves:** the matching still image is in `docs/screenshots/light/NN-*.png` (numbered
  in the order this script visits them; `docs/screenshots/dark/` has the same set in dark mode).
- **Someone asks "is this really calling an LLM?":** open `/agents` and click **Send a test question** again —
  it is never cached the same way twice if you vary the wording, and the token/latency numbers are real.

## Known limitations, if asked

- The 10 sample résumés and expected answers were written by the same person who built the agents, so a
  shared blind spot in judgment wouldn't be caught by the validation scripts.
- The interview scorer has been checked on synthetic and AI-written answers, never on a real interview.
- Nothing is actually sent: outreach emails are copied or opened in the recruiter's own email client.
- Full list, phase by phase, is in `PLAN.md`.
