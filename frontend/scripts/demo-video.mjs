// Phase 6: a backup demo video, in case the live demo can't run on presentation day.
// This is a walkthrough of the already-seeded demo dataset (backend/scripts/seed_demo.py) - it does not
// repeat the real AI calls that produced it (that would make the video slow and non-reproducible), except
// for two moments that are genuinely live: sending a fresh Ask-HR question, and the Live Agents page reacting
// to it in real time. Everything else (the screening scores, the panel verdicts, the interview scorecard,
// the sent emails) is real output from a real run, just not re-run on camera.
//
// Not a Playwright test: run it directly with node scripts/demo-video.mjs. Needs the backend on :8000 with
// the demo dataset seeded, and the frontend on :3000.

import { chromium } from "playwright";
import { mkdirSync, readdirSync, renameSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "../../docs/video");
const API = "http://localhost:8000";
const APP = "http://localhost:3000";
const JOB_TITLE = "Backend Engineer"; // must match scripts/seed_demo.py

mkdirSync(OUT_DIR, { recursive: true });

async function api(p) {
  const response = await fetch(`${API}${p}`);
  if (!response.ok) throw new Error(`${p} -> ${response.status}. Is the backend running with the demo dataset seeded?`);
  return response.json();
}

async function findDemoIds() {
  const jobs = await api("/api/jobs");
  const job = jobs.find((j) => j.title === JOB_TITLE);
  if (!job) throw new Error(`No job titled "${JOB_TITLE}". Run backend/scripts/seed_demo.py first.`);
  const matches = await api(`/api/jobs/${job.id}/matches`);
  const byName = (name) => matches.find((m) => m.candidate.name === name)?.id;
  const aaravCandidateId = matches.find((m) => m.candidate.name === "Aarav Mehta")?.candidate.id;
  const rohanCandidateId = matches.find((m) => m.candidate.name === "Rohan Das")?.candidate.id;
  const interviews = aaravCandidateId ? await api(`/api/interviews?candidate_id=${aaravCandidateId}&job_id=${job.id}`) : [];
  const interview = interviews.find((i) => i.status === "completed");
  return {
    jobId: job.id,
    matchIds: { aarav: byName("Aarav Mehta"), priya: byName("Priya Nair"), meera: byName("Meera Reddy"), rohan: byName("Rohan Das") },
    rohanCandidateId,
    interviewId: interview?.id,
  };
}

async function pause(page, ms) {
  await page.waitForTimeout(ms); // a beat, as if a presenter were talking over this screen
}

async function openSheetTab(page, tabName) {
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("tab", { name: tabName }).click();
  await pause(page, 1500);
  return sheet;
}

async function main() {
  const ids = await findDemoIds();
  if (!ids.matchIds.aarav || !ids.matchIds.rohan || !ids.interviewId) {
    throw new Error(`Could not find every expected match or a completed interview: ${JSON.stringify(ids)}`);
  }

  const browser = await chromium.launch({ channel: "msedge" });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: OUT_DIR, size: { width: 1440, height: 900 } },
  });
  const page = await context.newPage();

  console.log("Recording...");

  // 1. Dashboard: the story so far.
  await page.goto(`${APP}/`);
  await pause(page, 3500);

  // 2. Job Studio: the job the story is about.
  await page.goto(`${APP}/jobs/${ids.jobId}`);
  await pause(page, 3500);

  // 3. Candidates: everyone who applied.
  await page.goto(`${APP}/candidates`);
  await pause(page, 3000);

  // 4. Screening board: ranked, with evidence, blind by default.
  await page.goto(`${APP}/screening/${ids.jobId}`);
  await pause(page, 3000);

  // 5. Aarav Mehta: evaluation, then the panel debate.
  await page.getByRole("button", { name: /rank 1,/ }).click();
  await pause(page, 2500);
  await openSheetTab(page, "Panel");
  await pause(page, 2500);

  // 6. The interview and its scorecard.
  await openSheetTab(page, "Interview");
  await pause(page, 1500);
  await page.keyboard.press("Escape");
  await pause(page, 500);
  await page.goto(`${APP}/interview/${ids.interviewId}`);
  await page.evaluate(() => window.scrollTo(0, 0));
  await pause(page, 2500);
  await page.getByRole("region", { name: "Interview scorecard" }).scrollIntoViewIfNeeded();
  await pause(page, 3500);

  // 7. Compare: the same three candidates, side by side.
  await page.goto(`${APP}/compare?job=${ids.jobId}&ids=${ids.matchIds.aarav},${ids.matchIds.priya},${ids.matchIds.meera}`);
  await pause(page, 3500);

  // 8. Aarav's outreach: invited, interviewed, offered.
  await page.goto(`${APP}/screening/${ids.jobId}`);
  await page.getByRole("button", { name: /rank 1,/ }).click();
  await openSheetTab(page, "Outreach");
  await pause(page, 3500);
  await page.keyboard.press("Escape");
  await pause(page, 500);

  // 9. Rohan's outreach: a real rejection, with real skill-gap feedback and a learning roadmap.
  await page.getByRole("button", { name: new RegExp(`Candidate #${ids.rohanCandidateId}`) }).click().catch(() => {});
  await pause(page, 1500);

  // 10. Pipeline: where everyone stands.
  await page.goto(`${APP}/pipeline`);
  await pause(page, 3000);

  // 11. Live agents: this is the genuinely live part.
  await page.goto(`${APP}/agents`);
  await pause(page, 2000);
  await page.getByRole("button", { name: "Send a test question" }).click();
  await pause(page, 4000); // the node lighting up and the feed entry arriving, on camera

  // 12. Candidate Q&A: a real (if cached) grounded answer.
  await page.goto(`${APP}/ask/${ids.jobId}`);
  await page.getByRole("button", { name: "How long is the technical interview?" }).click();
  await pause(page, 3000);

  // 13. Ask-HR: a live natural-language search, from anywhere in the app.
  await page.goto(`${APP}/candidates`);
  await page.keyboard.press("Control+k");
  await pause(page, 400);
  await page.getByLabel("Ask HR question").type("Who has FastAPI experience?", { delay: 45 });
  await page.getByRole("button", { name: "Search" }).click();
  await pause(page, 4000);
  await page.keyboard.press("Escape");

  // 14. Evaluation: how we know all of this actually works.
  await page.goto(`${APP}/evaluation`);
  await pause(page, 3000);

  // 15. Back to the dashboard to close.
  await page.goto(`${APP}/`);
  await pause(page, 3000);

  await context.close();
  await browser.close();

  const [latest] = readdirSync(OUT_DIR)
    .filter((f) => f.endsWith(".webm"))
    .map((f) => ({ f, t: statSync(path.join(OUT_DIR, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  const finalPath = path.join(OUT_DIR, "demo.webm");
  if (latest) renameSync(path.join(OUT_DIR, latest.f), finalPath);
  console.log(`\nSaved to ${finalPath}`);
}

await main();
