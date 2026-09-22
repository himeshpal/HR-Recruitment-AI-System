// Phase 6: a clean, repeatable set of screenshots of the seeded demo dataset, for the project report.
// Not part of the Playwright test suite (it asserts nothing) - run it directly: node scripts/demo-screenshots.mjs
// Needs: backend on :8000 with the demo dataset (backend/scripts/seed_demo.py), frontend on :3000.
//
// IDs are looked up by name at run time (SQLite recycles row ids after a delete, so hard-coding them breaks
// the moment the seed script is run again), not hard-coded.

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "../../docs/screenshots");
const API = "http://localhost:8000";
const APP = "http://localhost:3000";
const JOB_TITLE = "Backend Engineer"; // must match scripts/seed_demo.py

for (const mode of ["light", "dark"]) mkdirSync(path.join(OUT, mode), { recursive: true });

async function api(path) {
  const response = await fetch(`${API}${path}`);
  if (!response.ok) throw new Error(`${path} -> ${response.status}. Is the backend running with the demo dataset seeded?`);
  return response.json();
}

async function findDemoIds() {
  const jobs = await api("/api/jobs");
  const job = jobs.find((j) => j.title === JOB_TITLE);
  if (!job) throw new Error(`No job titled "${JOB_TITLE}". Run backend/scripts/seed_demo.py first.`);
  const matches = await api(`/api/jobs/${job.id}/matches`);
  const byName = (name) => matches.find((m) => m.candidate.name === name)?.id;
  const aaravCandidateId = matches.find((m) => m.candidate.name === "Aarav Mehta")?.candidate.id;
  const interviews = aaravCandidateId ? await api(`/api/interviews?candidate_id=${aaravCandidateId}&job_id=${job.id}`) : [];
  const interview = interviews.find((i) => i.status === "completed");
  return {
    jobId: job.id,
    matchIds: { aarav: byName("Aarav Mehta"), priya: byName("Priya Nair"), meera: byName("Meera Reddy") },
    interviewId: interview?.id,
  };
}

async function shot(page, mode, name) {
  await page.waitForTimeout(700); // let springs, count-ups and streams settle
  await page.screenshot({ path: path.join(OUT, mode, `${name}.png`) });
  console.log(`  ${mode}/${name}.png`);
}

async function openSheetTab(page, tabName) {
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("tab", { name: tabName }).click();
  await page.waitForTimeout(500);
  return sheet;
}

async function run(mode, ids) {
  console.log(`\n== ${mode}`);
  const browser = await chromium.launch({ channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.emulateMedia({ colorScheme: mode });

  await page.goto(`${APP}/`);
  await shot(page, mode, "01-dashboard");

  await page.goto(`${APP}/jobs`);
  await shot(page, mode, "02-jobs");

  await page.goto(`${APP}/jobs/${ids.jobId}`);
  await shot(page, mode, "03-job-studio");

  await page.goto(`${APP}/candidates`);
  await shot(page, mode, "04-candidates");

  await page.goto(`${APP}/screening/${ids.jobId}`);
  await shot(page, mode, "05-screening-board");

  await page.getByRole("button", { name: /rank 1,/ }).click();
  await page.waitForTimeout(400);
  await shot(page, mode, "06-match-sheet-evaluation");

  await openSheetTab(page, "Panel");
  await shot(page, mode, "07-match-sheet-panel");

  await openSheetTab(page, "Outreach");
  await shot(page, mode, "08-match-sheet-outreach");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  await page.goto(`${APP}/pipeline`);
  await shot(page, mode, "09-pipeline");

  await page.goto(`${APP}/compare?job=${ids.jobId}&ids=${ids.matchIds.aarav},${ids.matchIds.priya},${ids.matchIds.meera}`);
  await shot(page, mode, "10-compare");

  await page.goto(`${APP}/interview/${ids.interviewId}`);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, mode, "11a-interview-transcript");
  await page.getByRole("region", { name: "Interview scorecard" }).scrollIntoViewIfNeeded();
  await shot(page, mode, "11b-interview-scorecard");

  await page.goto(`${APP}/agents`);
  await page.getByRole("button", { name: "Send a test question" }).click();
  await page.waitForTimeout(2000);
  await shot(page, mode, "12-live-agents");

  await page.goto(`${APP}/evaluation`);
  await shot(page, mode, "13-evaluation");

  await page.goto(`${APP}/ask/${ids.jobId}`);
  await page.getByRole("button", { name: "How long is the technical interview?" }).click();
  await page.waitForTimeout(1500);
  await shot(page, mode, "14-candidate-qa");

  await page.goto(`${APP}/candidates`);
  await page.keyboard.press("Control+k");
  await page.getByLabel("Ask HR question").fill("Who has Python and at least 3 years of experience?");
  await page.getByRole("button", { name: "Search" }).click();
  await page.waitForTimeout(1500);
  await shot(page, mode, "15-ask-hr-palette");

  await browser.close();
}

const ids = await findDemoIds();
if (!ids.matchIds.aarav || !ids.matchIds.priya || !ids.matchIds.meera || !ids.interviewId) {
  throw new Error(`Could not find every expected match or a completed interview: ${JSON.stringify(ids)}`);
}
await run("light", ids);
await run("dark", ids);
console.log(`\nSaved to ${OUT}`);
