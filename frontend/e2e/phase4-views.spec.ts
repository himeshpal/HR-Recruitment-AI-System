import { expect, test } from "@playwright/test";

import { ensureCandidates, freshJob, screenViaApi, shot } from "./helpers";

// Dark mode and phone width for the Phase 4 screens. Nothing here may overflow the page sideways.

async function noSidewaysScroll(page: import("@playwright/test").Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "the page scrolls sideways").toBeLessThanOrEqual(1);
}

test("dark mode: palette, Q&A and outreach are readable", async ({ page, request }) => {
  test.setTimeout(240_000);
  await ensureCandidates(request);
  const jobId = await freshJob(request);
  await screenViaApi(request, jobId);
  await page.emulateMedia({ colorScheme: "dark" });

  await page.goto(`/ask/${jobId}`);
  await page.getByLabel("Your question").fill("How long is the technical interview?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByLabel("Conversation").getByText(/60 minutes/)).toBeVisible({ timeout: 120_000 });
  await shot(page, "qa-chat-dark");

  await page.keyboard.press("Control+k");
  await page.getByLabel("Ask HR question").fill("Show the data analysts");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText("How I understood it:")).toBeVisible({ timeout: 120_000 });
  await shot(page, "ask-hr-palette-dark");
});

test("phone width: no sideways scroll on the Q&A page, the palette and the outreach tab", async ({ page, request }) => {
  test.setTimeout(240_000);
  await ensureCandidates(request);
  const jobId = await freshJob(request);
  await screenViaApi(request, jobId);
  await page.setViewportSize({ width: 390, height: 800 });

  await page.goto(`/ask/${jobId}`);
  await page.getByRole("button", { name: "Do I need AWS experience?" }).click();
  await expect(page.getByLabel("Conversation").getByText(/nice/i).first()).toBeVisible({ timeout: 120_000 });
  await noSidewaysScroll(page);
  await shot(page, "qa-chat-phone");

  await page.getByRole("button", { name: "Ask HR" }).click(); // the search icon in the phone header
  const dialog = page.getByRole("dialog", { name: "Ask HR" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Ask HR question").fill("Who has Java experience?");
  await dialog.getByRole("button", { name: "Search" }).click();
  await expect(dialog.getByText("How I understood it:")).toBeVisible({ timeout: 120_000 });
  await noSidewaysScroll(page);
  await shot(page, "ask-hr-palette-phone");
  await page.keyboard.press("Escape");

  await page.goto(`/screening/${jobId}`);
  await page.getByRole("button", { name: /rank 1,/ }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("tab", { name: "Outreach" }).click();
  await expect(sheet.getByRole("button", { name: "Draft email" })).toBeVisible();
  await noSidewaysScroll(page);
  // The sheet has its own scroll area, so the page check above cannot see it overflow.
  for (const tab of ["Evaluation", "Panel", "Interview", "Outreach", "Resume"]) {
    await sheet.getByRole("tab", { name: tab }).click();
    const overflow = await sheet.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow, `the sheet scrolls sideways on the ${tab} tab`).toBeLessThanOrEqual(1);
  }
  await sheet.getByRole("tab", { name: "Outreach" }).click();
  await shot(page, "outreach-phone");
});
