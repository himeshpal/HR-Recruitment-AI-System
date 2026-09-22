"use client";

import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { AlertTriangle, ArrowRight, FileDown, Gavel, Loader2, MessageSquareText, Quote, RotateCw, ThumbsUp } from "lucide-react";
import { toast } from "sonner";

import { Avatar } from "@/components/candidate-card";
import { OutreachPanel } from "@/components/outreach-panel";
import { LivePanel, PanelView } from "@/components/panel-view";
import { RoadmapSection } from "@/components/roadmap-view";
import { ResumeViewer } from "@/components/resume-viewer";
import { ScoreRing, scoreBand } from "@/components/score-ring";
import { SkillChip } from "@/components/skill-chip";
import { ErrorState } from "@/components/states";
import { Button, buttonVariants } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { VerdictBadge } from "@/components/verdict-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { API_URL, postJson } from "@/lib/api";
import { displayName } from "@/lib/blind";
import { formatDate } from "@/lib/format";
import type { Interview, InterviewSummary, Match, MatchDetail, Panel, ScoreParts } from "@/lib/types";
import { useFetch } from "@/lib/use-fetch";
import { usePanelRun } from "@/lib/use-panel-run";
import { cn } from "@/lib/utils";

const PARTS: { key: ScoreParts; label: string; help: string }[] = [
  { key: "skills", label: "Skills coverage", help: "Required skills shown in real work count fully; skills only listed count half." },
  { key: "semantic", label: "Semantic fit", help: "How closely the best parts of the resume match the job, measured by a local AI embedding model." },
  { key: "experience", label: "Experience", help: "Years of experience against the job's minimum, counted only as far as the experience is relevant." },
  { key: "ai_review", label: "AI review", help: "An LLM's rubric judgement of the anonymised resume: skills and domain fit." },
];

type View = "ai" | "original" | "both";

export function MatchSheet({
  match,
  blind,
  onClose,
  onPanel,
}: {
  match: Match | null;
  blind: boolean;
  onClose: () => void;
  onPanel?: (panel: Panel) => void;
}) {
  return (
    <Sheet open={match !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto data-[side=right]:sm:max-w-2xl">
        {match && <SheetBody key={match.id} match={match} blind={blind} onPanel={onPanel} />}
      </SheetContent>
    </Sheet>
  );
}

function SheetBody({ match, blind, onPanel }: { match: Match; blind: boolean; onPanel?: (panel: Panel) => void }) {
  const detail = useFetch<MatchDetail>(`/api/matches/${match.id}`);
  const [tab, setTab] = useState("evaluation");
  const [view, setView] = useState<View>("ai");
  const [focus, setFocus] = useState<number | null>(null);
  const { candidate } = match;
  const band = scoreBand(match.overall_score);
  // Blind mode: the recruiter should not see the original either.
  const effectiveView: View = blind ? "ai" : view;

  function showInResume(index: number) {
    setFocus(index);
    setTab("resume");
  }

  const quotes = match.evidence.map((e) => e.quote);

  return (
    <>
      <SheetHeader className="flex-row items-center gap-4 pr-12">
        <ScoreRing score={match.overall_score} size={72} />
        <div className="min-w-0 space-y-0.5">
          <SheetTitle className="flex items-center gap-2 truncate text-lg">
            <Avatar name={blind ? "#" : candidate.name} className="size-7 text-xs" />
            {displayName(candidate, blind)}
          </SheetTitle>
          <SheetDescription className="truncate">{candidate.headline ?? "Candidate"}</SheetDescription>
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{band.label}</span> · AI confidence {Math.round(match.confidence * 100)}%
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {match.panel && <VerdictBadge verdict={match.panel.verdict} />}
            <a
              href={`${API_URL}/api/matches/${match.id}/report.pdf?blind=${blind}`}
              download
              className={buttonVariants({ variant: "outline", size: "xs" })}
              title={blind ? "Blind report: no name, email or location" : "Report with the candidate's name and email"}
            >
              <FileDown /> Download report
            </a>
          </div>
        </div>
      </SheetHeader>

      <div className="flex-1 px-4 pb-6">
        <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
          {/* Five tabs: they share the row on a phone instead of pushing the sheet sideways. */}
          <TabsList className="grid w-full grid-cols-5 sm:inline-flex sm:w-fit">
            <TabsTrigger value="evaluation" className="px-1 text-xs sm:px-3 sm:text-sm">Evaluation</TabsTrigger>
            <TabsTrigger value="panel" className="px-1 text-xs sm:px-3 sm:text-sm">Panel</TabsTrigger>
            <TabsTrigger value="interview" className="px-1 text-xs sm:px-3 sm:text-sm">Interview</TabsTrigger>
            <TabsTrigger value="outreach" className="px-1 text-xs sm:px-3 sm:text-sm">Outreach</TabsTrigger>
            <TabsTrigger value="resume" className="px-1 text-xs sm:px-3 sm:text-sm">Resume</TabsTrigger>
          </TabsList>

          <TabsContent value="evaluation" className="space-y-6 pt-4">
            <p className="text-sm leading-relaxed">{match.summary}</p>

            <section className="space-y-3" aria-label="How the score is built">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">How the score is built</h3>
              {PARTS.map(({ key, label, help }, i) => (
                <ScoreBar key={key} label={label} help={help} value={match.breakdown[key] ?? null} weight={match.weights[key]} delay={i * 0.08} />
              ))}
            </section>

            <div className="grid gap-4 sm:grid-cols-2">
              <Bullets title="Strengths" icon={ThumbsUp} items={match.strengths} tone="text-emerald-600 dark:text-emerald-400" />
              <Bullets title="Gaps" icon={AlertTriangle} items={match.gaps} tone="text-amber-600 dark:text-amber-400" />
            </div>

            <Separator />

            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Skills</h3>
              <div className="flex flex-wrap gap-1.5">
                {match.skill_details.map((s) => (
                  <span key={`${s.kind}-${s.skill}`} className={cn(s.kind === "nice" && "opacity-80")}>
                    <SkillChip detail={s} />
                  </span>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">Solid chips are must-haves; faded ones are nice-to-haves.</p>
            </section>

            <Separator />

            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Evidence from the resume</h3>
              {match.evidence.length === 0 && <p className="text-sm text-muted-foreground">The AI did not cite any verifiable quotes.</p>}
              <ol className="space-y-3">
                {match.evidence.map((item, i) => (
                  <li key={i} className="space-y-1.5 rounded-lg border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium">
                        <span className="mr-1.5 inline-flex size-5 items-center justify-center rounded-full bg-amber-200/70 text-[11px] font-semibold text-amber-800 dark:bg-amber-400/25 dark:text-amber-200">
                          {i + 1}
                        </span>
                        {item.claim}
                      </p>
                      <Button variant="ghost" size="xs" onClick={() => showInResume(i)}>
                        Show in resume <ArrowRight />
                      </Button>
                    </div>
                    <blockquote className="flex gap-2 border-l-2 border-amber-400 pl-3 text-sm italic text-muted-foreground">
                      <Quote className="mt-0.5 size-3.5 shrink-0" aria-hidden />“{item.quote}”
                    </blockquote>
                  </li>
                ))}
              </ol>
              <p className="text-xs text-muted-foreground">
                Every quote is checked word for word against the resume the AI saw
                {match.dropped_quotes > 0 && `; ${match.dropped_quotes} quote(s) it cited were removed because they were not exact`}.
              </p>
            </section>
          </TabsContent>

          <TabsContent value="panel" className="pt-4">
            <PanelTab match={match} onPanel={onPanel} />
          </TabsContent>

          <TabsContent value="interview" className="pt-4">
            <InterviewTab match={match} />
          </TabsContent>

          <TabsContent value="outreach" className="space-y-6 pt-4">
            <OutreachPanel match={match} blind={blind} />
            <RoadmapSection match={match} />
          </TabsContent>

          <TabsContent value="resume" className="space-y-3 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div role="group" aria-label="Resume view" className="inline-flex rounded-lg bg-muted p-[3px]">
                {(
                  [
                    ["ai", "What the AI saw"],
                    ["original", "Original"],
                    ["both", "Side by side"],
                  ] as [View, string][]
                ).map(([value, label]) => {
                  const disabled = blind && value !== "ai";
                  return (
                    <button
                      key={value}
                      type="button"
                      disabled={disabled}
                      aria-pressed={effectiveView === value}
                      onClick={() => setView(value)}
                      className={cn(
                        "rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                        effectiveView === value ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              {blind && <p className="text-xs text-muted-foreground">Turn off blind mode to see the original.</p>}
            </div>

            {detail.state.status === "loading" && <Skeleton className="h-72 rounded-lg" />}
            {detail.state.status === "error" && <ErrorState message={detail.state.message} onRetry={detail.reload} />}
            {detail.state.status === "ready" && (
              <ResumePanes detail={detail.state.data} quotes={quotes} view={effectiveView} focus={focus} />
            )}
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}

function ResumePanes({ detail, quotes, view, focus }: { detail: MatchDetail; quotes: string[]; view: View; focus: number | null }) {
  const unlocatable = detail.evidence.filter((e) => e.in_original === false).length;
  const pane = "max-h-[62vh]";
  return (
    <div className="space-y-2">
      <div className={cn("grid gap-3", view === "both" && "sm:grid-cols-2")}>
        {view !== "original" && (
          <div className="min-w-0 space-y-1">
            {view === "both" && <p className="text-xs font-medium text-muted-foreground">What the AI saw (identity hidden)</p>}
            <ResumeViewer text={detail.anonymized_text} quotes={quotes} activeIndex={focus} className={pane} />
          </div>
        )}
        {view !== "ai" && (
          <div className="min-w-0 space-y-1">
            {view === "both" && <p className="text-xs font-medium text-muted-foreground">Original</p>}
            <ResumeViewer text={detail.resume_text} quotes={quotes} activeIndex={focus} className={pane} />
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Highlighted, numbered passages are the evidence. <span className="rounded bg-primary/10 px-1 font-medium text-primary">[PLACEHOLDERS]</span> mark
        what the Bias Shield hid from the AI.
        {view !== "ai" && unlocatable > 0 && ` ${unlocatable} quote(s) include hidden details, so they only appear in the AI view.`}
      </p>
    </div>
  );
}

function ScoreBar({ label, help, value, weight, delay }: { label: string; help: string; value: number | null; weight: number; delay: number }) {
  return (
    <div className="space-y-1" title={help}>
      <div className="flex items-baseline justify-between text-sm">
        <span>
          {label} <span className="text-xs text-muted-foreground">counts {Math.round(weight * 100)}%</span>
        </span>
        <span className="font-medium tabular-nums">{value === null ? "n/a" : Math.round(value)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted" role="presentation">
        {value !== null && (
          <motion.div
            className={cn("h-full rounded-full", value >= 75 ? "bg-emerald-500" : value >= 50 ? "bg-amber-500" : "bg-rose-500")}
            initial={{ width: 0 }}
            animate={{ width: `${value}%` }}
            transition={{ duration: 0.7, delay, ease: "easeOut" }}
          />
        )}
      </div>
      {value === null && <p className="text-xs text-muted-foreground">Not used: this job sets no minimum, so the other signals count for more.</p>}
    </div>
  );
}

function Bullets({ title, icon: Icon, items, tone }: { title: string; icon: typeof ThumbsUp; items: string[]; tone: string }) {
  return (
    <section className="space-y-2">
      <h3 className={cn("flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide", tone)}>
        <Icon className="size-3.5" /> {title}
      </h3>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">None noted.</p>
      ) : (
        <ul className="list-disc space-y-1 pl-4 text-sm">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </section>
  );
}


function PanelTab({ match, onPanel }: { match: Match; onPanel?: (panel: Panel) => void }) {
  const saved = useFetch<Panel | null>(`/api/matches/${match.id}/panel`);
  const { update } = saved;
  const handle = useCallback(
    (panel: Panel) => {
      update(() => panel);
      onPanel?.(panel);
    },
    [update, onPanel],
  );
  const { running, status, live, run } = usePanelRun(handle);
  const start = () => run(`/api/matches/${match.id}/panel`);

  if (running) return <LivePanel reviews={live[match.id] ?? []} status={status} />;
  if (saved.state.status === "loading") return <Skeleton className="h-48 rounded-xl" />;
  if (saved.state.status === "error") return <ErrorState message={saved.state.message} onRetry={saved.reload} />;

  const panel = saved.state.data;
  if (!panel) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center">
        <span className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Gavel className="size-5" />
        </span>
        <div className="space-y-1">
          <p className="font-medium">No panel review yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            A Tech Lead, an HR Manager and a Hiring Manager review this candidate independently, then a moderator explains where they agree and differ.
          </p>
        </div>
        <Button onClick={start}>
          <Gavel /> Run panel review
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <PanelView panel={panel} />
      <Button variant="outline" size="sm" onClick={start}>
        <RotateCw /> Run the panel again
      </Button>
    </div>
  );
}

function InterviewTab({ match }: { match: Match }) {
  const router = useRouter();
  const past = useFetch<InterviewSummary[]>(`/api/interviews?candidate_id=${match.candidate.id}&job_id=${match.job_id}`);
  const [starting, setStarting] = useState(false);

  async function start() {
    setStarting(true);
    try {
      const interview = await postJson<Interview>("/api/interviews", { candidate_id: match.candidate.id, job_id: match.job_id });
      router.push(`/interview/${interview.id}`);
    } catch (err) {
      toast.error((err as Error).message);
      setStarting(false);
    }
  }

  const unfinished = past.state.status === "ready" && past.state.data.some((i) => i.status === "in_progress");
  return (
    <div className="space-y-4">
      <div className="flex flex-col items-start gap-3 rounded-xl border p-4">
        <div className="space-y-1">
          <p className="flex items-center gap-2 font-medium">
            <MessageSquareText className="size-4 text-primary" /> AI interview
          </p>
          <p className="text-sm text-muted-foreground">
            The Interview agent writes five questions for this job and this candidate&apos;s gaps, asks a follow-up when an answer is thin, and produces a scorecard.
          </p>
        </div>
        <Button onClick={start} disabled={starting}>
          {starting ? <Loader2 className="animate-spin" /> : <MessageSquareText />}
          {starting ? "Preparing questions…" : unfinished ? "Resume interview" : "Start interview"}
        </Button>
      </div>

      {past.state.status === "ready" && past.state.data.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Previous interviews</h3>
          <ul className="space-y-1.5">
            {past.state.data.map((i) => (
              <li key={i.id}>
                <a href={`/interview/${i.id}`} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm hover:bg-muted/50">
                  <span>
                    {formatDate(i.created_at)} · {i.status === "completed" ? "Completed" : "In progress"}
                  </span>
                  {i.overall !== null && <span className="font-semibold tabular-nums">{Math.round(i.overall)}</span>}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
