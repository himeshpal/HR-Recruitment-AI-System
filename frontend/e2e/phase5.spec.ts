import { expect, test, type Page } from "@playwright/test";

import { API, ensureCandidates, freshJob, screenViaApi, shot } from "./helpers";

// Scripted events let us check the running / done / failed states of the graph deterministically (a real call is over
// too quickly to catch mid-flight). The real end-to-end path is checked against the live backend below and in
// backend/scripts/phase5_check.py.

const sse = (...events: object[]) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
const at = () => new Date().toISOString();

async function scriptStream(page: Page, ...events: object[]) {
  await page.route("**/api/agents/stream*", (route) =>
    route.fulfill({ status: 200, headers: { "content-type": "text/event-stream", "cache-control": "no-cache", "access-control-allow-origin": "*" }, body: sse(...events) }),
  );
}

test("live agents: the graph shows every agent, idle until something really happens", async ({ page }) => {
  await page.goto("/agents");
  await expect(page.getByTestId("connection")).toHaveAttribute("data-connected", "true", { timeout: 15_000 });
  for (const id of ["jd_generator", "resume_parser", "matcher", "panel_tech_lead", "panel_moderator", "interview_evaluate", "outreach", "skill_coach", "qa_bot", "ask_hr"]) {
    await expect(page.getByTestId(`node-${id}`)).toBeVisible();
  }
  // The database already holds plenty of agent calls from earlier, but they must not light the graph on arrival.
  await expect(page.getByTestId("node-matcher")).toHaveAttribute("data-state", "idle");
  await expect(page.getByText("No agent is working right now")).toBeVisible();
  // Code-only steps say so instead of pretending to be AI.
  await expect(page.getByTestId("node-bias_shield")).toContainText("Runs in code");
  await expect(page.getByTestId("node-bias_shield")).toContainText("No AI");
  await shot(page, "agents-idle-light");
});

test("live agents: a start event lights the node as working, a finish shows the agent's words, a failure is red", async ({ page }) => {
  const base = { model: "openai/gpt-oss-120b" };
  await scriptStream(
    page,
    { seq: 900001, type: "start", call_id: "m1", agent: "matcher", at: at(), ...base },
    { seq: 900002, type: "start", call_id: "p1", agent: "panel_tech_lead", at: at(), ...base },
    { seq: 900003, type: "finish", call_id: "p1", agent: "panel_tech_lead", at: at(), tokens: 812, latency_ms: 2300, cached: false, preview: "Strong Python and FastAPI depth, light on cloud.", ...base },
    { seq: 900004, type: "start", call_id: "q1", agent: "qa_bot", at: at(), ...base },
    { seq: 900005, type: "error", call_id: "q1", agent: "qa_bot", at: at(), message: "Rate limit reached", ...base },
    { seq: 900006, type: "finish", call_id: "r1", agent: "resume_parser", at: at(), tokens: 400, latency_ms: 900, cached: false, preview: null, ...base },
    { seq: 900007, type: "finish", call_id: "cache-1", agent: "ask_hr", at: at(), tokens: 0, latency_ms: 0, cached: true, preview: "Candidates with Python", ...base },
  );
  await page.goto("/agents");

  await expect(page.getByTestId("node-matcher")).toHaveAttribute("data-state", "running");
  await expect(page.getByTestId("node-matcher")).toContainText("Working");
  await expect(page.getByText("1 agent call running")).toBeVisible();

  await expect(page.getByTestId("node-panel_tech_lead")).toHaveAttribute("data-state", "done");
  await expect(page.getByTestId("node-panel_tech_lead")).toContainText("1 call · 2.3s");
  await expect(page.getByTestId("node-qa_bot")).toHaveAttribute("data-state", "error");
  await expect(page.getByTestId("node-qa_bot")).toContainText("Failed");
  await expect(page.getByTestId("node-ask_hr")).toContainText("cached");

  const feed = page.getByTestId("feed");
  await expect(feed.locator('[data-agent="panel_tech_lead"]').first()).toContainText("Strong Python and FastAPI depth");
  await expect(feed.locator('[data-agent="panel_tech_lead"]').first()).toContainText("2.3s · 812 tokens");
  await expect(feed.locator('[data-agent="qa_bot"]').first()).toContainText("Rate limit reached");
  await expect(feed.locator('[data-agent="ask_hr"]').first()).toContainText("From cache");
  // The Resume Parser reads raw resumes, so its words are never shown.
  await expect(feed.locator('[data-agent="resume_parser"]').first()).toContainText("Output not shown");
  await shot(page, "agents-live-light");
});

test("live agents: a real question sent to the backend appears on the graph and in the feed", async ({ page, request }) => {
  test.setTimeout(120_000);
  await page.goto("/agents");
  await expect(page.getByTestId("connection")).toHaveAttribute("data-connected", "true", { timeout: 15_000 });
  await expect(page.getByTestId("node-ask_hr")).toHaveAttribute("data-state", "idle");

  const question = `Which candidates know Python? (browser test ${Date.now()})`;
  const response = await request.post(`${API}/api/ask`, { data: { question }, timeout: 90_000 });
  expect(response.ok()).toBeTruthy();

  await expect(page.getByTestId("node-ask_hr")).toHaveAttribute("data-state", "done", { timeout: 30_000 });
  const item = page.getByTestId("feed").locator('[data-agent="ask_hr"]').first();
  await expect(item).toBeVisible();
  await expect(item).toContainText(/tokens/); // a real, uncached call reports its cost
  await expect(page.getByRole("region", { name: "Agent statistics" })).toContainText("Ask-HR");
});

test("the Send a test question button makes the graph react", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/agents");
  await expect(page.getByTestId("connection")).toHaveAttribute("data-connected", "true", { timeout: 15_000 });
  await page.getByRole("button", { name: "Send a test question" }).click();
  await expect(page.getByTestId("node-ask_hr")).toHaveAttribute("data-state", "done", { timeout: 60_000 });
});

test("dashboard: the funnel matches the data and the activity timeline lists real calls", async ({ page, request }) => {
  await ensureCandidates(request);
  const data = await (await request.get(`${API}/api/dashboard`)).json();
  const stats = await (await request.get(`${API}/api/agents/stats`)).json();

  await page.goto("/");
  for (const step of data.funnel) {
    await expect(page.getByTestId(`funnel-${step.key}`)).toContainText(String(step.count));
    await expect(page.getByTestId(`funnel-${step.key}`)).toContainText(step.label);
  }
  await expect(page.getByText("Hiring funnel")).toBeVisible();
  await expect(page.getByText("Agent calls", { exact: true })).toBeVisible();
  await expect(page.getByText(stats.calls.toString(), { exact: true }).first()).toBeVisible();
  const rows = page.getByTestId("activity").getByRole("listitem");
  expect(await rows.count()).toBeGreaterThan(0);
  await shot(page, "dashboard-light");
});

test("evaluation: shows the saved check results, phase by phase", async ({ page, request }) => {
  const data = await (await request.get(`${API}/api/evaluation`)).json();
  expect(data.phases.length).toBeGreaterThanOrEqual(5);

  await page.goto("/evaluation");
  await expect(page.getByTestId("eval-total")).toHaveText(`${data.passed} of ${data.total} real-AI checks passing`);
  for (const phase of data.phases) {
    await expect(page.getByTestId(`phase-${phase.key}`)).toContainText(`${phase.passed}/${phase.total}`);
  }
  const first = page.getByTestId("phase-phase5");
  await first.getByText("Show checks").click();
  await expect(first.getByText("Every blind PDF says")).toBeVisible();
  await expect(page.getByText("What this does not prove")).toBeVisible();
  await shot(page, "evaluation-light");
});

test("candidate report: the PDF button follows blind mode, and the file is a real PDF", async ({ page, request }) => {
  test.setTimeout(240_000);
  await ensureCandidates(request);
  const jobId = await freshJob(request);
  await screenViaApi(request, jobId);

  await page.goto(`/screening/${jobId}`);
  await page.getByRole("button", { name: /rank 1,/ }).click();
  const sheet = page.getByRole("dialog");
  const link = sheet.getByRole("link", { name: "Download report" });
  await expect(link).toHaveAttribute("href", /report\.pdf\?blind=true$/); // blind mode is on by default
  const pdf = await request.get((await link.getAttribute("href"))!);
  expect(pdf.ok()).toBeTruthy();
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");

  await page.keyboard.press("Escape");
  await page.getByRole("switch", { name: /Blind mode/ }).click();
  await page.getByRole("button", { name: /rank 1,/ }).click();
  await expect(sheet.getByRole("link", { name: "Download report" })).toHaveAttribute("href", /report\.pdf\?blind=false$/);
  await page.getByRole("switch", { name: /Blind mode/ }).click().catch(() => undefined);
});

test("navigation reaches the new pages", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Main" }).first().getByRole("link", { name: "Live agents" }).click();
  await expect(page).toHaveURL(/\/agents$/);
  await page.getByRole("navigation", { name: "Main" }).first().getByRole("link", { name: "Evaluation" }).click();
  await expect(page).toHaveURL(/\/evaluation$/);
  await expect(page.getByRole("heading", { name: "Evaluation" })).toBeVisible();
});

// ---------------------------------------------------------------- dark mode and phone width

async function noSidewaysScroll(page: Page, what: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${what} scrolls sideways`).toBeLessThanOrEqual(1);
}

test("dark mode: dashboard, live agents and evaluation are readable, with no hydration mismatch from starting in dark mode", async ({ page }) => {
  // Unlike the plain "no console errors" test, colorScheme is set to dark BEFORE the first navigation, so the
  // very first server-rendered HTML disagrees with what the client immediately knows about the OS/browser
  // theme. This is exactly the situation that once made React Flow's colorMode prop hydrate mismatched
  // (server "light", client "dark") on the very first visit to /agents.
  const problems: string[] = [];
  page.on("console", (m) => ["error", "warning"].includes(m.type()) && problems.push(`[${m.type()}] ${m.text().slice(0, 300)}`));
  page.on("pageerror", (e) => problems.push(`[pageerror] ${String(e).slice(0, 300)}`));
  await page.emulateMedia({ colorScheme: "dark" });
  await scriptStream(page, { seq: 910001, type: "start", call_id: "d1", agent: "matcher", at: at(), model: "m" }, { seq: 910002, type: "finish", call_id: "d2", agent: "panel_moderator", at: at(), model: "m", tokens: 500, latency_ms: 1800, cached: false, preview: "The panel mostly agrees." });
  await page.goto("/");
  await expect(page.getByText("Hiring funnel")).toBeVisible();
  await shot(page, "dashboard-dark");
  await page.goto("/agents");
  await expect(page.getByTestId("node-matcher")).toHaveAttribute("data-state", "running");
  await shot(page, "agents-live-dark");
  await page.goto("/evaluation");
  await expect(page.getByTestId("eval-total")).toBeVisible();
  await shot(page, "evaluation-dark");
  expect(problems).toEqual([]);
});

test("phone width: dashboard, live agents and evaluation do not scroll sideways, and the menu still fits", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  for (const path of ["/", "/agents", "/evaluation"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.waitForTimeout(600);
    await noSidewaysScroll(page, path);
    // The menu is a scrollable strip: the last item is reachable, and the header itself never grows sideways.
    const last = page.getByRole("banner").getByRole("link", { name: "Evaluation" });
    await last.scrollIntoViewIfNeeded();
    const box = await last.boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 390, "the last menu item cannot be reached").toBeTruthy();
    await noSidewaysScroll(page, `${path} after scrolling the menu`);
    await shot(page, `phone-${path === "/" ? "dashboard" : path.slice(1)}`);
  }
});

test("the new pages log no console errors or warnings (duplicate keys, licence notices, failed scripts)", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (m) => ["error", "warning"].includes(m.type()) && problems.push(`[${m.type()}] ${m.text().slice(0, 200)}`));
  page.on("pageerror", (e) => problems.push(`[pageerror] ${String(e).slice(0, 200)}`));
  for (const path of ["/", "/agents", "/evaluation"]) {
    await page.goto(path);
    await page.waitForTimeout(2500);
  }
  expect(problems).toEqual([]);
});
