"use client";

import { useState } from "react";
import { Loader2, Mail, MapPin, Phone, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Avatar } from "@/components/candidate-card";
import { ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { del } from "@/lib/api";
import { formatMonth } from "@/lib/format";
import type { Candidate, CandidateDetail } from "@/lib/types";
import { useFetch } from "@/lib/use-fetch";

export function CandidateSheet({
  candidate,
  onClose,
  onDeleted,
}: {
  candidate: Candidate | null;
  onClose: () => void;
  onDeleted: (id: number) => void;
}) {
  return (
    <Sheet open={candidate !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto data-[side=right]:sm:max-w-xl">
        {candidate && <SheetBody key={candidate.id} candidate={candidate} onDeleted={onDeleted} />}
      </SheetContent>
    </Sheet>
  );
}

function SheetBody({ candidate, onDeleted }: { candidate: Candidate; onDeleted: (id: number) => void }) {
  const profile = candidate.profile;
  const detail = useFetch<CandidateDetail>(`/api/candidates/${candidate.id}`);
  const [deleting, setDeleting] = useState(false);

  async function remove() {
    if (!window.confirm(`Delete ${candidate.name}? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await del(`/api/candidates/${candidate.id}`);
      toast.success(`${candidate.name} deleted`);
      onDeleted(candidate.id);
    } catch (err) {
      toast.error((err as Error).message);
      setDeleting(false);
    }
  }

  return (
    <>
      <SheetHeader className="flex-row items-center gap-3 pr-12">
        <Avatar name={candidate.name} className="size-12 text-base" />
        <div className="min-w-0">
          <SheetTitle className="truncate text-lg">{candidate.name}</SheetTitle>
          <SheetDescription className="truncate">{profile?.headline ?? "Candidate"}</SheetDescription>
        </div>
      </SheetHeader>

      <div className="flex-1 space-y-5 px-4 pb-4">
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
          {candidate.email && <Contact icon={Mail} text={candidate.email} />}
          {profile?.phone && <Contact icon={Phone} text={profile.phone} />}
          {profile?.location && <Contact icon={MapPin} text={profile.location} />}
        </div>

        <Tabs defaultValue="profile">
          <TabsList>
            <TabsTrigger value="profile" className="px-3">Profile</TabsTrigger>
            <TabsTrigger value="resume" className="px-3">Resume text</TabsTrigger>
          </TabsList>

          <TabsContent value="profile" className="space-y-5 pt-3">
            {profile ? <ProfileView profile={profile} /> : <p className="text-muted-foreground">Not parsed yet.</p>}
          </TabsContent>

          <TabsContent value="resume" className="pt-3">
            {detail.state.status === "loading" && <Skeleton className="h-64 rounded-lg" />}
            {detail.state.status === "error" && (
              <ErrorState message={detail.state.message} onRetry={detail.reload} />
            )}
            {detail.state.status === "ready" && (
              <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-lg bg-muted/50 p-3 font-mono text-xs leading-relaxed">
                {detail.state.data.resume_text}
              </pre>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <div className="border-t p-4">
        <Button variant="destructive" onClick={remove} disabled={deleting}>
          {deleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
          Delete candidate
        </Button>
      </div>
    </>
  );
}

function Contact({ icon: Icon, text }: { icon: typeof Mail; text: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <Icon className="size-3.5" /> {text}
    </span>
  );
}

function ProfileView({ profile }: { profile: NonNullable<Candidate["profile"]> }) {
  return (
    <>
      <div className="flex items-center gap-2">
        <Badge>{profile.total_years_experience} yrs experience</Badge>
        <span className="text-xs text-muted-foreground">calculated from the dates, overlaps counted once</span>
      </div>

      <Section title="Skills">
        {profile.skills.length ? (
          <div className="flex flex-wrap gap-1.5">
            {profile.skills.map((s) => (
              <Badge key={s} variant="secondary">
                {s}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">None found.</p>
        )}
      </Section>

      <Separator />

      <Section title="Experience">
        {profile.experience.length === 0 && <p className="text-sm text-muted-foreground">None found.</p>}
        <ol className="space-y-4 border-l pl-4">
          {profile.experience.map((job, i) => (
            <li key={i} className="relative space-y-1">
              <span className="absolute -left-[21px] top-1.5 size-2.5 rounded-full bg-primary ring-4 ring-background" />
              <p className="font-medium">{job.title}</p>
              <p className="text-sm text-muted-foreground">
                {[job.company, `${formatMonth(job.start)} – ${formatMonth(job.end)}`].filter(Boolean).join(" · ")}
              </p>
              {job.highlights.length > 0 && (
                <ul className="list-disc space-y-0.5 pl-4 text-sm">
                  {job.highlights.map((h, j) => (
                    <li key={j}>{h}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      </Section>

      {profile.education.length > 0 && (
        <>
          <Separator />
          <Section title="Education">
            <ul className="space-y-1.5 text-sm">
              {profile.education.map((e, i) => (
                <li key={i}>
                  <span className="font-medium">{e.degree}</span>
                  <span className="text-muted-foreground">
                    {[e.institution, e.year].filter(Boolean).map((p) => ` · ${p}`).join("")}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        </>
      )}

      {profile.certifications.length > 0 && (
        <>
          <Separator />
          <Section title="Certifications">
            <ul className="list-disc space-y-0.5 pl-4 text-sm">
              {profile.certifications.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </Section>
        </>
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}
