import { CircleHelp, ThumbsDown, ThumbsUp } from "lucide-react";

import type { Verdict } from "@/lib/types";
import { cn } from "@/lib/utils";

const STYLES: Record<Verdict, { label: string; icon: typeof ThumbsUp; classes: string }> = {
  hire: { label: "Hire", icon: ThumbsUp, classes: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  maybe: { label: "Maybe", icon: CircleHelp, classes: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  no_hire: { label: "No hire", icon: ThumbsDown, classes: "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300" },
};

export const verdictLabel = (verdict: Verdict) => STYLES[verdict].label;

/** The panel's verdict. Icon and word, never colour alone. */
export function VerdictBadge({ verdict, className }: { verdict: Verdict; className?: string }) {
  const { label, icon: Icon, classes } = STYLES[verdict];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold", classes, className)}>
      <Icon className="size-3" aria-hidden />
      {label}
    </span>
  );
}
