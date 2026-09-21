"use client";

import Link from "next/link";
import { ArrowRight, Briefcase, Users, type LucideIcon } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { Candidate, Job } from "@/lib/types";
import { useFetch } from "@/lib/use-fetch";

function Stat({ icon: Icon, label, value, href, cta }: {
  icon: LucideIcon;
  label: string;
  value: number | null;
  href: string;
  cta: string;
}) {
  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="size-5" />
          </span>
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            {value === null ? <Skeleton className="mt-1 h-7 w-10" /> : <p className="text-2xl font-semibold tabular-nums">{value}</p>}
          </div>
        </div>
        <Link href={href} className={buttonVariants({ variant: "outline", size: "sm" })}>
          {cta} <ArrowRight />
        </Link>
      </CardContent>
    </Card>
  );
}

export function DashboardOverview() {
  const jobs = useFetch<Job[]>("/api/jobs");
  const candidates = useFetch<Candidate[]>("/api/candidates");

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Stat
        icon={Briefcase}
        label="Jobs"
        value={jobs.state.status === "ready" ? jobs.state.data.length : null}
        href="/jobs"
        cta="Manage jobs"
      />
      <Stat
        icon={Users}
        label="Candidates"
        value={candidates.state.status === "ready" ? candidates.state.data.length : null}
        href="/candidates"
        cta="Upload resumes"
      />
    </div>
  );
}
