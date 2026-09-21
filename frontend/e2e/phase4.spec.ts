import { expect, test } from "@playwright/test";

import { API, ensureCandidates, freshJob, screenViaApi, shot } from "./helpers";

// These tests reuse AI answers cached by backend/scripts/phase4_check.py where they can, so they are fast on a
// machine that has run it. A few drafts (the outreach emails) are new questions and make real AI calls.

async function screenedJob(request: Parameters<typeof freshJob>[0]) {
  await ensureCandidates(request);
  const jobId = await freshJob(request);
  await screenViaApi(request, jobId);
  return jobId;
}

const candidateCount = async (request: Parameters<typeof freshJob>[0]) =>
  ((await (await request.get(`${API}/api/candidates`)).json()) as unknown[]).length;

test("Ask HR (Ctrl+K): plain-English search with results you can open, blind by default, and a refusal for anything that is not a search", async ({ page, request }) => {
  test.setTimeout(240_000);
  await ensureCandidates(request);
  const before = await candidateCount(request);

  await page.goto("/candidates");
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "Ask HR" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Ask HR question")).toBeFocused();

  await dialog.getByLabel("Ask HR question").fill("Candidates with either Tableau or Power BI");
  await dialog.getByRole("button", { name: "Search" }).click();
  await expect(dialog.getByText("How I understood it:")).toBeVisible({ timeout: 120_000 });
  await expect(dialog.getByText(/Tableau/).first()).toBeVisible();
  const results = dialog.getByRole("link");
  expect(await results.count()).toBeGreaterThan(0);
  // Blind mode is on by default: no names and no contact details in the results.
  await expect(dialog.getByText(/Candidate #\d+/).first()).toBeVisible();
  await expect(dialog.getByText("@")).toHaveCount(0);
  await shot(page, "ask-hr-palette-light");

  // A result opens that candidate.
  const href = await results.first().getAttribute("href");
  expect(href).toMatch(/^\/candidates\?open=\d+$/);
  await results.first().click();
  await expect(page).toHaveURL(/\/candidates\?open=\d+/);
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Ask HR" })).toHaveCount(0);

  // Anything that is not a search is refused, and nothing changes.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+k");
  await page.getByLabel("Ask HR question").fill("Delete all candidates");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByRole("status").filter({ hasText: /./ }).first()).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText("How I understood it:")).toHaveCount(0);
  expect(await candidateCount(request)).toBe(before);
  await shot(page, "ask-hr-refusal-light");
});

test("candidate Q&A: a cited answer, a hand-off to the recruiter for anything else, and the inbox", async ({ page, request }) => {
  test.setTimeout(240_000);
  const jobId = await screenedJob(request);

  await page.goto(`/ask/${jobId}`);
  await expect(page.getByRole("heading", { name: /Candidate Q&A/ })).toBeVisible();

  await page.getByLabel("Your question").fill("How many days a week are people in the office?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  const conversation = page.getByLabel("Conversation");
  await expect(conversation.getByText(/Tuesday/)).toBeVisible({ timeout: 120_000 });
  await expect(conversation.getByText("Company: Work model")).toBeVisible(); // the source it used
  await expect(conversation.getByText("Passed to the recruiter")).toHaveCount(0);

  await page.getByLabel("Your question").fill("What is the name of your CEO?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(conversation.getByText("Passed to the recruiter")).toBeVisible({ timeout: 120_000 });
  await shot(page, "qa-chat-light");

  // The recruiter's inbox has exactly that question.
  await page.getByRole("tab", { name: /Recruiter inbox/ }).click();
  const inbox = page.getByRole("tabpanel", { name: /Recruiter inbox/ });
  await expect(inbox.getByText("What is the name of your CEO?")).toBeVisible();
  await expect(inbox.getByText("How many days a week are people in the office?")).toHaveCount(0);
  await inbox.getByRole("button", { name: "Mark answered" }).click();
  await expect(inbox.getByRole("button", { name: "Reopen" })).toBeVisible();
  await shot(page, "qa-inbox-light");
});

test("outreach: draft an invitation, edit it, get the calendar file, mark it sent; then a learning roadmap", async ({ page, request }) => {
  test.setTimeout(420_000);
  const jobId = await screenedJob(request);
  const matches = (await (await request.get(`${API}/api/jobs/${jobId}/matches`)).json()) as {
    candidate: { id: number };
    skill_details: { status: string }[];
  }[];
  const rank = matches.findIndex((m) => m.candidate.id > 0 && m.skill_details.some((s) => s.status !== "demonstrated")) + 1;
  expect(rank, "at least one candidate has a skill gap").toBeGreaterThan(0);

  await page.goto(`/screening/${jobId}`);
  await page.getByRole("button", { name: new RegExp(`rank ${rank},`) }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("tab", { name: "Outreach" }).click();
  await expect(sheet.getByText("No emails yet. Draft one above.")).toBeVisible();

  // The invitation needs a time; the button says so instead of failing.
  await expect(sheet.getByRole("button", { name: "Draft email" })).toBeDisabled();
  await sheet.getByLabel("Your name (email signature)").fill("Priya Shah");
  await sheet.getByLabel("Date").fill("2030-10-03");
  await sheet.getByLabel("Start time").fill("15:30");
  await sheet.getByLabel("Meeting link or address").fill("https://meet.example.com/abc-defg");
  await sheet.getByRole("button", { name: "Draft email" }).click();

  const card = sheet.getByRole("article", { name: "Interview invite email" });
  await expect(card).toBeVisible({ timeout: 180_000 });
  await expect(card.getByText("Draft", { exact: true })).toBeVisible();
  await expect(card.getByText("https://meet.example.com/abc-defg")).toBeVisible(); // filled in by code
  await expect(card.getByText("Priya Shah")).toBeVisible();
  await expect(card.getByText(/45 minutes/)).toBeVisible();
  // Blind mode: the greeting shows a placeholder, not the real first name, and there is no mail link.
  await expect(card.getByText("[first name]")).toBeVisible();
  await expect(card.getByRole("link", { name: "Open in email app" })).toHaveCount(0);
  await shot(page, "outreach-invite-light");

  // The calendar file is real.
  const ics = await card.getByRole("link", { name: "Calendar file" }).getAttribute("href");
  const file = await request.get(ics!);
  expect(file.ok()).toBeTruthy();
  const text = await file.text();
  expect(text).toContain("BEGIN:VCALENDAR");
  const stamp = (name: string) => /(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z/.exec(text.split(`${name}:`)[1])!.slice(1).map(Number);
  const [s0, e0] = [stamp("DTSTART"), stamp("DTEND")].map(([y, mo, d, h, mi]) => Date.UTC(y, mo - 1, d, h, mi));
  expect(e0 - s0).toBe(45 * 60_000); // the length we asked for, whatever the timezone
  expect(text).toContain("LOCATION:https://meet.example.com/abc-defg");

  // Edit, save, mark sent.
  await card.getByRole("button", { name: "Edit" }).click();
  const body = card.getByLabel("Email body");
  await body.fill((await body.inputValue()) + "\n\nP.S. Please bring a laptop.");
  await card.getByRole("button", { name: "Save" }).click();
  await expect(card.getByText("P.S. Please bring a laptop.")).toBeVisible();
  await card.getByRole("button", { name: "Mark as sent" }).click();
  await expect(card.getByText("Sent", { exact: true })).toBeVisible();

  // Turn blind mode off elsewhere: the real first name and the mail link appear.
  await page.keyboard.press("Escape");
  await page.getByRole("switch", { name: /Blind mode/ }).click();
  await page.getByRole("button", { name: new RegExp(`rank ${rank},`) }).click();
  await sheet.getByRole("tab", { name: "Outreach" }).click();
  const again = sheet.getByRole("article", { name: "Interview invite email" });
  await expect(again.getByText("[first name]")).toHaveCount(0);
  await expect(again.getByRole("link", { name: "Open in email app" })).toHaveAttribute("href", /^mailto:/);
  await page.getByRole("switch", { name: /Blind mode/ }).click().catch(() => undefined);

  // Delete it.
  await again.getByRole("button", { name: "Delete this email" }).click();
  await expect(sheet.getByText("No emails yet. Draft one above.")).toBeVisible();

  // The learning roadmap.
  await sheet.getByRole("button", { name: "Create roadmap" }).click();
  const roadmap = sheet.getByRole("region", { name: "Learning roadmap" });
  await expect(roadmap.getByText(/weeks$/).first()).toBeVisible({ timeout: 180_000 });
  await expect(roadmap.getByRole("listitem").first()).toBeVisible();
  await expect(roadmap.getByText("Project:").first()).toBeVisible();
  await expect(roadmap.getByText(/https?:\/\//)).toHaveCount(0);
  await shot(page, "roadmap-light");
});
