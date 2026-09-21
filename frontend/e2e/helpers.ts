import fs from "node:fs";
import path from "node:path";

import { expect, type APIRequestContext, type Page } from "@playwright/test";

export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
export const BACKEND = path.resolve(__dirname, "../../backend/data");
export const SHOTS = process.env.SHOTS_DIR; // set it to also save screenshots for visual review

export type Truth = { file: string; name: string; email: string };
export const truth: Truth[] = JSON.parse(fs.readFileSync(path.join(BACKEND, "sample_resumes/ground_truth.json"), "utf8"));
export const backendJob = JSON.parse(fs.readFileSync(path.join(BACKEND, "golden/jobs.json"), "utf8")).find(
  (j: { key: string }) => j.key === "backend",
) as { title: string; markdown: string };
export const AARAV = truth.find((t) => t.file.includes("aarav"))!;

export async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.waitForTimeout(900); // let springs and count-ups settle
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

/** Make sure all 10 sample candidates exist (a phase 1 test deletes some); returns email -> id. */
export async function ensureCandidates(request: APIRequestContext): Promise<Map<string, number>> {
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
 * validation scripts, so the AI answers are already cached and the test is fast and free.
 */
export async function freshJob(request: APIRequestContext): Promise<number> {
  for (const job of (await (await request.get(`${API}/api/jobs`)).json()) as { id: number; title: string }[]) {
    if (job.title === backendJob.title) await request.delete(`${API}/api/jobs/${job.id}`);
  }
  const created = await (await request.post(`${API}/api/jobs`, { data: { title: backendJob.title, brief: "backend" } })).json();
  await request.put(`${API}/api/jobs/${created.id}`, { data: { markdown: backendJob.markdown } });
  return created.id;
}

/** Run an SSE endpoint to completion and return its raw text. */
async function runStream(request: APIRequestContext, path: string): Promise<string> {
  const response = await request.post(`${API}${path}`, { timeout: 900_000 });
  expect(response.ok(), path).toBeTruthy();
  return response.text();
}

export async function screenViaApi(request: APIRequestContext, jobId: number) {
  expect(await runStream(request, `/api/jobs/${jobId}/screen`)).toContain('"type": "done"');
}

export async function panelViaApi(request: APIRequestContext, jobId: number, top = 3) {
  const text = await runStream(request, `/api/jobs/${jobId}/panel?top=${top}`);
  expect(text).toContain('"type": "done"');
  expect(text).not.toContain("panel_error");
}
