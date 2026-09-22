"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { AlertCircle, Database, Loader2, Play, Radio, Wifi, WifiOff, Zap } from "lucide-react";
import { toast } from "sonner";

import { AgentGraph } from "@/components/agent-graph";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiFetch, postJson } from "@/lib/api";
import { agentLabel, type AgentStats } from "@/lib/agents";
import { parseApiDate } from "@/lib/format";
import { useAgentEvents, type FeedItem } from "@/lib/use-agent-events";
import { cn } from "@/lib/utils";

const TRY_QUESTIONS = [
  "Who has Python experience?",
  "Candidates with at least 3 years of experience",
  "Show the data analysts",
  "Who knows both SQL and Excel?",
  "Candidates in the screened stage",
];

export function AgentsView() {
  const live = useAgentEvents();
  const stats = useLiveStats(live.lastSeq);
  const running = Object.values(live.nodes).reduce((n, a) => n + a.running, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <span
          role="status"
          data-testid="connection"
          data-connected={live.connected}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium",
            live.connected ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-300" : "border-amber-500/40 text-amber-700 dark:text-amber-300",
          )}
        >
          {live.connected ? <Wifi className="size-3.5" /> : <WifiOff className="size-3.5" />}
          {live.connected ? "Live" : "Connecting…"}
        </span>
        <span className="text-sm text-muted-foreground" aria-live="polite">
          {running > 0 ? `${running} agent call${running === 1 ? "" : "s"} running` : "No agent is working right now"}
        </span>
        <div className="ml-auto">
          <TryIt />
        </div>
      </div>

      <Ticker item={live.feed[0]} />

      <div className="space-y-2">
        <AgentGraph nodes={live.nodes} />
        <p className="text-xs text-muted-foreground">
          Sparkle nodes are AI agents; dashed nodes are plain code. Lit-up nodes are real calls to the model, read from the same log the dashboard uses.
          Hover a node to see what it does. Scroll or pinch to zoom, drag to move.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <Feed items={live.feed} />
        <StatsTable stats={stats} />
      </div>
    </div>
  );
}

function Ticker({ item }: { item: FeedItem | undefined }) {
  return (
    <p
      aria-live="polite"
      data-testid="ticker"
      className="flex min-h-9 items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm"
    >
      <Radio className="size-4 shrink-0 text-primary" />
      {!item ? (
        <span className="text-muted-foreground">Waiting for the first agent to speak…</span>
      ) : item.type === "error" ? (
        <span className="truncate text-destructive">
          <strong>{agentLabel(item.agent)}</strong> failed: {item.message}
        </span>
      ) : (
        <span className="truncate">
          <strong>{agentLabel(item.agent)}</strong>{" "}
          <span className="text-muted-foreground">{item.cached ? "answered from the cache" : `finished in ${(item.latency_ms / 1000).toFixed(1)}s`}</span>
          {item.preview && <span className="italic text-muted-foreground"> — “{item.preview}”</span>}
        </span>
      )}
    </p>
  );
}

function useLiveStats(lastSeq: number) {
  const [stats, setStats] = useState<AgentStats | null>(null);
  useEffect(() => {
    let cancelled = false;
    // Wait a moment after the latest event so a burst of calls produces one refresh, not dozens.
    const timer = setTimeout(() => {
      apiFetch<AgentStats>("/api/agents/stats")
        .then((s) => !cancelled && setStats(s))
        .catch(() => undefined);
    }, lastSeq === 0 ? 0 : 900);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [lastSeq]);
  return stats;
}

function TryIt() {
  const [busy, setBusy] = useState(false);
  const [next, setNext] = useState(0);
  async function send() {
    setBusy(true);
    try {
      await postJson("/api/ask", { question: TRY_QUESTIONS[next % TRY_QUESTIONS.length] });
      setNext((n) => n + 1);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button variant="outline" size="sm" onClick={send} disabled={busy} title="Sends a sample question to Ask-HR so you can watch the graph react. Repeats may come from the cache.">
      {busy ? <Loader2 className="animate-spin" /> : <Play />} Send a test question
    </Button>
  );
}

function Feed({ items }: { items: FeedItem[] }) {
  return (
    <section aria-label="Agent thoughts" className="flex max-h-[520px] flex-col rounded-xl border">
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <Radio className="size-4 text-primary" />
        <h2 className="text-sm font-semibold">What the agents are saying</h2>
      </header>
      <ul className="flex-1 space-y-2 overflow-y-auto p-3" data-testid="feed">
        {items.length === 0 && (
          <li className="px-2 py-8 text-center text-sm text-muted-foreground">
            Nothing yet. Screen a job, run a panel review, or press &ldquo;Send a test question&rdquo; and it appears here.
          </li>
        )}
        <AnimatePresence initial={false}>
          {items.map((item) => (
            <motion.li
              key={item.key}
              layout
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-1 rounded-lg border bg-card p-2.5 text-sm"
              data-agent={item.agent}
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-medium">{agentLabel(item.agent)}</span>
                {item.type === "error" ? (
                  <Badge variant="destructive" className="gap-1">
                    <AlertCircle className="size-3" /> Failed
                  </Badge>
                ) : item.cached ? (
                  <Badge variant="secondary" className="gap-1">
                    <Database className="size-3" /> From cache
                  </Badge>
                ) : (
                  <Badge variant="outline" className="gap-1 tabular-nums">
                    <Zap className="size-3" /> {(item.latency_ms / 1000).toFixed(1)}s · {item.tokens} tokens
                  </Badge>
                )}
                <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">{parseApiDate(item.at).toLocaleTimeString()}</span>
              </div>
              {item.type === "error" ? (
                <p className="text-xs text-destructive">{item.message}</p>
              ) : item.preview ? (
                <p className="text-xs italic leading-relaxed text-muted-foreground">“{item.preview}”</p>
              ) : (
                <p className="text-xs text-muted-foreground">Output not shown: this agent reads raw resumes, so its words stay private.</p>
              )}
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </section>
  );
}

function StatsTable({ stats }: { stats: AgentStats | null }) {
  if (!stats) return null;
  if (stats.agents.length === 0) return null;
  const rate = stats.calls ? Math.round((stats.cached / stats.calls) * 100) : 0;
  return (
    <section aria-label="Agent statistics" className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight">Every agent, in numbers</h2>
        <p className="text-sm text-muted-foreground">
          <span className="font-semibold tabular-nums text-foreground">{stats.calls}</span> calls · <span className="tabular-nums">{stats.tokens.toLocaleString()}</span> tokens ·{" "}
          <span className="tabular-nums">{rate}%</span> answered from the cache
        </p>
      </div>
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Agent</th>
              <th className="px-3 py-2 text-right font-medium">Calls</th>
              <th className="px-3 py-2 text-right font-medium">From cache</th>
              <th className="px-3 py-2 text-right font-medium">Tokens</th>
              <th className="px-3 py-2 text-right font-medium">Typical speed</th>
            </tr>
          </thead>
          <tbody>
            {stats.agents.map((a) => (
              <tr key={a.agent} className="border-t">
                <td className="px-3 py-2 font-medium">{agentLabel(a.agent)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{a.calls}</td>
                <td className="px-3 py-2 text-right tabular-nums">{a.cached}</td>
                <td className="px-3 py-2 text-right tabular-nums">{a.tokens.toLocaleString()}</td>
                <td className="px-3 py-2 text-right tabular-nums">{a.avg_latency_ms ? `${(a.avg_latency_ms / 1000).toFixed(1)}s` : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
