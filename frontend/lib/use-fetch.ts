"use client";

import { useCallback, useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";

export type FetchState<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; message: string };

/** Load JSON from the backend with loading / error states, a reload, and local updates. */
export function useFetch<T>(path: string) {
  const [state, setState] = useState<FetchState<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    apiFetch<T>(path)
      .then((data) => !cancelled && setState({ status: "ready", data }))
      .catch((err: Error) => !cancelled && setState({ status: "error", message: err.message }));
    return () => {
      cancelled = true;
    };
  }, [path, attempt]);

  const reload = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  }, []);

  /** Change the loaded data without refetching (e.g. after an upload or delete). */
  const update = useCallback((change: (data: T) => T) => {
    setState((s) => (s.status === "ready" ? { status: "ready", data: change(s.data) } : s));
  }, []);

  return { state, reload, update };
}
