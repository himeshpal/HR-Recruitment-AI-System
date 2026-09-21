import { Briefcase, MapPin } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { initials } from "@/lib/format";
import type { Candidate } from "@/lib/types";

const VISIBLE_SKILLS = 5;

export function Avatar({ name, className = "size-10" }: { name: string; className?: string }) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary ${className}`}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

export function CandidateCard({ candidate, onOpen }: { candidate: Candidate; onOpen: () => void }) {
  const profile = candidate.profile;
  const skills = profile?.skills ?? [];

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex h-full flex-col gap-3 rounded-xl bg-card p-4 text-left ring-1 ring-foreground/10 outline-none transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <div className="flex items-center gap-3">
        <Avatar name={candidate.name} />
        <div className="min-w-0">
          <p className="truncate font-medium">{candidate.name}</p>
          <p className="truncate text-sm text-muted-foreground">{profile?.headline ?? candidate.email}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {profile && (
          <span className="flex items-center gap-1">
            <Briefcase className="size-3" />
            {profile.total_years_experience > 0 ? `${profile.total_years_experience} yrs experience` : "No experience listed"}
          </span>
        )}
        {profile?.location && (
          <span className="flex items-center gap-1">
            <MapPin className="size-3" />
            {profile.location}
          </span>
        )}
      </div>

      <div className="mt-auto flex flex-wrap gap-1.5">
        {skills.slice(0, VISIBLE_SKILLS).map((skill) => (
          <Badge key={skill} variant="secondary">
            {skill}
          </Badge>
        ))}
        {skills.length > VISIBLE_SKILLS && <Badge variant="outline">+{skills.length - VISIBLE_SKILLS}</Badge>}
      </div>
    </button>
  );
}
