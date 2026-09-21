import { expect, test, type Page } from "@playwright/test";

import { AARAV, API, ensureCandidates, freshJob, panelViaApi, screenViaApi, shot } from "./helpers";

// These tests reuse the AI answers cached by backend/scripts/phase3_check.py, so they are fast on a
// machine that has run it. On a fresh machine the first run makes real AI calls and takes a few minutes.

async function screenedJob(request: Parameters<typeof freshJob>[0]) {
  const ids = await ensureCandidates(request);
  const jobId = await freshJob(request);
  await screenViaApi(request, jobId);
  return { ids, jobId };
}

/** Answer with the Demo helper until the scorecard appears (a thin answer can add a follow-up question). */
async function finishInterview(page: Page, quality: "Strong" | "Weak" = "Strong") {
  for (let turn = 0; turn < 12; turn++) {
    if (await page.getByRole("region", { name: "Interview scorecard" }).isVisible()) return;
    await page.getByRole("button", { name: `${quality} sample` }).click();
    await expect(page.getByLabel("Your answer")).not.toHaveValue("", { timeout: 120_000 });
    await page.getByRole("button", { name: "Send answer" }).click();
    // settled = the scorecard is showing, or the interviewer has replied and the box is empty again
    await expect
      .poll(
        async () => {
          if (await page.getByRole("region", { name: "Interview scorecard" }).isVisible()) return "settled";
          const box = page.getByLabel("Your answer");
          const thinking = await page.getByRole("status", { name: "The interviewer is thinking" }).isVisible();
          return !thinking && (await box.count()) > 0 && (await box.inputValue()) === "" ? "settled" : "waiting";
        },
        { timeout: 120_000 },
      )
      .toBe("settled");
  }
  throw new Error("the interview did not finish");
}

test("panel review from the board: verdicts appear on the top 3 cards, and the Panel tab shows every panelist", async ({ page, request }) => {
  test.setTimeout(900_000);
  const { jobId } = await screenedJob(request);

  await page.goto(`/screening/${jobId}`);
  await expect(page.getByRole("button", { name: /rank 1,/ })).toBeVisible();
  await expect(page.getByText(/^(Hire|Maybe|No hire)$/)).toHaveCount(0); // no panel yet

  await page.getByRole("button", { name: "Panel review (top 3)" }).click();
  // (the "Reviewing candidate n of 3" progress text can flash by too quickly to catch when answers are cached)
  await expect(page.getByText("Panel reviewed 3 candidates")).toBeVisible({ timeout: 600_000 });
  await expect(page.getByText(/^(Hire|Maybe|No hire)$/)).toHaveCount(3); // exactly the top 3 got a verdict
  await shot(page, "panel-verdicts-on-board-light");

  await page.getByRole("button", { name: /rank 1,/ }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("tab", { name: "Panel" }).click();
  await expect(sheet.getByRole("region", { name: "Moderator summary" })).toBeVisible();
  for (const persona of ["Tech Lead", "HR Manager", "Hiring Manager"]) {
    await expect(sheet.getByRole("article", { name: `${persona} review` })).toBeVisible();
  }
  await expect(sheet.getByText("The verdict follows fixed rules")).toBeVisible();
  await expect(sheet.getByText(/Questions the panel would ask/)).toBeVisible();
  await shot(page, "panel-tab-light");
});

test("the Panel tab can run a single review with the panelists arriving one by one", async ({ page, request }) => {
  test.setTimeout(600_000);
  const { jobId } = await screenedJob(request);
  await page.goto(`/screening/${jobId}`);
  await page.getByRole("button", { name: /rank 1,/ }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("tab", { name: "Panel" }).click();

  await expect(sheet.getByText("No panel review yet")).toBeVisible();
  await sheet.getByRole("button", { name: "Run panel review" }).click();
  await expect(sheet.getByRole("region", { name: "Moderator summary" })).toBeVisible({ timeout: 300_000 });
  await expect(sheet.getByRole("article", { name: "Tech Lead review" })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Run the panel again" })).toBeVisible();
  // the verdict badge on the card behind the panel updates too
  await expect(sheet.getByText(/^(Hire|Maybe|No hire)$/).first()).toBeVisible();
});

test("compare: pick candidates, see bars, radar and table with a legend, tooltips and the panel discussion", async ({ page, request }) => {
  test.setTimeout(900_000);
  const { jobId } = await screenedJob(request);
  await panelViaApi(request, jobId, 3);

  await page.goto(`/screening/${jobId}`);
  await expect(page.getByRole("button", { name: /rank 3,/ })).toBeVisible();
  const compare = page.getByRole("region", { name: "Compare selection" });
  await expect(compare).toBeHidden();

  const checkboxes = page.getByRole("checkbox", { name: /^Compare / });
  await checkboxes.nth(0).check();
  await expect(compare).toContainText("1 selected");
  await expect(compare.getByRole("link", { name: /Compare/ })).toHaveAttribute("aria-disabled", "true"); // needs two or more
  await checkboxes.nth(1).check();
  await checkboxes.nth(2).check();
  await expect(compare).toContainText("3 selected");
  await expect(checkboxes.nth(3)).toBeDisabled(); // a fourth is not allowed
  await compare.getByRole("link", { name: /Compare/ }).click();

  await expect(page).toHaveURL(/\/compare\?job=\d+&ids=\d+,\d+,\d+/);
  await expect(page.getByRole("heading", { name: "Compare candidates" })).toBeVisible();

  // Legend: identity is not colour alone, and blind mode hides names
  const legend = page.getByRole("list", { name: "Legend" });
  await expect(legend.getByRole("listitem")).toHaveCount(3);
  await expect(legend).toContainText(/Candidate #\d+/);
  await expect(page.getByText("Aarav Mehta")).toHaveCount(0);

  // Bars: seven dimensions (four match scores + three panelists), and a tooltip on hover
  const chart = page.getByRole("region", { name: "Score comparison" });
  for (const dim of ["Skills coverage", "Semantic fit", "Experience", "AI review", "Tech Lead", "HR Manager", "Hiring Manager"]) {
    await expect(chart.getByRole("group", { name: dim })).toBeVisible();
  }
  await chart.getByRole("group", { name: "Skills coverage" }).getByRole("img", { name: /out of 100/ }).first().hover();
  await expect(page.getByRole("tooltip")).toContainText("Skills coverage");
  await expect(page.getByRole("tooltip")).toContainText("/ 100");
  await shot(page, "compare-bars-light");

  // Radar
  await chart.getByRole("button", { name: "Radar" }).click();
  await expect(chart.getByRole("img", { name: /Radar chart/ })).toBeVisible();
  await chart.getByRole("button", { name: /^Skills coverage:/ }).focus(); // keyboard users get the same tooltip
  await expect(page.getByRole("tooltip")).toBeVisible();
  await shot(page, "compare-radar-light");

  // Table: the accessible alternative with the same numbers
  await chart.getByRole("button", { name: "Table" }).click();
  const table = chart.getByRole("table");
  await expect(table.getByRole("row")).toHaveCount(8); // header + 7 scores
  await expect(table.getByRole("columnheader")).toHaveCount(4); // "Score" + 3 candidates

  // The panel discussion side by side
  await expect(page.getByRole("region", { name: "Panel discussion" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Moderator" })).toBeVisible();

  // Blind mode off: real names in the legend
  await page.getByRole("switch", { name: /Blind mode/ }).click();
  await expect(legend).toContainText("Aarav Mehta");
});

test("compare: without a selection there is a helpful empty state, and missing panels can be added from here", async ({ page, request }) => {
  test.setTimeout(900_000);
  const { jobId } = await screenedJob(request);
  await page.goto("/compare");
  await expect(page.getByText("Nothing to compare yet")).toBeVisible();
  await page.goto(`/compare?job=${jobId}&ids=`);
  await expect(page.getByText("Pick two or three candidates to compare")).toBeVisible();

  const matches = (await (await request.get(`${API}/api/jobs/${jobId}/matches`)).json()) as { id: number }[];
  await page.goto(`/compare?job=${jobId}&ids=${matches[0].id},${matches[1].id}`);
  await expect(page.getByRole("button", { name: "Run panel for these candidates" })).toBeVisible();
  await expect(page.getByText(/panelists' scores are added once every selected candidate/)).toBeVisible();
  await expect(page.getByRole("group", { name: "Tech Lead" })).toHaveCount(0); // only the match scores for now
});

test("interview: start from the candidate panel, answer every question, get a scorecard", async ({ page, request }) => {
  test.setTimeout(900_000);
  const { ids, jobId } = await screenedJob(request);
  await panelViaApi(request, jobId, 1); // the panel's questions and the screening gaps shape the interview
  const aaravId = ids.get(AARAV.email)!;

  await page.goto(`/screening/${jobId}`);
  await page.getByRole("button", { name: /rank 1,/ }).click();
  await page.getByRole("dialog").getByRole("tab", { name: "Interview" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Start interview" }).click();

  await expect(page).toHaveURL(/\/interview\/\d+/, { timeout: 180_000 });
  await expect(page.getByRole("heading", { name: "Interview" })).toBeVisible();
  await expect(page.getByText(`Candidate #${aaravId}`)).toBeVisible(); // blind mode
  await expect(page.getByText("Aarav Mehta")).toHaveCount(0);
  await expect(page.getByRole("log", { name: "Interview conversation" })).toContainText("FastAPI", { timeout: 20_000 });
  await expect(page.getByText("Question 1 of 5")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send answer" })).toBeDisabled(); // nothing typed yet
  await shot(page, "interview-start-light");

  // Timer runs
  await expect.poll(async () => (await page.getByLabel("Interview time").innerText()).trim(), { timeout: 10_000 }).not.toBe("0:00");

  // First answer moves us to the next question
  await page.getByRole("button", { name: "Strong sample" }).click();
  await expect(page.getByLabel("Your answer")).not.toHaveValue("", { timeout: 120_000 });
  await page.getByRole("button", { name: "Send answer" }).click();
  await expect(page.getByText("Question 2 of 5")).toBeVisible({ timeout: 120_000 });
  await shot(page, "interview-midway-light");

  await finishInterview(page, "Strong");
  const card = page.getByRole("region", { name: "Interview scorecard" });
  await expect(card.getByText(/Strong interview/)).toBeVisible();
  await expect(card.getByRole("img", { name: /Match score \d+ out of 100/ })).toBeVisible();
  for (const part of ["Technical", "Problem solving", "Behavioural", "Role fit", "Communication"]) {
    await expect(card.getByText(part, { exact: false }).first()).toBeVisible();
  }
  await expect(card.getByText(/Took \d+:\d\d/)).toBeVisible();
  await expect(page.getByLabel("Your answer")).toHaveCount(0); // the input goes away when finished
  await expect(page.getByText("Finished")).toBeVisible();
  await card.locator("details").first().locator("summary").click();
  await expect(card.getByText(/Feedback:/).first()).toBeVisible();
  await shot(page, "interview-scorecard-light");

  // It shows up on the candidate's Interview tab, with its score, and reopens
  await page.goto(`/screening/${jobId}`);
  await page.getByRole("button", { name: /rank 1,/ }).click();
  await page.getByRole("dialog").getByRole("tab", { name: "Interview" }).click();
  await expect(page.getByRole("dialog").getByText(/Completed/)).toBeVisible();
  await expect(page.getByRole("dialog").getByText("Previous interviews")).toBeVisible();
});

test("interview: a thin answer earns a follow-up question, once", async ({ page, request }) => {
  test.setTimeout(900_000);
  const { ids, jobId } = await screenedJob(request);
  await panelViaApi(request, jobId, 1);
  const created = await request.post(`${API}/api/interviews`, { data: { candidate_id: ids.get(AARAV.email)!, job_id: jobId }, timeout: 180_000 });
  expect(created.ok()).toBeTruthy();
  const interviewId = (await created.json()).id;

  await page.goto(`/interview/${interviewId}`);
  await page.getByRole("button", { name: "Weak sample" }).click();
  await expect(page.getByLabel("Your answer")).not.toHaveValue("", { timeout: 120_000 });
  await page.getByRole("button", { name: "Send answer" }).click();
  await expect(page.getByText("Follow-up", { exact: true })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText("Question 1 of 5")).toBeVisible(); // still on the same question
  await shot(page, "interview-follow-up-light");
});

test("interview: voice dictation fills the answer box, and the mic button is simply absent when unsupported", async ({ page, request }) => {
  test.setTimeout(600_000);
  const { ids, jobId } = await screenedJob(request);
  const created = await request.post(`${API}/api/interviews`, { data: { candidate_id: ids.get(AARAV.email)!, job_id: jobId }, timeout: 180_000 });
  const interviewId = (await created.json()).id;

  // A fake microphone that "hears" a sentence a moment after it is started.
  await page.addInitScript(() => {
    class FakeRecognition {
      continuous = false;
      interimResults = false;
      lang = "";
      onresult: ((e: unknown) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        setTimeout(() => this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "I would start by measuring the query" } }] }), 50);
      }
      stop() {
        this.onend?.();
      }
    }
    // Browsers expose the API under both names and the app uses whichever exists, so replace both.
    const w = window as unknown as Record<string, unknown>;
    w.SpeechRecognition = FakeRecognition;
    w.webkitSpeechRecognition = FakeRecognition;
  });
  await page.goto(`/interview/${interviewId}`);
  await page.getByLabel("Your answer").fill("First,");
  await page.getByRole("button", { name: "Dictate" }).click();
  await expect(page.getByLabel("Your answer")).toHaveValue("First, I would start by measuring the query");
  await page.getByRole("button", { name: "Stop dictating" }).click();
  await expect(page.getByRole("button", { name: "Dictate" })).toBeVisible();
});

test("interview: without speech support there is no microphone button, and typing still works", async ({ page, request }) => {
  test.setTimeout(600_000);
  const { ids, jobId } = await screenedJob(request);
  const created = await request.post(`${API}/api/interviews`, { data: { candidate_id: ids.get(AARAV.email)!, job_id: jobId }, timeout: 180_000 });
  const interviewId = (await created.json()).id;

  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).SpeechRecognition;
    delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
  });
  await page.goto(`/interview/${interviewId}`);
  await expect(page.getByRole("button", { name: "Send answer" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Dictate/ })).toHaveCount(0);
  await page.getByLabel("Your answer").fill("I typed this.");
  await expect(page.getByRole("button", { name: "Send answer" })).toBeEnabled();
});

test("compare and interview look right in dark mode and at phone width", async ({ page, request }) => {
  test.setTimeout(900_000);
  const { ids, jobId } = await screenedJob(request);
  await panelViaApi(request, jobId, 3);
  const matches = (await (await request.get(`${API}/api/jobs/${jobId}/matches`)).json()) as { id: number }[];
  const created = await request.post(`${API}/api/interviews`, { data: { candidate_id: ids.get(AARAV.email)!, job_id: jobId }, timeout: 180_000 });
  const interviewId = (await created.json()).id;

  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(`/compare?job=${jobId}&ids=${matches.slice(0, 3).map((m) => m.id).join(",")}`);
  await expect(page.getByRole("region", { name: "Score comparison" })).toBeVisible();
  await shot(page, "compare-bars-dark");
  await page.getByRole("region", { name: "Score comparison" }).getByRole("button", { name: "Radar" }).click();
  await shot(page, "compare-radar-dark");

  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of [`/compare?job=${jobId}&ids=${matches.slice(0, 3).map((m) => m.id).join(",")}`, `/interview/${interviewId}`]) {
    await page.goto(path);
    await expect(page.getByRole("heading").first()).toBeVisible();
    await page.waitForTimeout(500);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow, `${path} scrolls horizontally on a phone`).toBe(false);
  }
  await shot(page, "interview-mobile-dark");
});

test("unknown interview shows a friendly error", async ({ page }) => {
  await page.goto("/interview/999999");
  await expect(page.getByText("Interview not found")).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});
