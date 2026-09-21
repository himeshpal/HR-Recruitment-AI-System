import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Requirements } from "@/lib/types";

function Chips({ label, items, variant }: { label: string; items: string[]; variant: "default" | "outline" }) {
  if (!items.length) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <Badge key={item} variant={variant}>
            {item}
          </Badge>
        ))}
      </div>
    </div>
  );
}

export function RequirementsPanel({
  requirements,
  stale,
}: {
  requirements: Requirements | null;
  stale: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Requirements</CardTitle>
        <CardDescription>What the Matcher agent will screen candidates against.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!requirements ? (
          <p className="text-sm text-muted-foreground">
            Save the job to extract its must-have skills and experience level.
          </p>
        ) : (
          <>
            {stale && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                You have unsaved edits. Save to refresh these.
              </p>
            )}
            <Chips label="Must have" items={requirements.must_have_skills} variant="default" />
            <Chips label="Nice to have" items={requirements.nice_to_have_skills} variant="outline" />
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Min. experience</dt>
                <dd className="font-medium">
                  {requirements.min_years_experience > 0
                    ? `${requirements.min_years_experience}+ years`
                    : "Not specified"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Education</dt>
                <dd className="font-medium">{requirements.education ?? "Not required"}</dd>
              </div>
            </dl>
            {requirements.responsibilities.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">Main duties</p>
                <ul className="list-disc space-y-1 pl-4 text-sm">
                  {requirements.responsibilities.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
