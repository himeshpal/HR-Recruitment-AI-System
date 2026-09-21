"use client";

import { motion } from "framer-motion";
import { Briefcase } from "lucide-react";

import { Avatar } from "@/components/candidate-card";
import { ScoreRing, scoreBand } from "@/components/score-ring";
import { SkillChip } from "@/components/skill-chip";
import { Badge } from "@/components/ui/badge";
import { VerdictBadge } from "@/components/verdict-badge";
import { displayName } from "@/lib/blind";
import { STAGE_LABELS, type Match, type Stage } from "@/lib/types";

export function MatchCard({
  match,
  rank,
  blind,
  onOpen,
  selected,
  selectDisabled,
  onToggleSelect,
}: {
  match: Match;
  rank: number;
  blind: boolean;
  onOpen: () => void;
  selected: boolean;
  selectDisabled: boolean;
  onToggleSelect: () => void;
}) {
  const { candidate } = match;
  const must = match.skill_details.filter((s) => s.kind === "must");
  const band = scoreBand(match.overall_score);

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ type: "spring", stiffness: 260, damping: 28 }}
      className="flex items-stretch gap-2"
    >
      <label
        className="flex w-7 shrink-0 cursor-pointer items-start justify-center pt-5"
        title={selectDisabled && !selected ? "You can compare up to 3 candidates" : "Select to compare"}
      >
        <input
          type="checkbox"
          checked={selected}
          disabled={selectDisabled && !selected}
          onChange={onToggleSelect}
          aria-label={`Compare ${displayName(candidate, blind)}`}
          className="size-4 accent-[var(--primary)]"
        />
      </label>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open evaluation for ${displayName(candidate, blind)}, rank ${rank}, score ${Math.round(match.overall_score)}`}
        className="flex min-w-0 flex-1 items-start gap-4 rounded-xl bg-card p-4 text-left ring-1 ring-foreground/10 outline-none transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <div className="flex flex-col items-center gap-1.5">
          <span className="text-xs font-semibold text-muted-foreground">#{rank}</span>
          <ScoreRing score={match.overall_score} size={64} />
          <span className="text-[11px] text-muted-foreground">{band.label}</span>
        </div>

        <div className="min-w-0 flex-1 space-y-2.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Avatar name={blind ? "#" : candidate.name} className="size-8 text-xs" />
            <div className="min-w-0">
              <p className="truncate font-medium">{displayName(candidate, blind)}</p>
              <p className="truncate text-sm text-muted-foreground">{candidate.headline ?? "No headline"}</p>
            </div>
            <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Briefcase className="size-3" />
                {candidate.years} yrs
              </span>
              {match.panel && <VerdictBadge verdict={match.panel.verdict} />}
              <Badge variant="outline">{STAGE_LABELS[candidate.stage as Stage] ?? candidate.stage}</Badge>
            </div>
          </div>

          {must.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {must.map((detail) => (
                <SkillChip key={detail.skill} detail={detail} />
              ))}
            </div>
          )}

          <p className="line-clamp-2 text-sm text-muted-foreground">{match.summary}</p>
        </div>
      </button>
    </motion.li>
  );
}
