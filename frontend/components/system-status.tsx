"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, CircleAlert, Loader2, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch, type Health } from "@/lib/api";

type State =
  | { kind: "loading" }
  | { kind: "ready"; health: Health }
  | { kind: "error"; message: string };

export function SystemStatus() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    apiFetch<Health>("/health")
      .then((health) => !cancelled && setState({ kind: "ready", health }))
      .catch((err: Error) => !cancelled && setState({ kind: "error", message: err.message }));
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = () => {
    setState({ kind: "loading" });
    setAttempt((n) => n + 1);
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>System status</CardTitle>
        <CardDescription>Live check of the backend, database and LLM settings.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {state.kind === "loading" && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Contacting backend…
          </p>
        )}

        {state.kind === "error" && (
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-sm text-destructive">
              <CircleAlert className="size-4 shrink-0" /> {state.message}
            </p>
            <Button variant="outline" size="sm" onClick={retry}>
              <RefreshCw className="size-4" /> Retry
            </Button>
          </div>
        )}

        {state.kind === "ready" && (
          <dl className="space-y-3 text-sm">
            <Row label="Backend" ok={state.health.status === "ok"} />
            <Row label="Database" ok={state.health.database === "ok"} />
            <Row
              label="LLM API key"
              ok={state.health.llm.api_key_configured}
              failText="Not set. Add GROQ_API_KEY to .env"
            />
            <div className="flex justify-between gap-4 border-t pt-3">
              <dt className="text-muted-foreground">Provider</dt>
              <dd className="truncate font-mono text-xs">{state.health.llm.base_url}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Models</dt>
              <dd className="flex flex-wrap justify-end gap-1">
                <Badge variant="secondary">{state.health.llm.model_large}</Badge>
                <Badge variant="secondary">{state.health.llm.model_small}</Badge>
              </dd>
            </div>
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

function Row({ label, ok, failText }: { label: string; ok: boolean; failText?: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex items-center gap-1.5">
        {ok ? (
          <>
            <CheckCircle2 className="size-4 text-emerald-500" /> OK
          </>
        ) : (
          <>
            <CircleAlert className="size-4 text-amber-500" /> {failText ?? "Problem"}
          </>
        )}
      </dd>
    </div>
  );
}
