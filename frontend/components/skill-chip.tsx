import { Check, Minus, X } from "lucide-react";

import type { SkillDetail } from "@/lib/types";
import { cn } from "@/lib/utils";

const STYLES = {
  demonstrated: {
    icon: Check,
    label: "Shown in real work",
    classes: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  listed: {
    icon: Minus,
    label: "Only listed in the skills section",
    classes: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  missing: {
    icon: X,
    label: "Not found",
    classes: "border-dashed border-rose-500/40 text-rose-700 dark:text-rose-300",
  },
} as const;

/** A required skill and whether the candidate really shows it. Icon and tooltip, not just colour. */
export function SkillChip({ detail }: { detail: SkillDetail }) {
  const { icon: Icon, label, classes } = STYLES[detail.status];
  return (
    <span
      title={`${detail.skill}: ${label}`}
      className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium", classes)}
    >
      <Icon className="size-3" aria-hidden />
      {detail.skill}
      <span className="sr-only">: {label}</span>
    </span>
  );
}

export function SkillLegend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Skill chip legend">
      {(Object.keys(STYLES) as (keyof typeof STYLES)[]).map((key) => {
        const { icon: Icon, label, classes } = STYLES[key];
        return (
          <li key={key} className="flex items-center gap-1.5">
            <span className={cn("flex size-4 items-center justify-center rounded-full border", classes)}>
              <Icon className="size-2.5" aria-hidden />
            </span>
            {label}
          </li>
        );
      })}
    </ul>
  );
}
