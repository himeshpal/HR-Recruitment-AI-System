"use client";

import { useState, type DragEvent } from "react";
import Link from "next/link";
import { Briefcase, Kanban, SearchCheck } from "lucide-react";
import { toast } from "sonner";

import { BlindToggle } from "@/components/blind-toggle";
import { MatchSheet } from "@/components/match-sheet";
import { ScoreRing } from "@/components/score-ring";
import { EmptyState, ErrorState } from "@/components/states";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { patchJson } from "@/lib/api";
import { displayName, useBlind } from "@/lib/blind";
import { STAGES, STAGE_LABELS, type Candidate, type Job, type Match, type Stage } from "@/lib/types";
import { useFetch } from "@/lib/use-fetch";
import { cn } from "@/lib/utils";

const COLUMN_TONE: Record<Stage, string> = {
  applied: "bg-slate-500",
  screened: "bg-indigo-500",
  interview: "bg-sky-500",
  offer: "bg-emerald-500",
  rejected: "bg-rose-500",
};

export function KanbanBoard() {
  const jobs = useFetch<Job[]>("/api/jobs");
  if (jobs.state.status === "loading") return <BoardSkeleton />;
  if (jobs.state.status === "error") return <ErrorState message={jobs.state.message} onRetry={jobs.reload} />;
  if (jobs.state.data.length === 0) {
    return (
      <EmptyState
        icon={Briefcase}
        title="Create a job first"
        description="The pipeline shows candidates with their match score for a job. Add a job, then screen your candidates."
        action={
          <Link href="/jobs/new" className={buttonVariants()}>
            New job
          </Link>
        }
      />
    );
  }
  return <Pipeline jobs={jobs.state.data} />;
}

function Pipeline({ jobs }: { jobs: Job[] }) {
  const blind = useBlind();
  const [jobId, setJobId] = useState(jobs[0].id);
  const candidates = useFetch<Candidate[]>("/api/candidates");
  const matches = useFetch<Match[]>(`/api/jobs/${jobId}/matches`);
  const [dragId, setDragId] = useState<number | null>(null);
  const [overStage, setOverStage] = useState<Stage | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);

  if (candidates.state.status === "loading" || matches.state.status === "loading") return <BoardSkeleton />;
  if (candidates.state.status === "error") return <ErrorState message={candidates.state.message} onRetry={candidates.reload} />;
  if (matches.state.status === "error") return <ErrorState message={matches.state.message} onRetry={matches.reload} />;

  const matchOf = new Map(matches.state.data.map((m) => [m.candidate.id, m]));
  const list = candidates.state.data;
  const openMatch = openId === null ? null : matches.state.data.find((m) => m.id === openId) ?? null;

  const inStage = (stage: Stage) =>
    list
      .filter((c) => c.stage === stage)
      .sort((a, b) => (matchOf.get(b.id)?.overall_score ?? -1) - (matchOf.get(a.id)?.overall_score ?? -1) || a.id - b.id);

  async function move(id: number, stage: Stage) {
    const candidate = list.find((c) => c.id === id);
    if (!candidate || candidate.stage === stage) return;
    const previous = candidate.stage;
    const apply = (to: string) => candidates.update((all) => all.map((c) => (c.id === id ? { ...c, stage: to } : c)));
    apply(stage); // optimistic: the card moves immediately
    try {
      await patchJson(`/api/candidates/${id}/stage`, { stage });
    } catch (err) {
      apply(previous);
      toast.error(`Could not move ${displayName(candidate, blind)}: ${(err as Error).message}`);
    }
  }

  function onDrop(event: DragEvent, stage: Stage) {
    event.preventDefault();
    const id = Number(event.dataTransfer.getData("text/plain"));
    setDragId(null);
    setOverStage(null);
    if (Number.isInteger(id)) void move(id, stage);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex min-w-0 max-w-full items-center gap-2 text-sm">
          <span className="shrink-0 text-muted-foreground">Match score for</span>
          <select
            value={jobId}
            onChange={(e) => setJobId(Number(e.target.value))}
            className="h-8 min-w-0 max-w-[55vw] truncate rounded-lg border bg-background px-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:max-w-xs"
          >
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.title}
              </option>
            ))}
          </select>
        </label>
        <BlindToggle />
      </div>

      {list.length === 0 ? (
        <EmptyState
          icon={Kanban}
          title="No candidates in the pipeline"
          description="Upload resumes and they appear in the Applied column."
          action={
            <Link href="/candidates" className={buttonVariants()}>
              Upload resumes
            </Link>
          }
        />
      ) : (
        <div className="relative -mx-4 overflow-x-auto px-4 pb-2 md:mx-0 md:px-0">
          <div className="grid min-w-[1100px] grid-cols-5 gap-3">
            {STAGES.map((stage) => {
              const cards = inStage(stage);
              return (
                <section
                  key={stage}
                  aria-label={`${STAGE_LABELS[stage]} column`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setOverStage(stage);
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverStage(null);
                  }}
                  onDrop={(e) => onDrop(e, stage)}
                  className={cn(
                    "flex min-h-[320px] flex-col gap-2 rounded-xl border bg-muted/30 p-2.5 transition-colors",
                    overStage === stage && dragId !== null && "border-primary bg-primary/5",
                  )}
                >
                  <header className="flex items-center justify-between px-1 py-0.5">
                    <h2 className="flex items-center gap-2 text-sm font-semibold">
                      <span className={cn("size-2 rounded-full", COLUMN_TONE[stage])} />
                      {STAGE_LABELS[stage]}
                    </h2>
                    <span className="rounded-full bg-background px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">{cards.length}</span>
                  </header>
                  {cards.length === 0 && (
                    <p className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">Drop candidates here</p>
                  )}
                  {cards.map((c) => (
                    <PipelineCard
                      key={c.id}
                      candidate={c}
                      match={matchOf.get(c.id)}
                      blind={blind}
                      dragging={dragId === c.id}
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", String(c.id));
                        e.dataTransfer.effectAllowed = "move";
                        setDragId(c.id);
                      }}
                      onDragEnd={() => {
                        setDragId(null);
                        setOverStage(null);
                      }}
                      onMove={(to) => void move(c.id, to)}
                      onOpen={() => setOpenId(matchOf.get(c.id)?.id ?? null)}
                    />
                  ))}
                </section>
              );
            })}
          </div>
        </div>
      )}

      <MatchSheet match={openMatch} blind={blind} onClose={() => setOpenId(null)} />
    </div>
  );
}

function PipelineCard({
  candidate, match, blind, dragging, onDragStart, onDragEnd, onMove, onOpen,
}: {
  candidate: Candidate;
  match: Match | undefined;
  blind: boolean;
  dragging: boolean;
  onDragStart: (e: DragEvent) => void;
  onDragEnd: () => void;
  onMove: (stage: Stage) => void;
  onOpen: () => void;
}) {
  const name = displayName(candidate, blind);
  return (
    <article
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      aria-label={`${name}, ${STAGE_LABELS[candidate.stage as Stage] ?? candidate.stage}`}
      className={cn(
        "cursor-grab space-y-2 rounded-lg bg-card p-3 ring-1 ring-foreground/10 transition-all active:cursor-grabbing",
        dragging ? "opacity-40" : "hover:shadow-md",
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{name}</p>
          <p className="truncate text-xs text-muted-foreground">{candidate.profile?.headline ?? "No headline"}</p>
        </div>
        {match && <ScoreRing score={match.overall_score} size={38} />}
      </div>
      <div className="flex items-center justify-between gap-2">
        <label className="sr-only" htmlFor={`move-${candidate.id}`}>
          Move {name} to another stage
        </label>
        <select
          id={`move-${candidate.id}`}
          value={candidate.stage}
          onChange={(e) => onMove(e.target.value as Stage)}
          className="h-7 w-24 shrink-0 rounded-md border bg-background px-1.5 text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {STAGES.map((s) => (
            <option key={s} value={s}>
              {STAGE_LABELS[s]}
            </option>
          ))}
        </select>
        {match && (
          <button
            type="button"
            onClick={onOpen}
            className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-primary hover:bg-primary/10 focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <SearchCheck className="size-3.5" /> Why?
          </button>
        )}
      </div>
    </article>
  );
}

function BoardSkeleton() {
  return (
    <div className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-5" aria-busy="true" aria-label="Loading pipeline">
      {STAGES.map((s) => (
        <Skeleton key={s} className="h-72 rounded-xl" />
      ))}
    </div>
  );
}
