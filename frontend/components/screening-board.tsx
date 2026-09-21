"use client";

import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, FileText, Gavel, GitCompareArrows, Loader2, RotateCw, Scale, Sparkles, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { BlindToggle } from "@/components/blind-toggle";
import { LivePanel } from "@/components/panel-view";
import { MatchCard } from "@/components/match-card";
import { MatchSheet } from "@/components/match-sheet";
import { SkillLegend } from "@/components/skill-chip";
import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { displayName, useBlind } from "@/lib/blind";
import { streamSSE } from "@/lib/sse";
import type { Job, Match, Panel, ScreenEvent } from "@/lib/types";
import { useFetch } from "@/lib/use-fetch";
import { usePanelRun } from "@/lib/use-panel-run";

const byScore = (a: Match, b: Match) => b.overall_score - a.overall_score || a.id - b.id;

export function ScreeningBoard({ jobId }: { jobId: number }) {
  const job = useFetch<Job>(`/api/jobs/${jobId}`);
  const matches = useFetch<Match[]>(`/api/jobs/${jobId}/matches`);

  if (job.state.status === "error") return <ErrorState message={job.state.message} onRetry={job.reload} />;
  if (matches.state.status === "error") return <ErrorState message={matches.state.message} onRetry={matches.reload} />;
  if (job.state.status === "loading" || matches.state.status === "loading") return <BoardSkeleton />;
  return <Board job={job.state.data} initial={matches.state.data} />;
}

type Progress = { done: number; total: number };
type CandidateError = { id: number; message: string };

function Board({ job, initial }: { job: Job; initial: Match[] }) {
  const blind = useBlind();
  const [matches, setMatches] = useState<Match[]>(() => [...initial].sort(byScore));
  const [openId, setOpenId] = useState<number | null>(null);
  const [selected, setSelected] = useState<number[]>([]); // match ids picked for the Compare view
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState<Progress | null>(null);
  const [errors, setErrors] = useState<CandidateError[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  // When the panel finishes for a candidate, show their verdict on the card straight away.
  const onPanel = useCallback((panel: Panel) => {
    const summary = { verdict: panel.verdict, consensus_score: panel.consensus_score, agreement: panel.agreement };
    setMatches((prev) => prev.map((m) => (m.id === panel.match_id ? { ...m, panel: summary } : m)));
  }, []);
  const panelRun = usePanelRun(onPanel);
  const toggleSelected = (id: number) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < 3 ? [...prev, id] : prev));

  const run = useCallback(
    (force: boolean) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setRunning(true);
      setStatus("Starting…");
      setProgress(null);
      setErrors([]);

      streamSSE<ScreenEvent>(
        `/api/jobs/${job.id}/screen${force ? "?force=true" : ""}`,
        (event) => {
          switch (event.type) {
            case "status":
              setStatus(event.message);
              break;
            case "start":
              setProgress({ done: 0, total: event.total });
              if (event.total === 0) toast.info("Everyone in the pool is already screened for this job.");
              else setStatus(`Scoring ${event.total} candidate${event.total === 1 ? "" : "s"}…`);
              break;
            case "match":
              // Replace this candidate's earlier result (if any) and keep the list ranked.
              setMatches((prev) => [event.match, ...prev.filter((m) => m.candidate.id !== event.match.candidate.id)].sort(byScore));
              break;
            case "progress":
              setProgress({ done: event.done, total: event.total });
              break;
            case "candidate_error":
              setErrors((prev) => [...prev, { id: event.candidate_id, message: event.message }]);
              break;
            case "error":
              toast.error(event.message);
              break;
            case "done":
              if (event.matched > 0) toast.success(`Screened ${event.matched} candidate${event.matched === 1 ? "" : "s"}`);
              if (event.failed > 0) toast.warning(`${event.failed} candidate${event.failed === 1 ? "" : "s"} could not be scored. Run screening again to retry.`);
              break;
          }
        },
        controller.signal,
      )
        .catch((err: Error) => toast.error(err.message))
        .finally(() => {
          if (abortRef.current === controller) setRunning(false);
        });
    },
    [job.id],
  );

  const open = matches.find((m) => m.id === openId) ?? null;
  const hasDescription = Boolean(job.markdown?.trim());
  const strong = matches.filter((m) => m.overall_score >= 75).length;
  const partial = matches.filter((m) => m.overall_score >= 50 && m.overall_score < 75).length;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/screening" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" /> Screening
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">{job.title}</h1>
            <div className="flex flex-wrap items-center gap-1.5">
              {job.requirements?.must_have_skills.map((skill) => (
                <Badge key={skill} variant="secondary">
                  {skill}
                </Badge>
              ))}
              {job.requirements && job.requirements.min_years_experience > 0 && (
                <Badge variant="outline">{job.requirements.min_years_experience}+ yrs</Badge>
              )}
              <Link href={`/jobs/${job.id}`} className="text-xs text-muted-foreground underline-offset-4 hover:underline">
                Edit job
              </Link>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <BlindToggle />
            <Button variant="outline" onClick={() => run(true)} disabled={running || !hasDescription || matches.length === 0}>
              <RotateCw /> Re-score all
            </Button>
            <Button variant="outline" onClick={() => panelRun.run(`/api/jobs/${job.id}/panel?top=3`)} disabled={running || panelRun.running || matches.length === 0}>
              {panelRun.running ? <Loader2 className="animate-spin" /> : <Gavel />}
              Panel review (top 3)
            </Button>
            <Button onClick={() => run(false)} disabled={running || !hasDescription}>
              {running ? <Loader2 className="animate-spin" /> : <Sparkles />}
              Screen candidates
            </Button>
          </div>
        </div>
      </div>

      {running && (
        <div className="space-y-2 rounded-xl border bg-card p-4" role="status" aria-live="polite">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-2 font-medium">
              <Loader2 className="size-4 animate-spin text-primary" /> {status}
            </span>
            {progress && progress.total > 0 && (
              <span className="tabular-nums text-muted-foreground">
                {progress.done} of {progress.total}
              </span>
            )}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
            <motion.div
              className="h-full rounded-full bg-primary"
              animate={{ width: progress && progress.total ? `${(progress.done / progress.total) * 100}%` : "6%" }}
              transition={{ type: "spring", stiffness: 120, damping: 20 }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Results appear as they finish. The free AI plan is rate-limited, so a large batch can take a few minutes.
          </p>
        </div>
      )}

      {panelRun.running && (
        <div className="space-y-2 rounded-xl border bg-card p-4">
          <p className="flex items-center gap-2 text-sm font-medium" role="status">
            <Loader2 className="size-4 animate-spin text-primary" /> {panelRun.status}
          </p>
          <p className="text-xs text-muted-foreground">
            Three panelists review each of the best candidates independently, then a moderator writes the summary. Verdicts appear on the cards as they finish.
          </p>
          {Object.entries(panelRun.live).map(([id, reviews]) => (
            <LivePanel key={id} reviews={reviews} status="" />
          ))}
        </div>
      )}

      {errors.length > 0 && (
        <div role="alert" className="space-y-1 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
          <p className="flex items-center gap-2 font-medium">
            <TriangleAlert className="size-4 text-amber-500" /> {errors.length} candidate{errors.length === 1 ? "" : "s"} could not be scored
          </p>
          <ul className="list-disc pl-6 text-muted-foreground">
            {errors.map((e) => (
              <li key={e.id}>
                {displayName({ id: e.id, name: matches.find((m) => m.candidate.id === e.id)?.candidate.name ?? `Candidate ${e.id}` }, blind)}: {e.message}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">Run “Screen candidates” again to retry them.</p>
        </div>
      )}

      {!hasDescription ? (
        <EmptyState
          icon={FileText}
          title="This job has no description yet"
          description="The Matcher scores candidates against the job description. Generate or write one first."
          action={
            <Link href={`/jobs/${job.id}`} className={buttonVariants()}>
              Open Job Studio
            </Link>
          }
        />
      ) : matches.length === 0 && !running ? (
        <EmptyState
          icon={Scale}
          title="No candidates screened yet"
          description="The Matcher scores every uploaded candidate against this job, ranks them, and shows the evidence behind each score."
          action={
            <Button onClick={() => run(false)}>
              <Sparkles /> Screen candidates
            </Button>
          }
        />
      ) : (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground" aria-live="polite">
              <span className="font-medium text-foreground">{matches.length}</span> screened · {strong} strong · {partial} partial ·{" "}
              {matches.length - strong - partial} weak
            </p>
            <SkillLegend />
          </div>
          <ul className="space-y-3">
            <AnimatePresence initial={false}>
              {matches.map((match, index) => (
                <MatchCard
                  key={match.id}
                  match={match}
                  rank={index + 1}
                  blind={blind}
                  onOpen={() => setOpenId(match.id)}
                  selected={selected.includes(match.id)}
                  selectDisabled={selected.length >= 3}
                  onToggleSelect={() => toggleSelected(match.id)}
                />
              ))}
            </AnimatePresence>
          </ul>
        </section>
      )}

      {selected.length > 0 && (
        <div className="sticky bottom-4 z-20 mx-auto flex w-fit items-center gap-3 rounded-full border bg-background/95 px-4 py-2 shadow-lg backdrop-blur" role="region" aria-label="Compare selection">
          <span className="text-sm">
            <span className="font-semibold tabular-nums">{selected.length}</span> selected
          </span>
          <Button variant="ghost" size="xs" onClick={() => setSelected([])}>
            Clear
          </Button>
          <Link
            href={`/compare?job=${job.id}&ids=${selected.join(",")}`}
            aria-disabled={selected.length < 2}
            className={buttonVariants({ size: "sm" }) + (selected.length < 2 ? " pointer-events-none opacity-50" : "")}
          >
            <GitCompareArrows /> Compare{selected.length < 2 ? " (pick 2 or 3)" : ""}
          </Link>
        </div>
      )}

      <MatchSheet match={open} blind={blind} onClose={() => setOpenId(null)} onPanel={onPanel} />
    </div>
  );
}

function BoardSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading screening board">
      <Skeleton className="h-16 w-96 max-w-full" />
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-36 rounded-xl" />
      ))}
    </div>
  );
}
