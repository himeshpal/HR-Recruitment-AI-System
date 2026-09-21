import fs from "node:fs";
import path from "node:path";

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const BACKEND = path.resolve(__dirname, "../../backend/data");
const SHOTS = process.env.SHOTS_DIR;

type Truth = { file: string; name: string; email: string };
const truth: Truth[] = JSON.parse(fs.readFileSync(path.join(BACKEND, "sample_resumes/ground_truth.json"), "utf8"));
const backendJob = JSON.parse(fs.readFileSync(path.join(BACKEND, "golden/jobs.json"), "utf8")).find(
  (j: { key: string }) => j.key === "backend",
) as { title: string; markdown: string };
const AARAV = truth.find((t) => t.file.includes("aarav"))!;

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.waitForTimeout(900); // let springs and count-ups settle
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

/** Make sure all 10 sample candidates exist (a phase 1 test deletes some); returns email -> id. */
async function ensureCandidates(request: APIRequestContext): Promise<Map<string, number>> {
  const existing = new Map<string, number>(
    ((await (await request.get(`${API}/api/candidates`)).json()) as { email: string; id: number }[]).map((c) => [c.email, c.id]),
  );
  for (const t of truth) {
    if (existing.has(t.email)) continue;
    const response = await request.post(`${API}/api/candidates/upload`, {
      multipart: { file: { name: t.file, mimeType: "application/octet-stream", buffer: fs.readFileSync(path.join(BACKEND, "sample_resumes", t.file)) } },
    });
    expect(response.ok(), `uploading ${t.file}`).toBeTruthy();
    existing.set(t.email, (await response.json()).id);
  }
  return existing;
}

/**
 * A fresh, not-yet-screened copy of the backend job. It deliberately uses the same title and text as the
 * validation script, so the AI answers are already cached and the test is fast and free.
 */
async function freshJob(request: APIRequestContext): Promise<number> {
  for (const job of (await (await request.get(`${API}/api/jobs`)).json()) as { id: number; title: string }[]) {
    if (job.title === backendJob.title) await request.delete(`${API}/api/jobs/${job.id}`);
  }
  const created = await (await request.post(`${API}/api/jobs`, { data: { title: backendJob.title, brief: "backend" } })).json();
  await request.put(`${API}/api/jobs/${created.id}`, { data: { markdown: backendJob.markdown } });
  return created.id;
}

async function screenViaApi(request: APIRequestContext, jobId: number) {
  const response = await request.post(`${API}/api/jobs/${jobId}/screen`, { timeout: 600_000 });
  expect(response.ok()).toBeTruthy();
  expect(await response.text()).toContain('"type": "done"');
}

test("screening: run it from the UI, see a ranked board, blind mode hides identity", async ({ page, request }) => {
  test.setTimeout(600_000);
  const ids = await ensureCandidates(request);
  await freshJob(request);

  await page.goto("/screening");
  await page.getByRole("link", { name: /Backend Engineer \(Phase 2 check\)/ }).click();
  await expect(page.getByRole("heading", { name: "Backend Engineer (Phase 2 check)" })).toBeVisible();
  await expect(page.getByText("No candidates screened yet")).toBeVisible();
  await shot(page, "screening-empty-light");

  await page.getByRole("button", { name: "Screen candidates" }).first().click();
  await expect(page.getByText(/^10\s+screened/)).toBeVisible({ timeout: 420_000 });
  await expect(page.getByRole("status")).toBeHidden(); // progress panel goes away when done

  // Ranked best-first: Aarav (the strong backend candidate) is #1 with a high score.
  const first = page.getByRole("button", { name: /rank 1,/ });
  await expect(first).toContainText(new RegExp(`Candidate #${ids.get(AARAV.email)}`));
  const score = Number((await first.getAttribute("aria-label"))!.match(/score (\d+)/)![1]);
  expect(score).toBeGreaterThanOrEqual(85);
  await expect(page.getByRole("button", { name: /rank 10,/ })).toBeVisible();

  // Blind mode is on by default: no names anywhere on the board.
  await expect(page.getByText("Aarav Mehta")).toHaveCount(0);
  await expect(page.getByText(/Candidate #\d+/).first()).toBeVisible();
  await shot(page, "screening-board-blind-light");

  // Turn it off: names appear, and the choice survives a reload.
  await page.getByRole("switch", { name: /Blind mode/ }).click();
  await expect(page.getByText("Aarav Mehta").first()).toBeVisible();
  await page.reload();
  await expect(page.getByText("Aarav Mehta").first()).toBeVisible();
  await shot(page, "screening-board-named-light");

  // Screening again only does new work: nothing is re-scored.
  await page.getByRole("button", { name: "Screen candidates" }).first().click();
  await expect(page.getByText("Everyone in the pool is already screened for this job.")).toBeVisible();
  await expect(page.getByText(/^10\s+screened/)).toBeVisible();
});

test("evaluation panel: score breakdown, evidence quotes and the highlighted resume", async ({ page, request }) => {
  test.setTimeout(600_000);
  await ensureCandidates(request);
  const jobId = await freshJob(request);
  await screenViaApi(request, jobId);

  await page.goto(`/screening/${jobId}`);
  await page.getByRole("button", { name: /rank 1,/ }).click();
  const sheet = page.getByRole("dialog");

  await expect(sheet.getByText("How the score is built")).toBeVisible();
  for (const part of ["Skills coverage", "Semantic fit", "Experience", "AI review"]) {
    await expect(sheet.getByText(part, { exact: false }).first()).toBeVisible();
  }
  await expect(sheet.getByText(/counts 30%/)).toBeVisible(); // weights come from the server
  await expect(sheet.getByText("Strengths")).toBeVisible();
  await expect(sheet.getByText("Evidence from the resume")).toBeVisible();
  await expect(sheet.getByRole("button", { name: /Show in resume/ }).first()).toBeVisible();
  await shot(page, "match-sheet-evaluation-light");

  // "Show in resume" jumps to the Resume tab and highlights that exact quote.
  await sheet.getByRole("button", { name: /Show in resume/ }).first().click();
  const highlighted = sheet.locator("mark[data-quote='0']");
  await expect(highlighted).toBeVisible();
  await expect(highlighted).toBeInViewport();

  // Blind mode: the AI's view shows placeholders, and the original is locked.
  await expect(sheet.getByText("[CANDIDATE]").first()).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Original" })).toBeDisabled();
  await expect(sheet.getByRole("button", { name: "Side by side" })).toBeDisabled();
  await expect(sheet.getByText("Turn off blind mode to see the original.")).toBeVisible();
  await shot(page, "match-sheet-resume-blind-light");
});

test("Bias Shield before/after: original next to what the AI saw", async ({ page, request }) => {
  test.setTimeout(600_000);
  await ensureCandidates(request);
  const jobId = await freshJob(request);
  await screenViaApi(request, jobId);

  await page.goto(`/screening/${jobId}`);
  await page.getByRole("switch", { name: /Blind mode/ }).click(); // reveal identities
  await page.getByRole("button", { name: /rank 1,/ }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText("Aarav Mehta").first()).toBeVisible();

  await sheet.getByRole("tab", { name: "Resume" }).click();
  await sheet.getByRole("button", { name: "Side by side" }).click();
  await expect(sheet.getByText("What the AI saw (identity hidden)")).toBeVisible();
  await expect(sheet.getByText("Original", { exact: true }).first()).toBeVisible();

  const panes = sheet.locator("pre");
  await expect(panes).toHaveCount(2);
  const [aiView, original] = [await panes.nth(0).innerText(), await panes.nth(1).innerText()];
  expect(original).toContain(AARAV.email);
  expect(original).toContain("Aarav Mehta");
  for (const secret of ["Aarav", "Mehta", AARAV.email, "Bengaluru", "NIT Surathkal"]) {
    expect(aiView, `AI view must not contain ${secret}`).not.toContain(secret);
  }
  expect(aiView).toContain("[EMAIL]");
  await shot(page, "bias-shield-side-by-side-light");
});

test("pipeline: drag a card between stages, or use the Move menu; changes persist", async ({ page, request }) => {
  test.setTimeout(600_000);
  const ids = await ensureCandidates(request);
  const jobId = await freshJob(request);
  await screenViaApi(request, jobId);
  const aaravId = ids.get(AARAV.email)!;
  await request.patch(`${API}/api/candidates/${aaravId}/stage`, { data: { stage: "screened" } });

  await page.goto("/pipeline");
  const screened = page.getByRole("region", { name: "Screened column" });
  const interview = page.getByRole("region", { name: "Interview column" });
  const card = screened.getByRole("article", { name: new RegExp(`Candidate #${aaravId}`) });
  await expect(card).toBeVisible();
  await expect(card.getByRole("img", { name: /Match score/ })).toBeVisible();
  await shot(page, "pipeline-light");

  // Drag and drop
  // grab the card by its name and drop it near the top of the column, like a person would
  // (the Move menu below the name is a native control, which cannot start a drag)
  await card.dragTo(interview, { sourcePosition: { x: 60, y: 18 }, targetPosition: { x: 100, y: 90 } });
  await expect(interview.getByRole("article", { name: new RegExp(`Candidate #${aaravId}`) })).toBeVisible();
  await expect.poll(async () => (await (await request.get(`${API}/api/candidates/${aaravId}`)).json()).stage).toBe("interview");

  // It is still there after a reload (it was saved, not just moved on screen).
  await page.reload();
  const moved = page.getByRole("region", { name: "Interview column" }).getByRole("article", { name: new RegExp(`Candidate #${aaravId}`) });
  await expect(moved).toBeVisible();

  // The keyboard / touch alternative: a plain menu on every card.
  await moved.getByLabel(/Move .* to another stage/).selectOption("offer");
  await expect(page.getByRole("region", { name: "Offer column" }).getByRole("article", { name: new RegExp(`Candidate #${aaravId}`) })).toBeVisible();
  await expect.poll(async () => (await (await request.get(`${API}/api/candidates/${aaravId}`)).json()).stage).toBe("offer");

  // "Why?" opens the same evaluation panel.
  await page.getByRole("region", { name: "Offer column" }).getByRole("button", { name: "Why?" }).click();
  await expect(page.getByRole("dialog").getByText("How the score is built")).toBeVisible();

  await request.patch(`${API}/api/candidates/${aaravId}/stage`, { data: { stage: "screened" } }); // tidy up
});

test("pipeline and screening pages work in dark mode and at phone width", async ({ page, request }) => {
  test.setTimeout(600_000);
  await ensureCandidates(request);
  const jobId = await freshJob(request);
  await screenViaApi(request, jobId);

  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(`/screening/${jobId}`);
  await expect(page.getByRole("button", { name: /rank 1,/ })).toBeVisible();
  await shot(page, "screening-board-dark");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("button", { name: /rank 1,/ })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow, "screening page scrolls horizontally on a phone").toBe(false);
  await shot(page, "screening-board-mobile-dark");

  await page.goto("/pipeline");
  await expect(page.getByRole("region", { name: "Applied column" })).toBeVisible();
  const pipelineOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(pipelineOverflow, "the pipeline scrolls inside its own container, not the whole page").toBe(false);
});
