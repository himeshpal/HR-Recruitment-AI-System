"use client";

import { Check, FlaskConical, ShieldCheck, X } from "lucide-react";

import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { EvalPhase, Evaluation } from "@/lib/agents";
import { parseApiDate } from "@/lib/format";
import { useFetch } from "@/lib/use-fetch";
import { cn } from "@/lib/utils";

const COMMANDS: Record<string, string> = {
  phase1: "phase1_check.py",
  phase2: "phase2_check.py",
  phase3: "phase3_check.py",
  phase4: "phase4_check.py",
};

export function EvaluationView() {
  const { state, reload } = useFetch<Evaluation>("/api/evaluation");

  if (state.status === "loading") return <Skeleton className="h-64 rounded-xl" />;
  if (state.status === "error") return <ErrorState message={state.message} onRetry={reload} />;
  const { phases, passed, total } = state.data;

  if (phases.length === 0) {
    return (
      <EmptyState
        icon={FlaskConical}
        title="No validation results yet"
        description="Start the backend and run the check scripts (for example  .venv\Scripts\python scripts\phase2_check.py  in the backend folder). Their results appear here."
      />
    );
  }

  const allPass = passed === total;
  return (
    <div className="space-y-6">
      <section
        className={cn("flex flex-wrap items-center gap-4 rounded-xl border p-5", allPass ? "border-emerald-500/40 bg-emerald-500/5" : "border-amber-500/40 bg-amber-500/5")}
        aria-label="Summary"
      >
        <span className={cn("flex size-12 items-center justify-center rounded-full", allPass ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-amber-500/15 text-amber-600")}>
          <ShieldCheck className="size-6" />
        </span>
        <div className="min-w-0 flex-1 basis-64">
          <p className="text-2xl font-semibold tabular-nums" data-testid="eval-total">
            {passed} of {total} real-AI checks passing
          </p>
          <p className="text-sm text-muted-foreground">
            Real AI, real database, real browser. The pass criteria were written before each first run. The failures found along the way, and how they were fixed, are recorded in PLAN.md.
          </p>
        </div>
      </section>

      <div className="space-y-3">
        {phases.map((phase) => (
          <PhaseCard key={phase.key} phase={phase} />
        ))}
      </div>

      <section className="rounded-xl border p-4 text-sm text-muted-foreground" aria-label="What this does not prove">
        <p className="mb-1 font-medium text-foreground">What this does not prove</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>The samples are small (10 resumes, a few jobs). A passing check shows the behaviour works on those cases, not on every resume.</li>
          <li>The test questions and expected answers were written by the same person who built the agents, so a shared blind spot would not show.</li>
          <li>The interview scorer was checked on synthetic and AI-written answers, never on real candidates.</li>
          <li>The full list of limitations is in PLAN.md, next to each phase.</li>
        </ul>
      </section>
    </div>
  );
}

function PhaseCard({ phase }: { phase: EvalPhase }) {
  const ok = phase.passed === phase.total;
  return (
    <details className="group rounded-xl border" data-testid={`phase-${phase.key}`}>
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 p-4 marker:hidden [&::-webkit-details-marker]:hidden">
        <span className={cn("flex size-7 items-center justify-center rounded-full", ok ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-destructive/15 text-destructive")}>
          {ok ? <Check className="size-4" /> : <X className="size-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium">{phase.title}</p>
          <p className="text-xs text-muted-foreground">
            Last run {parseApiDate(phase.ran_at).toLocaleString()}
            {COMMANDS[phase.key] && <> · <code>{COMMANDS[phase.key]}</code></>}
          </p>
        </div>
        <Badge variant={ok ? "secondary" : "destructive"} className="tabular-nums">
          {phase.passed}/{phase.total}
        </Badge>
        <span className="text-xs text-muted-foreground group-open:hidden">Show checks</span>
        <span className="hidden text-xs text-muted-foreground group-open:inline">Hide checks</span>
      </summary>
      <ul className="divide-y border-t">
        {phase.checks.map((check, i) => (
          <li key={`${i}-${check.name}`} className="flex items-start gap-3 px-4 py-2 text-sm">
            {check.passed ? (
              <Check className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="Passed" />
            ) : (
              <X className="mt-0.5 size-4 shrink-0 text-destructive" aria-label="Failed" />
            )}
            <span className="flex-1">{check.name}</span>
            {check.detail && <span className="max-w-[45%] text-right text-xs text-muted-foreground">{check.detail}</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}
