"use client";

import { useState } from "react";
import { BookOpen, ClipboardCopy, Clock, Flag, Loader2, RotateCw, Route, Target } from "lucide-react";
import { toast } from "sonner";

import { ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { postJson } from "@/lib/api";
import type { Match, Roadmap } from "@/lib/types";
import { useFetch } from "@/lib/use-fetch";
import { cn } from "@/lib/utils";

function asText(roadmap: Roadmap): string {
  const steps = roadmap.steps.map((s, i) =>
    [
      `${i + 1}. ${s.skill} (${s.weeks} week${s.weeks === 1 ? "" : "s"})`,
      `   Why: ${s.why}`,
      ...s.actions.map((a) => `   - ${a}`),
      `   Project: ${s.practice_project}`,
      `   Goal: ${s.milestone}`,
    ].join("\n"),
  );
  return `${roadmap.summary}\n\nAbout ${roadmap.total_weeks} weeks of part-time study in total.\n\n${steps.join("\n\n")}`;
}

/** The Skill-Gap Coach: a study plan for the skills this candidate did not show for the job. */
export function RoadmapSection({ match }: { match: Match }) {
  const saved = useFetch<Roadmap | null>(`/api/matches/${match.id}/coach`);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const { update } = saved;

  const gaps = match.skill_details.filter((s) => s.status !== "demonstrated").length;

  async function make() {
    setBusy(true);
    setNotice(null);
    try {
      const roadmap = await postJson<Roadmap>(`/api/matches/${match.id}/coach`);
      update(() => roadmap);
    } catch (err) {
      setNotice((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const roadmap = saved.state.status === "ready" ? saved.state.data : null;

  return (
    <section className="space-y-3 rounded-xl border p-4" aria-label="Learning roadmap">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 font-medium">
            <Route className="size-4 text-primary" /> Skill-Gap Coach
          </h3>
          <p className="max-w-lg text-sm text-muted-foreground">
            A study plan for the {gaps} skill{gaps === 1 ? "" : "s"} not shown in real work. Share it with candidates you don&apos;t move forward.
          </p>
        </div>
        {roadmap ? (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                await navigator.clipboard.writeText(asText(roadmap));
                toast.success("Roadmap copied");
              }}
            >
              <ClipboardCopy /> Copy
            </Button>
            <Button size="sm" variant="outline" onClick={make} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <RotateCw />} Redo
            </Button>
          </div>
        ) : (
          saved.state.status === "ready" && (
            <Button onClick={make} disabled={busy || gaps === 0}>
              {busy ? <Loader2 className="animate-spin" /> : <BookOpen />} {busy ? "Planning…" : "Create roadmap"}
            </Button>
          )
        )}
      </div>

      {gaps === 0 && !roadmap && <p className="text-sm text-muted-foreground">This candidate showed every skill the job asks for, so there is nothing to coach.</p>}
      {notice && (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {notice}
        </p>
      )}
      {saved.state.status === "loading" && <Skeleton className="h-24 rounded-lg" />}
      {saved.state.status === "error" && <ErrorState message={saved.state.message} onRetry={saved.reload} />}

      {roadmap && (
        <div className="space-y-4">
          <p className="text-sm leading-relaxed">{roadmap.summary}</p>
          <p className="flex items-center gap-1.5 text-sm">
            <Clock className="size-4 text-muted-foreground" />
            <span className="font-semibold tabular-nums">{roadmap.total_weeks} weeks</span>
            <span className="text-muted-foreground">of part-time study in total</span>
          </p>
          <ol className="space-y-3">
            {roadmap.steps.map((step, i) => (
              <li key={step.skill} className="space-y-2 rounded-lg border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="flex items-center gap-2 font-medium">
                    <span className="flex size-6 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{i + 1}</span>
                    {step.skill}
                  </p>
                  <div className="flex items-center gap-1.5">
                    <Badge variant={step.priority === "high" ? "default" : "secondary"}>{step.priority === "high" ? "Required" : "Nice to have"}</Badge>
                    <Badge variant="outline" className="tabular-nums">{step.weeks} wk</Badge>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">{step.why}</p>
                <ul className="list-disc space-y-0.5 pl-5 text-sm">
                  {step.actions.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
                <p className="flex items-start gap-1.5 text-sm">
                  <Target className="mt-0.5 size-3.5 shrink-0 text-primary" /> <span><span className="font-medium">Project:</span> {step.practice_project}</span>
                </p>
                <p className="flex items-start gap-1.5 text-sm">
                  <Flag className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" /> <span><span className="font-medium">You&apos;re there when:</span> {step.milestone}</span>
                </p>
                {step.resources.length > 0 && (
                  <div className={cn("flex flex-wrap gap-1.5 pt-1")}>
                    {step.resources.map((r) => (
                      <span key={r.title} title={`Search for: ${r.search_terms}`} className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                        {r.title}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ol>
          <p className="text-xs text-muted-foreground">Resources are named in general terms with no links, so nothing can point to a page that doesn&apos;t exist. Every skill gap has a step, and the total is added up by code.</p>
        </div>
      )}
    </section>
  );
}
