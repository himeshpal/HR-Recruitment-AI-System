"use client";

import { motion } from "framer-motion";
import { AlertTriangle, Code2, Gavel, HeartHandshake, MessageCircleQuestion, Quote, Target, ThumbsUp, type LucideIcon } from "lucide-react";

import { ScoreRing } from "@/components/score-ring";
import { Badge } from "@/components/ui/badge";
import { VerdictBadge } from "@/components/verdict-badge";
import type { Panel, PersonaReview } from "@/lib/types";
import { cn } from "@/lib/utils";

const PERSONA_ICON: Record<string, LucideIcon> = { tech_lead: Code2, hr_manager: HeartHandshake, hiring_manager: Target };
const PERSONA_LENS: Record<string, string> = {
  tech_lead: "Technical depth and quality of evidence",
  hr_manager: "Career growth, communication and potential",
  hiring_manager: "Business impact, level fit and risk",
};
const AGREEMENT_TEXT = { high: "Panel agrees", moderate: "Some disagreement", low: "Panel is split" } as const;

/** The whole panel: the moderator's conclusion first, then each panelist's independent review. */
export function PanelView({ panel }: { panel: Panel }) {
  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-xl border bg-muted/30 p-4" aria-label="Moderator summary">
        <div className="flex flex-wrap items-center gap-3">
          <ScoreRing score={panel.consensus_score} size={56} />
          <div className="space-y-1">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <Gavel className="size-4 text-primary" /> Panel verdict <VerdictBadge verdict={panel.verdict} />
            </p>
            <p className="text-xs text-muted-foreground">
              Consensus {Math.round(panel.consensus_score)} · {AGREEMENT_TEXT[panel.agreement]} (scores {Math.round(panel.spread)} points apart)
            </p>
          </div>
        </div>
        <p className="text-sm leading-relaxed">{panel.summary}</p>

        {panel.disagreements.length > 0 && (
          <div className="space-y-1.5">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Points only some panelists raised</h4>
            <ul className="space-y-1.5 text-sm">
              {panel.disagreements.map((d) => (
                <li key={d.topic}>
                  <span className="font-medium">{d.topic}:</span> {d.detail}
                </li>
              ))}
            </ul>
          </div>
        )}
        {panel.key_risks.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <AlertTriangle className="size-3.5 text-amber-500" aria-hidden />
            <span className="text-xs font-medium text-muted-foreground">Risks:</span>
            {panel.key_risks.map((r) => (
              <Badge key={r} variant="outline">
                {r}
              </Badge>
            ))}
          </div>
        )}
        <p className="text-sm">
          <span className="font-medium">Next step:</span> {panel.next_step}
        </p>
        <p className="text-xs text-muted-foreground">
          The verdict follows fixed rules (the average score, and whether panelists doubt the candidate). The moderator only explains it.
        </p>
      </section>

      <div className="grid gap-3">
        {panel.reviews.map((review, i) => (
          <PersonaCard key={review.persona} review={review} delay={i * 0.08} />
        ))}
      </div>

      {panel.probe_questions.length > 0 && (
        <section className="space-y-1.5" aria-label="Questions for the interview">
          <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <MessageCircleQuestion className="size-3.5" /> Questions the panel would ask
          </h4>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {panel.probe_questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export function PersonaCard({ review, delay = 0 }: { review: PersonaReview; delay?: number }) {
  const Icon = PERSONA_ICON[review.persona] ?? Target;
  return (
    <motion.article
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.3 }}
      className="space-y-2.5 rounded-xl border p-3.5"
      aria-label={`${review.label} review`}
    >
      <header className="flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-4.5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">{review.label}</h3>
          <p className="truncate text-xs text-muted-foreground">{PERSONA_LENS[review.persona]}</p>
        </div>
        <VerdictBadge verdict={review.stance} />
        <ScoreRing score={review.score} size={44} />
      </header>
      <p className="text-sm leading-relaxed">{review.reasoning}</p>

      <div className="grid gap-3 sm:grid-cols-2">
        <Points icon={ThumbsUp} title="Strengths" items={review.strengths} tone="text-emerald-600 dark:text-emerald-400" />
        <Points icon={AlertTriangle} title="Concerns" items={review.concerns} tone="text-amber-600 dark:text-amber-400" />
      </div>

      {review.evidence.length > 0 && (
        <ul className="space-y-1.5">
          {review.evidence.map((e) => (
            <li key={e.quote} className="flex gap-2 border-l-2 border-amber-400 pl-3 text-xs italic text-muted-foreground">
              <Quote className="mt-0.5 size-3 shrink-0" aria-hidden />
              <span>
                <span className="not-italic font-medium text-foreground">{e.claim}: </span>“{e.quote}”
              </span>
            </li>
          ))}
        </ul>
      )}
    </motion.article>
  );
}

function Points({ icon: Icon, title, items, tone }: { icon: LucideIcon; title: string; items: string[]; tone: string }) {
  return (
    <div className="space-y-1">
      <h4 className={cn("flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide", tone)}>
        <Icon className="size-3" aria-hidden /> {title}
      </h4>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">None noted.</p>
      ) : (
        <ul className="list-disc space-y-0.5 pl-4 text-xs">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Panelists who have finished so far, with placeholders for the ones still thinking. */
export function LivePanel({ reviews, status }: { reviews: PersonaReview[]; status: string }) {
  const order = ["tech_lead", "hr_manager", "hiring_manager"];
  const done = new Map(reviews.map((r) => [r.persona, r]));
  return (
    <div className="space-y-3" role="status" aria-live="polite">
      <p className="text-sm text-muted-foreground">{status}</p>
      {order.map((persona) => {
        const review = done.get(persona);
        return review ? (
          <PersonaCard key={persona} review={review} />
        ) : (
          <div key={persona} className="h-24 animate-pulse rounded-xl border bg-muted/40" aria-hidden />
        );
      })}
    </div>
  );
}
