# HR-Recruitment-AI-System

An AI agent-based hiring platform: agents write job descriptions, parse and screen resumes, interview candidates and recommend who to hire, while a human recruiter makes the final decision.

See [PLAN.md](PLAN.md) for the full design, phases and validation plan.

**Status:** Phases 0 to 3 are done: foundation, job descriptions and resume parsing, candidate screening (Matcher with evidence, Bias Shield and blind mode, ranked screening board, Kanban pipeline), the three-persona Panel review with a moderator, the Compare view, and the AI interview with a scorecard. Next: candidate Q&A chatbot, outreach emails, Ask-HR and the live agent graph.

## Stack

- **Frontend:** Next.js (App Router), TypeScript, Tailwind, shadcn/ui, Framer Motion
- **Backend:** Python 3.11, FastAPI, SQLAlchemy (SQLite)
- **LLM:** Groq through its OpenAI-compatible API (a local Ollama server also works, see below)

## Setup

1. Get a free API key at <https://console.groq.com>.
2. Copy `.env.example` to `.env` in the repo root and paste your key. `.env` is git-ignored.
3. Backend:
   ```
   cd backend
   python -m venv .venv
   .venv\Scripts\activate
   pip install -r requirements.txt
   uvicorn app.main:app --reload
   ```
4. Frontend (second terminal):
   ```
   cd frontend
   copy .env.local.example .env.local
   npm install
   npm run dev
   ```
   Open <http://localhost:3000>.

## Tests

```
cd backend  && .venv\Scripts\python -m pytest                 # fast, uses a fake LLM
cd backend  && .venv\Scripts\python scripts\llm_smoke.py      # real LLM call + cache check
cd backend  && .venv\Scripts\python scripts\phase1_check.py   # real end-to-end check (backend must be running)
cd backend  && .venv\Scripts\python scripts\phase2_check.py   # ranking, evidence, bias, injection checks (real LLM; slow the first time)
cd backend  && .venv\Scripts\python scripts\phase3_check.py   # panel, interview evaluator and full mock interviews (real LLM; slow the first time)
cd frontend && npx playwright test                            # browser tests (backend and frontend running)
```

Voice dictation and reading questions aloud in the interview room use the browser's built-in speech features (best in Chrome or Edge). They are optional: typing always works.

Note: the first screening run downloads a small (about 90 MB) embedding model into `backend/data/models`. Groq's free tier is rate-limited (about 8,000 tokens per minute), so screening many candidates for the first time takes a few minutes; results are cached afterwards.

## Using a local model (Ollama) instead of Groq

Set these in `.env`; no code changes are needed:

```
LLM_BASE_URL=http://localhost:11434/v1
LLM_API_KEY=ollama
LLM_MODEL_LARGE=llama3.1:8b
LLM_MODEL_SMALL=llama3.1:8b
```

All people and resumes in `backend/data/sample_resumes` are fictional.
