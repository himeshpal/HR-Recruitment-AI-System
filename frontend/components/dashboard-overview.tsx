"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Activity, ArrowRight, Briefcase, Database, Filter, Users, Zap, type LucideIcon } from "lucide-react";

import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api";
import { agentLabel, type AgentStats, type DashboardData, type RunRow } from "@/lib/agents";
import { parseApiDate } from "@/lib/format";
import { useFetch } from "@/lib/use-fetch";

function Stat({ icon: Icon, label, value, href, cta, note }: {
  icon: LucideIcon;
  label: string;
  value: number | string | null;
  href: string;
  cta: string;
  note?: string;
}) {
  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="size-5" />
          </span>
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            {value === null ? <Skeleton className="mt-1 h-7 w-10" /> : <p className="text-2xl font-semibold tabular-nums">{value}</p>}
          </div>
        </div>
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
        <Link href={href} className={buttonVariants({ variant: "outline", size: "sm" })}>
          {cta} <ArrowRight />
        </Link>
      </CardContent>
    </Card>
  );
}

export function DashboardOverview() {
  const dashboard = useFetch<DashboardData>("/api/dashboard");
  const stats = useFetch<AgentStats>("/api/agents/stats");
  const d = dashboard.state.status === "ready" ? dashboard.state.data : null;
  const s = stats.state.status === "ready" ? stats.state.data : null;
  const screened = d?.funnel.find((f) => f.key === "screened")?.count ?? null;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={Briefcase} label="Jobs" value={d?.jobs ?? null} href="/jobs" cta="Manage jobs" />
        <Stat icon={Users} label="Candidates" value={d?.candidates ?? null} href="/candidates" cta="Upload resumes" />
        <Stat icon={Filter} label="Screened" value={screened} href="/screening" cta="Open screening" note={d ? `${d.rejected} rejected` : undefined} />
        <Stat
          icon={Zap}
          label="Agent calls"
          value={s?.calls ?? null}
          href="/agents"
          cta="Watch live"
          note={s && s.calls > 0 ? `${Math.round((s.cached / s.calls) * 100)}% answered from the cache` : undefined}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <FunnelCard state={dashboard.state} reload={dashboard.reload} />
        <ActivityCard />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- funnel

function FunnelCard({ state, reload }: { state: ReturnType<typeof useFetch<DashboardData>>["state"]; reload: () => void }) {
  return (
    <Card className="viz-root">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Filter className="size-4 text-primary" /> Hiring funnel
        </CardTitle>
      </CardHeader>
      <CardContent>
        {state.status === "loading" && <Skeleton className="h-56 rounded-lg" />}
        {state.status === "error" && <ErrorState message={state.message} onRetry={reload} />}
        {state.status === "ready" && state.data.candidates === 0 && (
          <EmptyState icon={Users} title="No candidates yet" description="Upload resumes and the funnel fills in as candidates are screened, reviewed and interviewed." />
        )}
        {state.status === "ready" && state.data.candidates > 0 && <Funnel data={state.data} />}
      </CardContent>
    </Card>
  );
}

function Funnel({ data }: { data: DashboardData }) {
  const max = Math.max(1, ...data.funnel.map((f) => f.count));
  const first = data.funnel[0]?.count || 1;
  return (
    <div>
      <ol className="space-y-3" aria-label="Candidates at each hiring step">
        {data.funnel.map((step) => (
          <li key={step.key} data-testid={`funnel-${step.key}`} title={step.help}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
              <span className="font-medium">{step.label}</span>
              <span className="tabular-nums">
                <span className="font-semibold">{step.count}</span>
                <span className="ml-1.5 text-xs text-muted-foreground">{Math.round((step.count / first) * 100)}%</span>
              </span>
            </div>
            <div className="h-3 overflow-hidden rounded-r-[4px] bg-muted" role="presentation">
              <div
                className="h-full rounded-r-[4px] transition-[width] duration-700"
                style={{ width: `${(step.count / max) * 100}%`, background: "var(--series-1)" }}
              />
            </div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{step.help}</p>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs text-muted-foreground">
        Each step counts people, not screenings. The last step is where a recruiter moved someone, so it can be larger than the step before it.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- activity

function relative(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - parseApiDate(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function ActivityCard() {
  const runs = useFetch<RunRow[]>("/api/agents/activity?limit=8");
  const { update } = runs;

  // Keep the timeline fresh without flashing the loading state.
  useEffect(() => {
    const timer = setInterval(() => {
      apiFetch<RunRow[]>("/api/agents/activity?limit=8").then((rows) => update(() => rows)).catch(() => undefined);
    }, 8000);
    return () => clearInterval(timer);
  }, [update]);

  const rows = runs.state.status === "ready" ? runs.state.data : [];
  const slowest = Math.max(1, ...rows.map((r) => r.latency_ms));
  return (
    <Card className="viz-root">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="size-4 text-primary" /> Agent activity
          <Link href="/agents" className="ml-auto text-xs font-normal text-primary hover:underline">
            Live view
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {runs.state.status === "loading" && <Skeleton className="h-56 rounded-lg" />}
        {runs.state.status === "error" && <ErrorState message={runs.state.message} onRetry={runs.reload} />}
        {runs.state.status === "ready" && rows.length === 0 && (
          <EmptyState icon={Activity} title="No agent has run yet" description="Generate a job description or screen a candidate and every model call is listed here." />
        )}
        {rows.length > 0 && (
          <ul className="divide-y" aria-label="Recent agent calls" data-testid="activity">
            {rows.map((r) => (
              <li key={r.id} className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 py-2 text-sm">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2">
                  <span className="font-medium">{agentLabel(r.agent)}</span>
                  {r.cached && (
                    <Badge variant="secondary" className="gap-1">
                      <Database className="size-3" /> cache
                    </Badge>
                  )}
                </div>
                <span className="text-xs text-muted-foreground tabular-nums">{relative(r.created_at)}</span>
                <div className="flex items-center gap-2" aria-label={r.cached ? "Answered from the cache" : `Took ${(r.latency_ms / 1000).toFixed(1)} seconds`}>
                  <div className="h-1.5 w-full max-w-40 overflow-hidden rounded-r-[3px] bg-muted">
                    <div className="h-full rounded-r-[3px]" style={{ width: `${(r.latency_ms / slowest) * 100}%`, background: "var(--series-1)" }} />
                  </div>
                  <span className="text-xs text-muted-foreground tabular-nums">{r.cached ? "instant" : `${(r.latency_ms / 1000).toFixed(1)}s`}</span>
                </div>
                <span className="text-right text-xs text-muted-foreground tabular-nums">{r.tokens ? `${r.tokens} tokens` : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
