import path from "node:path";

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const SAMPLES = path.resolve(__dirname, "../../backend/data/sample_resumes");
const SHOTS = process.env.SHOTS_DIR; // set it to also save screenshots for visual review

const RESUMES = {
  aarav: { file: "01_aarav_mehta.pdf", email: "aarav.mehta@example.com" },
  priya: { file: "02_priya_nair.docx", email: "priya.nair@example.com" },
  rohan: { file: "03_rohan_das.pdf", email: "rohan.das@example.com" },
  meera: { file: "08_meera_reddy.docx", email: "meera.reddy@example.com" },
};

async function shot(page: Page, name: string) {
  if (SHOTS) await page.waitForTimeout(700); // let transitions and springs settle
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

async function removeCandidates(request: APIRequestContext, emails: string[]) {
  const list = await (await request.get(`${API}/api/candidates`)).json();
  for (const c of list) {
    if (emails.includes(c.email)) await request.delete(`${API}/api/candidates/${c.id}`);
  }
}

async function removeE2eJobs(request: APIRequestContext) {
  const jobs = await (await request.get(`${API}/api/jobs`)).json();
  for (const job of jobs) {
    if (job.title.includes("(e2e)")) await request.delete(`${API}/api/jobs/${job.id}`);
  }
}

test.beforeEach(async ({ request }) => {
  await removeE2eJobs(request);
  await removeCandidates(request, Object.values(RESUMES).map((r) => r.email));
});

test("dashboard shows a healthy system", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  const status = page.getByText("System status").locator("xpath=ancestor::*[@data-slot='card'][1]");
  await expect(status.getByText("Backend", { exact: true })).toBeVisible();
  await expect(status.getByText("OK", { exact: true })).toHaveCount(3); // backend, database, API key
  await shot(page, "dashboard-light");
});

test("Job Studio: generate, highlight biased wording, fix it, save and extract requirements", async ({ page }) => {
  await page.goto("/jobs/new");
  await page.getByLabel("Job title").fill("Backend Engineer (e2e)");
  await page.getByLabel("Brief").fill("Backend engineer with 2+ years of Python and FastAPI, PostgreSQL, Docker. Nice to have: AWS.");
  await page.getByRole("button", { name: "Generate job description" }).click();

  // The JD streams into the preview and is saved by the server.
  await expect(page).toHaveURL(/\/jobs\/\d+\?generate=1/);
  await expect(page.getByRole("heading", { name: "Equal opportunity" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("JD Generator is writing…")).toBeHidden();
  await expect(page.getByText("No biased wording found.")).toBeVisible();
  await shot(page, "studio-generated-light");

  // Type biased wording: it is flagged, highlighted in the preview, and can be fixed in one click.
  await page.getByRole("tab", { name: "Edit" }).click();
  const editor = page.getByLabel("Job description (Markdown)");
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\n\nWe want a rockstar ninja who is young.");
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  await expect(page.getByText("“rockstar”")).toBeVisible();
  await expect(page.getByText("3 to review")).toBeVisible();

  await page.getByRole("tab", { name: "Preview" }).click();
  await expect(page.locator("mark", { hasText: /rockstar/i })).toBeVisible();
  await expect(page.locator("mark", { hasText: /young/i })).toBeVisible();
  await page.locator("mark", { hasText: /rockstar/i }).scrollIntoViewIfNeeded();
  await shot(page, "studio-flagged-light");

  await page.getByRole("button", { name: "Replace with “skilled engineer”" }).click();
  await expect(page.locator("mark", { hasText: /rockstar/i })).toHaveCount(0);
  await expect(page.getByText("2 to review")).toBeVisible();
  await page.getByRole("tab", { name: "Edit" }).click();
  await expect(editor).toHaveValue(/skilled engineer ninja/);

  // Save & analyze extracts the requirements the Matcher will use.
  await page.getByRole("button", { name: "Save & analyze" }).click();
  await expect(page.getByText("Saved. Requirements extracted.")).toBeVisible({ timeout: 60_000 });
  const requirements = page.getByText("Requirements").first().locator("xpath=ancestor::*[@data-slot='card'][1]");
  await expect(requirements.getByText("Must have")).toBeVisible();
  await expect(requirements.getByText("Python", { exact: true })).toBeVisible();
  await expect(page.getByText("Unsaved changes")).toBeHidden();

  // The saved job appears in the list with its skills.
  await page.goto("/jobs");
  const card = page.getByRole("link", { name: /Backend Engineer \(e2e\)/ }).first();
  await expect(card).toBeVisible();
  await expect(card.getByText("Python", { exact: true })).toBeVisible();
  await shot(page, "jobs-list-light");
});

test("Candidates: bulk upload, browse the parsed profile, search, delete", async ({ page }) => {
  await page.goto("/candidates");
  await page.locator("input[type=file]").setInputFiles(
    [RESUMES.aarav, RESUMES.priya, RESUMES.meera].map((r) => path.join(SAMPLES, r.file)),
  );

  await expect(page.getByText("3 of 3 processed")).toBeVisible({ timeout: 100_000 });
  await expect(page.getByText("Added Aarav Mehta")).toBeVisible();
  for (const name of ["Aarav Mehta", "Priya Nair", "Meera Reddy"]) {
    await expect(page.getByRole("button", { name: new RegExp(name) })).toBeVisible();
  }
  await shot(page, "candidates-light");

  // Detail panel
  await page.getByRole("button", { name: /Aarav Mehta/ }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText("6.5 yrs experience")).toBeVisible();
  await expect(sheet.getByText("FastAPI", { exact: true })).toBeVisible();
  await expect(sheet.getByText("Senior Software Engineer")).toBeVisible();
  await expect(sheet.getByText(/Jul 2021 – Dec 2024/)).toBeVisible();
  await shot(page, "candidate-sheet-light");
  await sheet.getByRole("tab", { name: "Resume text" }).click();
  await expect(sheet.getByText("aarav.mehta@example.com").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();

  // Search by skill
  await page.getByLabel("Search candidates").fill("Tableau");
  await expect(page.getByRole("button", { name: /Meera Reddy/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Aarav Mehta/ })).toHaveCount(0);
  await page.getByLabel("Search candidates").fill("nonexistent-skill");
  await expect(page.getByText("No candidates match")).toBeVisible();
  await page.getByLabel("Search candidates").fill("");

  // Delete
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: /Priya Nair/ }).click();
  await page.getByRole("button", { name: "Delete candidate" }).click();
  await expect(page.getByRole("button", { name: /Priya Nair/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Aarav Mehta/ })).toBeVisible();
});

test("Candidates: duplicate resumes and damaged files are explained, not silently dropped", async ({ page }) => {
  await page.goto("/candidates");
  const rohan = path.join(SAMPLES, RESUMES.rohan.file);
  await page.locator("input[type=file]").setInputFiles(rohan);
  await expect(page.getByText("Added Rohan Das")).toBeVisible({ timeout: 60_000 });

  await page.locator("input[type=file]").setInputFiles(rohan);
  await expect(page.getByText(/already uploaded/)).toBeVisible();

  await page.locator("input[type=file]").setInputFiles({
    name: "broken.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 this is not really a pdf"),
  });
  await expect(page.getByText(/Could not read this file/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry broken.pdf" })).toBeVisible();
  await shot(page, "candidates-errors-light");

  await page.getByRole("button", { name: "Clear finished" }).click();
  await expect(page.getByText("processed")).toBeHidden();
});

test("dark mode and phone width both look right", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/jobs");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await shot(page, "jobs-dark");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/candidates");
  await expect(page.getByLabel("Upload resumes: drop files here or press Enter to browse")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow, "page scrolls horizontally on a phone").toBe(false);
  await shot(page, "candidates-mobile-dark");
});

test("unknown job shows a friendly error, not a crash", async ({ page }) => {
  await page.goto("/jobs/999999");
  await expect(page.getByText("Job not found")).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});
