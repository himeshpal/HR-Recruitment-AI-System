// The browser talks to FastAPI directly (including SSE streams), not through Next.js rewrites.
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export class ApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

export async function errorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json();
    if (typeof body.detail === "string") return body.detail;
    if (Array.isArray(body.detail)) {
      return "Invalid input: " + body.detail.map((d: { msg: string }) => d.msg).join("; ");
    }
  } catch {
    // body was not JSON; fall through to the generic message
  }
  return `Backend returned ${response.status}`;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, init);
  } catch (err) {
    if (init?.signal?.aborted) throw err;
    throw new ApiError(`Cannot reach the backend at ${API_URL}. Is it running?`);
  }
  if (!response.ok) throw new ApiError(await errorMessage(response), response.status);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function withJson(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

export const postJson = <T>(path: string, body?: unknown, signal?: AbortSignal) =>
  apiFetch<T>(path, { ...withJson("POST", body), signal });
export const putJson = <T>(path: string, body: unknown) => apiFetch<T>(path, withJson("PUT", body));
export const del = (path: string) => apiFetch<void>(path, { method: "DELETE" });

export type Health = {
  status: string;
  database: string;
  llm: {
    base_url: string;
    model_large: string;
    model_small: string;
    api_key_configured: boolean;
  };
};
