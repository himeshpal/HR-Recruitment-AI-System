import { API_URL, ApiError, errorMessage } from "@/lib/api";

export type SSEEvent =
  | { type: "token"; text: string }
  | { type: "done"; markdown: string }
  | { type: "error"; message: string };

/**
 * POST to an SSE endpoint and call `onEvent` for every `data:` message as it arrives.
 * (EventSource only supports GET, so this reads the fetch body stream directly.)
 * Resolves quietly if `signal` aborts.
 */
export async function streamSSE(
  path: string,
  onEvent: (event: SSEEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  try {
    const response = await fetch(`${API_URL}${path}`, { method: "POST", signal });
    if (!response.ok || !response.body) {
      throw new ApiError(await errorMessage(response), response.status);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const messages = buffer.split("\n\n");
      buffer = messages.pop() ?? "";
      for (const message of messages) {
        const line = message.split("\n").find((l) => l.startsWith("data: "));
        if (line) onEvent(JSON.parse(line.slice(6)) as SSEEvent);
      }
    }
  } catch (err) {
    if (signal?.aborted) return;
    if (err instanceof ApiError) throw err;
    throw new ApiError(`Cannot reach the backend at ${API_URL}. Is it running?`);
  }
}
