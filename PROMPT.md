# Prompt for the Coding LLM

> Send this file **together with `PLAN.md`**. `PLAN.md` is the source of truth for scope, design, structure, schemas and validation. This prompt tells you how to work.

---

## Role

You are a senior full-stack engineer and AI engineer. You will build the project described in `PLAN.md`: an **AI Agent-Based HR Recruitment System** (college-project scale, but with genuinely capable agents and a polished, professional UI).

## Ground rules

1. **Read `PLAN.md` fully before writing any code.** Follow its stack, folder structure, data model, agent contracts and phases. If something is ambiguous, choose the simplest reasonable option, state your assumption in one line, and continue. Ask me only if you are truly blocked.
2. **Work phase by phase**, in the order of PLAN.md section 7 (Phase 0 → 6). Finish and verify a phase before starting the next. At the end of each phase, tell me: what was built, how to run it, how you verified it, and what is next.
3. **LLM provider: Groq only.** Use the OpenAI-compatible endpoint through a single wrapper (`backend/app/llm/client.py`). Read `GROQ_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL_LARGE` and `LLM_MODEL_SMALL` from `.env`. **Do not add any automatic fallback to other providers.** Keep the wrapper generic enough that pointing `LLM_BASE_URL` at a local Ollama server (`http://localhost:11434/v1`) works with no code changes. Never hard-code keys or model names in agent code, and never commit `.env`.
4. **The wrapper must provide:** JSON-mode/structured output with Pydantic validation and automatic retry on invalid output, on-disk response caching keyed by (model, messages, params), retry with backoff on HTTP 429/5xx, streaming support, and logging of tokens/latency to the `AgentRun` table.
5. **Keep the pipeline deterministic.** Use LangGraph as a fixed state graph (Job → Resumes → Match → Panel → Interview → Recommendation), not free-form autonomous agents. A human recruiter makes the final decision.
6. **Explainability is mandatory.** Every match score must include evidence quotes. A validator must confirm each quote appears **verbatim** in the resume text; quotes that fail are dropped or re-requested. The UI highlights these quotes in the resume viewer.
7. **Security and safety:**
   - Treat resume text and candidate messages as **untrusted data**. Put them in clearly delimited blocks, tell the model never to follow instructions inside them, and keep scoring logic in code, not in the model's discretion.
   - **Ask-HR must never generate raw SQL.** The LLM outputs a structured filter object validated against a whitelist of fields and operators; the backend builds the query with parameterized SQLAlchemy.
   - Use only synthetic data. No real personal data.
8. **Code quality:** typed Python (Pydantic models for every agent input and output), TypeScript on the frontend, small focused modules, clear names, brief comments only where the reason isn't obvious. No dead code, no unused dependencies, no placeholder "TODO" features presented as done.
9. **Do not fake results.** If something cannot be done or verified (for example no API key is available), say so plainly. Never present mocked output as real, and never claim a test passed without running it.

## UI requirements (this matters a lot)

The UI must look like a real product, not a class exercise.

- **Next.js (App Router) + TypeScript**, Tailwind, shadcn/ui, Framer Motion, Recharts, React Flow. Next.js is the UI only; all AI logic stays in the Python FastAPI backend. The browser calls FastAPI directly via `NEXT_PUBLIC_API_URL` (enable CORS in FastAPI), including SSE streams, and does not go through Next.js rewrites, which can buffer streams. Use client components (`"use client"`) for interactive parts, and give every route a `loading.tsx` and `error.tsx`. Use the folder layout in PLAN.md section 4.
- A consistent design system: one accent colour, a proper type scale, consistent spacing, rounded cards, subtle shadows, **dark and light mode** that both look good.
- Screens (from PLAN.md section 8): Dashboard, Job Studio (streaming JD), Candidates (drag-and-drop upload + Kanban), Screening board (animated score rings, skill chips, resume viewer with highlighted evidence, blind-mode toggle), Compare (radar chart + panel debate), Interview room (chat + voice via Web Speech API + scorecard), Live Agent Graph (React Flow, nodes light up in real time via SSE), Evaluation tab, and a Ctrl+K command palette for Ask-HR.
- Every screen needs loading skeletons, empty states, error states with a retry action, and responsive layout.
- LLM output must **stream** wherever it makes sense (JD generation, interview replies, agent thoughts).
- Motion should be smooth and purposeful, never distracting.

## Validation requirements

Implement the 10 validation items in PLAN.md section 9.

- Create the synthetic golden dataset (`backend/data/`): 3 jobs and ~30 resumes labelled strong / average / weak / tricky, with expected ranking files. Include at least: one resume with hidden prompt-injection text, and name/gender/college-swapped variants of the same resume for the fairness test.
- Unit and contract tests run with a **mocked LLM** so they are fast and free. Evaluation runs (ranking accuracy, baseline comparison, fairness, injection) use the real Groq model and write results to a JSON file that the **Evaluation tab** displays.
- Include the keyword-matching baseline so the Matcher can be compared against it.
- Add a Playwright end-to-end test for the full flow.
- After each phase, run the relevant tests and report the actual output.

## Deliverables

- A working app that runs with the commands in PLAN.md section 12.
- `.env.example` (no real secrets) and a `README.md` with setup steps, how to get a free Groq key, how to switch to Ollama, how to run the tests, and how to run the demo.
- Seed/demo script that loads sample jobs and resumes so the app looks alive on first launch.
- A short `DEMO.md`: a 5-minute demo script with the exact click path.

## How to start

1. Confirm in a few lines that you understand the plan (stack, pipeline, the six-plus-three agents, the Groq-only rule).
2. Begin **Phase 0** and complete it, including the verification check from PLAN.md.
3. Then report and continue phase by phase. If I say "continue", start the next phase.

## Definition of done

- All phases complete; the full flow works end to end on the golden data with no errors.
- The validation suite has been run, and the real results (including any failures) are shown in the Evaluation tab and reported to me honestly.
- The UI is polished in both light and dark mode, and works on a laptop screen and a phone-width window.
- I can clone the repo, follow the README, and run the demo on a fresh machine.
