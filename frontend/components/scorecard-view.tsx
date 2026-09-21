"use client";

import { motion } from "framer-motion";
import { AlertTriangle, CircleHelp, ThumbsDown, ThumbsUp, Timer } from "lucide-react";

import { ScoreRing } from "@/components/score-ring";
import type { InterviewTurn, Scorecard } from "@/lib/types";
import { cn } from "@/lib/utils";

const RECOMMENDATION = {
  strong: { label: "Strong interview", icon: ThumbsUp, classes: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  mixed: { label: "Mixed interview", icon: CircleHelp, classes: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  weak: { label: "Weak interview", icon: ThumbsDown, classes: "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300" },
} as const;

const COMPETENCY_LABEL: Record<string, string> = {
  technical: "Technical",
  problem_solving: "Problem solving",
  behavioural: "Behavioural",
  role_fit: "Role fit",
  communication: "Communication",
};

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** The recruiter's view of a finished interview: the rolled-up score, how it was built, and the evidence. */
export function ScorecardView({ card, turns }: { card: Scorecard; turns: InterviewTurn[] }) {
  const rec = RECOMMENDATION[card.recommendation];
  const bars = [
    ...Object.entries(card.competencies),
    ...(card.communication !== null ? [["communication", card.communication] as [string, number]] : []),
  ];

  return (
    <section className="space-y-6 rounded-xl border bg-card p-5" aria-label="Interview scorecard">
      <div className="flex flex-wrap items-center gap-5">
        <ScoreRing score={card.overall} size={96} />
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">Interview scorecard</h2>
          <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm font-semibold", rec.classes)}>
            <rec.icon className="size-3.5" aria-hidden /> {rec.label}
          </span>
          {card.duration_seconds !== null && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Timer className="size-3.5" /> Took {formatDuration(card.duration_seconds)}
            </p>
          )}
        </div>
      </div>

      <p className="text-sm leading-relaxed">{card.summary}</p>

      <div className="space-y-3" aria-label="How the score is built">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">How the score is built</h3>
        {bars.map(([key, value], i) => (
          <div key={key} className="space-y-1">
            <div className="flex items-baseline justify-between text-sm">
              <span>
                {COMPETENCY_LABEL[key] ?? key} <span className="text-xs text-muted-foreground">counts {Math.round((card.weights[key] ?? 0) * 100)}%</span>
              </span>
              <span className="font-medium tabular-nums">{Math.round(value)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted" role="presentation">
              <motion.div
                className={cn("h-full rounded-full", value >= 75 ? "bg-emerald-500" : value >= 50 ? "bg-amber-500" : "bg-rose-500")}
                initial={{ width: 0 }}
                animate={{ width: `${value}%` }}
                transition={{ duration: 0.7, delay: i * 0.08, ease: "easeOut" }}
              />
            </div>
          </div>
        ))}
        <p className="text-xs text-muted-foreground">
          Each answer is scored by the AI; the roll-up and the recommendation follow fixed rules. Communication is the clarity of all answers.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Points title="Strengths" icon={ThumbsUp} items={card.strengths} tone="text-emerald-600 dark:text-emerald-400" />
        <Points title="Concerns" icon={AlertTriangle} items={card.concerns} tone="text-amber-600 dark:text-amber-400" />
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Question by question</h3>
        {card.questions.map((q) => (
          <details key={q.index} className="group rounded-lg border px-3 py-2 text-sm open:bg-muted/30">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
              <span className="min-w-0">
                <span className="mr-2 text-xs text-muted-foreground">{COMPETENCY_LABEL[q.competency] ?? q.competency}</span>
                <span className="font-medium">{q.text}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {q.follow_up_asked && <span className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">follow-up</span>}
                <span className="font-semibold tabular-nums">{Math.round(q.score)}</span>
              </span>
            </summary>
            <div className="mt-2 space-y-2 border-t pt-2">
              {turns
                .filter((t) => t.question_index === q.index)
                .map((t, i) => (
                  <p key={i} className={cn("text-sm", t.role === "interviewer" ? "text-muted-foreground" : "")}>
                    <span className="mr-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t.role === "interviewer" ? (t.kind === "follow_up" ? "Follow-up" : "Question") : "Answer"}
                    </span>
                    {t.text}
                    {t.role === "candidate" && t.content_score !== null && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        (content {t.content_score}/10, clarity {t.clarity_score}/10)
                      </span>
                    )}
                  </p>
                ))}
              <p className="text-xs">
                <span className="font-medium">Feedback:</span> {q.feedback}
              </p>
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

function Points({ title, icon: Icon, items, tone }: { title: string; icon: typeof ThumbsUp; items: string[]; tone: string }) {
  return (
    <div className="space-y-1.5">
      <h3 className={cn("flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide", tone)}>
        <Icon className="size-3.5" aria-hidden /> {title}
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
    </div>
  );
}
