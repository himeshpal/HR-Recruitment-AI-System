"use client";

import { CheckCircle2, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { LanguageFlag } from "@/lib/types";

export function LanguagePanel({
  flags,
  hasText,
  onApply,
}: {
  flags: LanguageFlag[];
  hasText: boolean;
  onApply: (flag: LanguageFlag) => void;
}) {
  // The same phrase can appear several times; show it once with a count.
  const groups = new Map<string, { flag: LanguageFlag; count: number }>();
  for (const flag of flags) {
    const key = flag.phrase.toLowerCase();
    const group = groups.get(key);
    if (group) group.count += 1;
    else groups.set(key, { flag, count: 1 });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          Inclusive language
          {hasText && (
            <Badge variant={groups.size ? "secondary" : "outline"}>
              {groups.size ? `${groups.size} to review` : "Clear"}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>Biased or exclusionary wording is highlighted in the preview.</CardDescription>
      </CardHeader>
      <CardContent>
        {!hasText ? (
          <p className="text-sm text-muted-foreground">Nothing to check yet.</p>
        ) : groups.size === 0 ? (
          <p className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="size-4" /> No biased wording found.
          </p>
        ) : (
          <ul className="space-y-3">
            {[...groups.values()].map(({ flag, count }) => (
              <li key={flag.phrase.toLowerCase()} className="space-y-1.5 rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 font-medium">
                    <TriangleAlert className="size-3.5 text-amber-500" />
                    “{flag.phrase}”{count > 1 && <span className="text-xs text-muted-foreground">×{count}</span>}
                  </span>
                  <Badge variant="outline">{flag.category}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{flag.reason}</p>
                <Button variant="outline" size="xs" onClick={() => onApply(flag)}>
                  Replace with “{flag.suggestion}”
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
