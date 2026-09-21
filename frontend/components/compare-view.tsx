"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Gavel, GitCompareArrows, Loader2 } from "lucide-react";

import { BlindToggle } from "@/components/blind-toggle";
import { CompareChart, type ChartView, type Dimension } from "@/components/compare-chart";
import { LivePanel } from "@/components/panel-view";
import { ScoreRing } from "@/components/score-ring";
import { SkillChip } from "@/components/skill-chip";
import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { VerdictBadge } from "@/components/verdict-badge";
import { apiFetch } from "@/lib/api";
import { displayName, useBlind } from "@/lib/blind";
import type { Job, Match, Panel } from "@/lib/types";
import { useFetch } from "@/lib/use-fetch";
import { usePanelRun } from "@/lib/use-panel-run";
import { cn } from "@/lib/utils";

const PANEL_ORDER = ["tech_lead", "hr_manager", "hiring_manager"] as const;
const PANEL_LABEL = { tech_lead: "Tech Lead", hr_manager: "HR Manager", hiring_manager: "Hiring Manager" } as const;

export function CompareView({ jobId, matchIds }: { jobId: number; matchIds: number[] }) {
  const job = useFetch<Job>(`/api/jobs/${jobId}`);
  const matches = useFetch<Match[]>(`/api/jobs/${jobId}/matches`);

  if (job.state.status === "error") return <ErrorState message={job.state.message} onRetry={job.reload} />;
  if (matches.state.status === "error") return <ErrorState message={matches.state.message} onRetry={matches.reload} />;
  if (job.state.status !== "ready" || matches.state.status !== "ready") return <Skeleton className="h-96 rounded-xl" />;

  const all = matches.state.data;
  const chosen = matchIds.map((id) => all.find((m) => m.id === id)).filter((m): m is Match => Boolean(m));
  if (chosen.length < 2) {
    return (
      <EmptyState
        icon={GitCompareArrows}
        title="Pick two or three candidates to compare"
        description="On the screening board, tick the boxes next to the candidates you want to compare, then press Compare."
        action={
          <Link href={`/screening/${jobId}`} className={buttonVariants()}>
            Back to screening
          </Link>
        }
      />
    );
  }
  return <Comparison job={job.state.data} chosen={chosen.slice(0, 3)} />;
}

/** The saved panel for each chosen match, or null where none has been run. */
function usePanels(ids: number[]) {
  const key = ids.join(",");
  const [state, setState] = useState<{ key: string; panels: (Panel | null)[] } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const list = key.split(",").map(Number);
    Promise.all(list.map((id) => apiFetch<Panel | null>(`/api/matches/${id}/panel`).catch(() => null))).then((panels) => {
      if (!cancelled) setState({ key, panels });
    });
    return () => {
      cancelled = true;
    };
  }, [key, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { panels: state?.key === key ? state.panels : null, reload };
}

function Comparison({ job, chosen }: { job: Job; chosen: Match[] }) {
  const blind = useBlind();
  const [view, setView] = useState<ChartView>("bars");
  const ids = chosen.map((m) => m.id);
  const { panels, reload } = usePanels(ids);
  const onPanel = useCallback(() => reload(), [reload]);
  const panelRun = usePanelRun(onPanel);

  const names = chosen.map((m) => displayName(m.candidate, blind));
  const series = chosen.map((m, i) => ({ id: m.id, label: names[i] }));
  const missing = panels ? chosen.filter((_, i) => !panels[i]) : [];
  const allReviewed = panels !== null && missing.length === 0;

  const dims: Dimension[] = useMemo(() => {
    const parts: [string, string, keyof Match["breakdown"]][] = [
      ["skills", "Skills coverage", "skills"],
      ["semantic", "Semantic fit", "semantic"],
      ["experience", "Experience", "experience"],
      ["ai_review", "AI review", "ai_review"],
    ];
    const result: Dimension[] = parts.map(([key, label, part]) => ({ key, label, values: chosen.map((m) => m.breakdown[part] ?? null) }));
    if (panels && panels.every(Boolean)) {
      for (const persona of PANEL_ORDER) {
        result.push({
          key: persona,
          label: PANEL_LABEL[persona],
          values: panels.map((p) => p!.reviews.find((r) => r.persona === persona)?.score ?? null),
        });
      }
    }
    return result;
  }, [chosen, panels]);

  const runMissing = () => panelRun.run(missing.map((m) => `/api/matches/${m.id}/panel`));
  const cols = chosen.length === 2 ? "md:grid-cols-2" : "md:grid-cols-3";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <Link href={`/screening/${job.id}`} className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" /> Back to screening
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">Compare candidates</h1>
          <p className="text-sm text-muted-foreground">
            For <span className="font-medium text-foreground">{job.title}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <BlindToggle />
          {panels && missing.length > 0 && (
            <Button onClick={runMissing} disabled={panelRun.running}>
              {panelRun.running ? <Loader2 className="animate-spin" /> : <Gavel />}
              Run panel for {missing.length === chosen.length ? "these candidates" : `${missing.length} more`}
            </Button>
          )}
        </div>
      </div>

      {/* Candidates side by side */}
      <div className={cn("grid gap-4", cols)}>
        {chosen.map((m, i) => (
          <section key={m.id} className="space-y-3 rounded-xl border bg-card p-4" aria-label={names[i]}>
            <div className="flex items-center gap-3">
              <ScoreRing score={m.overall_score} size={56} />
              <div className="min-w-0">
                <p className="truncate font-semibold">{names[i]}</p>
                <p className="truncate text-sm text-muted-foreground">{m.candidate.headline ?? "Candidate"}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {panels?.[i] ? <VerdictBadge verdict={panels[i]!.verdict} /> : <Badge variant="outline">No panel yet</Badge>}
                  <span className="text-xs text-muted-foreground">{m.candidate.years} yrs</span>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {m.skill_details.filter((s) => s.kind === "must").map((s) => (
                <SkillChip key={s.skill} detail={s} />
              ))}
            </div>
            <p className="text-sm text-muted-foreground">{m.summary}</p>
          </section>
        ))}
      </div>

      {panelRun.running && (
        <div className="space-y-2 rounded-xl border bg-card p-4">
          <p className="flex items-center gap-2 text-sm font-medium" role="status">
            <Loader2 className="size-4 animate-spin text-primary" /> {panelRun.status}
          </p>
          {Object.entries(panelRun.live).map(([id, reviews]) => (
            <LivePanel key={id} reviews={reviews} status="" />
          ))}
        </div>
      )}

      {/* The chart */}
      <section className="space-y-4 rounded-xl border bg-card p-4 sm:p-5" aria-label="Score comparison">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">Scores compared</h2>
          <div role="group" aria-label="Chart view" className="inline-flex rounded-lg bg-muted p-[3px]">
            {(
              [
                ["bars", "Bars"],
                ["radar", "Radar"],
                ["table", "Table"],
              ] as [ChartView, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={view === value}
                onClick={() => setView(value)}
                className={cn(
                  "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                  view === value ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <CompareChart series={series} dims={dims} view={view} />
        {panels && !allReviewed && (
          <p className="text-xs text-muted-foreground">
            The panelists&apos; scores are added once every selected candidate has had the panel review.
          </p>
        )}
      </section>

      {/* What the panel said, one panelist per row */}
      {allReviewed && (
        <section className="space-y-4" aria-label="Panel discussion">
          <h2 className="font-semibold">What the panel said</h2>
          {PANEL_ORDER.map((persona) => (
            <div key={persona} className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{PANEL_LABEL[persona]}</h3>
              <div className={cn("grid gap-3", cols)}>
                {panels!.map((panel, i) => {
                  const review = panel!.reviews.find((r) => r.persona === persona)!;
                  return (
                    <article key={chosen[i].id} className="space-y-1.5 rounded-lg border p-3 text-sm">
                      <p className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                        <span className="truncate">{names[i]}</span>
                        <span className="flex items-center gap-1.5">
                          <VerdictBadge verdict={review.stance} />
                          <span className="font-semibold tabular-nums text-foreground">{Math.round(review.score)}</span>
                        </span>
                      </p>
                      <p>{review.reasoning}</p>
                      {review.concerns.length > 0 && (
                        <p className="text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">Concerns:</span> {review.concerns.join("; ")}
                        </p>
                      )}
                    </article>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Moderator</h3>
            <div className={cn("grid gap-3", cols)}>
              {panels!.map((panel, i) => (
                <article key={chosen[i].id} className="space-y-1.5 rounded-lg border bg-muted/30 p-3 text-sm">
                  <p className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span className="truncate">{names[i]}</span>
                    <span className="flex items-center gap-1.5">
                      <VerdictBadge verdict={panel!.verdict} />
                      <span className="font-semibold tabular-nums text-foreground">{Math.round(panel!.consensus_score)}</span>
                    </span>
                  </p>
                  <p>{panel!.summary}</p>
                  {panel!.disagreements.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">Difference:</span> {panel!.disagreements[0].topic}. {panel!.disagreements[0].detail}
                    </p>
                  )}
                  <p className="text-xs">
                    <span className="font-medium">Next step:</span> {panel!.next_step}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Strengths and gaps */}
      <section className="space-y-3" aria-label="Strengths and gaps">
        <h2 className="font-semibold">Strengths and gaps</h2>
        <div className={cn("grid gap-3", cols)}>
          {chosen.map((m, i) => (
            <article key={m.id} className="space-y-2 rounded-lg border p-3 text-sm">
              <p className="text-xs font-medium text-muted-foreground">{names[i]}</p>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">Strengths</p>
                <ul className="list-disc pl-4">{m.strengths.map((s) => <li key={s}>{s}</li>)}</ul>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">Gaps</p>
                <ul className="list-disc pl-4">{m.gaps.length ? m.gaps.map((g) => <li key={g}>{g}</li>) : <li className="list-none text-muted-foreground">None noted.</li>}</ul>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
