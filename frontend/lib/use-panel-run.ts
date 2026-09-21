"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { streamSSE } from "@/lib/sse";
import type { Panel, PanelEvent, PersonaReview } from "@/lib/types";

/**
 * Runs panel reviews over SSE and reports progress. `run` takes one endpoint or a list (run one after
 * another, so the AI provider's rate limit is respected). `live` holds the panelists that have already
 * finished for each match, so the UI can show them arriving one by one.
 */
export function usePanelRun(onPanel: (panel: Panel) => void) {
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");
  const [live, setLive] = useState<Record<number, PersonaReview[]>>({});
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const run = useCallback(
    async (paths: string | string[]) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setRunning(true);
      setStatus("Starting the panel…");
      setLive({});

      const forget = (matchId: number) =>
        setLive((prev) => {
          const next = { ...prev };
          delete next[matchId];
          return next;
        });

      let completed = 0;
      try {
        for (const path of [paths].flat()) {
          await streamSSE<PanelEvent>(
            path,
            (event) => {
              switch (event.type) {
                case "panel_start":
                  setLive((prev) => ({ ...prev, [event.match_id]: [] }));
                  setStatus(event.total > 1 ? `Reviewing candidate ${event.index} of ${event.total}…` : "The panel is reviewing…");
                  break;
                case "persona":
                  setLive((prev) => ({ ...prev, [event.match_id]: [...(prev[event.match_id] ?? []), event.review] }));
                  break;
                case "status":
                  setStatus(event.message);
                  break;
                case "panel":
                  completed += 1;
                  onPanel(event.panel);
                  forget(event.match_id);
                  break;
                case "panel_error":
                  toast.error(event.message);
                  forget(event.match_id);
                  break;
              }
            },
            controller.signal,
          );
          if (controller.signal.aborted) return;
        }
        if (completed > 0) toast.success(`Panel reviewed ${completed} candidate${completed === 1 ? "" : "s"}`);
      } catch (err) {
        toast.error((err as Error).message);
      } finally {
        if (abortRef.current === controller) setRunning(false);
      }
    },
    [onPanel],
  );

  return { running, status, live, run };
}
