"use client";

import Link from "next/link";
import { Briefcase, Plus } from "lucide-react";

import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/format";
import type { Job } from "@/lib/types";
import { useFetch } from "@/lib/use-fetch";

export function JobsList() {
  const { state, reload } = useFetch<Job[]>("/api/jobs");

  if (state.status === "loading") return <JobsSkeleton />;
  if (state.status === "error") return <ErrorState message={state.message} onRetry={reload} />;
  if (state.data.length === 0) {
    return (
      <EmptyState
        icon={Briefcase}
        title="No jobs yet"
        description="Describe a role in a sentence or two and the JD Generator agent writes the full job description."
        action={
          <Link href="/jobs/new" className={buttonVariants()}>
            <Plus /> Create your first job
          </Link>
        }
      />
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {state.data.map((job) => (
        <Link key={job.id} href={`/jobs/${job.id}`} className="group rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <Card className="h-full transition-all group-hover:-translate-y-0.5 group-hover:shadow-md">
            <CardContent className="flex h-full flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-medium leading-snug">{job.title}</h2>
                <Badge variant={job.status === "ready" ? "default" : "secondary"}>
                  {job.status === "ready" ? "Ready" : "Draft"}
                </Badge>
              </div>
              <p className="line-clamp-2 text-sm text-muted-foreground">
                {job.brief || "No brief provided."}
              </p>
              <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
                {job.requirements?.must_have_skills.slice(0, 4).map((skill) => (
                  <Badge key={skill} variant="outline">
                    {skill}
                  </Badge>
                ))}
                <span className="ml-auto text-xs text-muted-foreground">{formatDate(job.created_at)}</span>
              </div>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}

export function JobsSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading jobs">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-36 rounded-xl" />
      ))}
    </div>
  );
}
