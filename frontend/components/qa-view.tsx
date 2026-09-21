"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, BookOpen, CheckCircle2, Inbox, Loader2, Send, UserRound } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { patchJson, postJson } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { Job, QaEntry } from "@/lib/types";
import { useFetch } from "@/lib/use-fetch";
import { cn } from "@/lib/utils";

const EXAMPLES = ["How many days a week are people in the office?", "How long is the technical interview?", "Do I need AWS experience?"];

export function QaView({ jobId }: { jobId: number }) {
  const job = useFetch<Job>(`/api/jobs/${jobId}`);
  const inbox = useFetch<QaEntry[]>(`/api/jobs/${jobId}/qa?escalated_only=true`);
  const open = inbox.state.status === "ready" ? inbox.state.data.filter((e) => !e.resolved).length : 0;

  if (job.state.status === "error") return <ErrorState message={job.state.message} onRetry={job.reload} />;
  const title = job.state.status === "ready" ? job.state.data.title : "…";

  return (
    <div className="space-y-2">
      <Link href={`/jobs/${jobId}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Job Studio
      </Link>
      <PageHeader
        title={`Candidate Q&A · ${title}`}
        description="Candidates ask about the role and the company. Answers come only from the job description and company info; anything else goes to you."
      />
      <Tabs defaultValue="chat">
        <TabsList>
          <TabsTrigger value="chat" className="px-3">Candidate chat</TabsTrigger>
          <TabsTrigger value="inbox" className="px-3">
            Recruiter inbox
            {open > 0 && <Badge className="ml-1.5">{open}</Badge>}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="chat" className="pt-4">
          <Chat jobId={jobId} onEscalated={inbox.reload} />
        </TabsContent>
        <TabsContent value="inbox" className="pt-4">
          <InboxTab state={inbox.state} reload={inbox.reload} update={inbox.update} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

type Turn = { id: number; question: string; entry?: QaEntry; error?: string };

function Chat({ jobId, onEscalated }: { jobId: number; onEscalated: () => void }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [turns]);

  async function send(question: string) {
    const q = question.trim();
    if (q.length < 3 || busy) return;
    const id = Date.now();
    setTurns((t) => [...t, { id, question: q }]);
    setText("");
    setBusy(true);
    try {
      const entry = await postJson<QaEntry>(`/api/jobs/${jobId}/qa`, { question: q });
      setTurns((t) => t.map((turn) => (turn.id === id ? { ...turn, entry } : turn)));
      if (entry.escalated) onEscalated();
    } catch (err) {
      setTurns((t) => t.map((turn) => (turn.id === id ? { ...turn, error: (err as Error).message } : turn)));
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void send(text);
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div className="min-h-64 space-y-4 rounded-xl border bg-muted/20 p-4" aria-live="polite" aria-label="Conversation">
        {turns.length === 0 && (
          <div className="space-y-3 py-6 text-center">
            <span className="mx-auto flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
              <BookOpen className="size-5" />
            </span>
            <p className="text-sm text-muted-foreground">Ask anything about the role, the team, benefits or the hiring process.</p>
            <div className="flex flex-wrap justify-center gap-2">
              {EXAMPLES.map((example) => (
                <button key={example} type="button" onClick={() => void send(example)} className="rounded-full border bg-background px-3 py-1 text-xs hover:bg-muted">
                  {example}
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((turn) => (
          <div key={turn.id} className="space-y-2">
            <div className="flex justify-end">
              <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3.5 py-2 text-sm text-primary-foreground">{turn.question}</p>
            </div>
            <div className="flex">
              {turn.error ? (
                <p role="alert" className="max-w-[85%] rounded-2xl rounded-bl-sm border border-destructive/30 bg-destructive/5 px-3.5 py-2 text-sm text-destructive">
                  {turn.error}
                </p>
              ) : turn.entry ? (
                <Answer entry={turn.entry} />
              ) : (
                <p className="flex items-center gap-2 rounded-2xl rounded-bl-sm border bg-background px-3.5 py-2 text-sm text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" /> Looking that up…
                </p>
              )}
            </div>
          </div>
        ))}
        <div ref={bottom} />
      </div>

      <form onSubmit={submit} className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={500}
          aria-label="Your question"
          placeholder="Type a question…"
          className="h-10 flex-1 rounded-lg border bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <Button type="submit" disabled={busy || text.trim().length < 3}>
          {busy ? <Loader2 className="animate-spin" /> : <Send />} Ask
        </Button>
      </form>
    </div>
  );
}

function Answer({ entry }: { entry: QaEntry }) {
  return (
    <div
      className={cn(
        "max-w-[85%] space-y-2 rounded-2xl rounded-bl-sm border bg-background px-3.5 py-2.5 text-sm",
        entry.escalated && "border-amber-500/40 bg-amber-500/5",
      )}
    >
      <p className="leading-relaxed">{entry.answer}</p>
      {entry.escalated ? (
        <Badge variant="outline" className="gap-1 border-amber-500/50 text-amber-700 dark:text-amber-300">
          <UserRound className="size-3" /> Passed to the recruiter
        </Badge>
      ) : (
        <div className="space-y-1">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Sources</p>
          <ul className="flex flex-wrap gap-1.5">
            {entry.sources.map((s) => (
              <li key={s.id} title={s.excerpt}>
                <Badge variant="secondary">{s.label}</Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

const REASONS: Record<string, string> = {
  out_of_scope: "Not about this job or company",
  not_covered: "Not covered in the documents",
  bad_sources: "Answer had no valid source",
  too_long: "Answer was too long",
  unverified_figures: "Answer had a number that could not be verified",
};

function InboxTab({
  state,
  reload,
  update,
}: {
  state: ReturnType<typeof useFetch<QaEntry[]>>["state"];
  reload: () => void;
  update: ReturnType<typeof useFetch<QaEntry[]>>["update"];
}) {
  async function resolve(entry: QaEntry, resolved: boolean) {
    try {
      await patchJson(`/api/qa/${entry.id}`, { resolved });
      update((list) => list.map((e) => (e.id === entry.id ? { ...e, resolved } : e)));
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  if (state.status === "loading") return <Skeleton className="h-32 rounded-xl" />;
  if (state.status === "error") return <ErrorState message={state.message} onRetry={reload} />;
  if (state.data.length === 0) {
    return <EmptyState icon={Inbox} title="Nothing to answer" description="Questions the bot can't answer from the documents will land here for you." />;
  }
  return (
    <ul className="space-y-2">
      {state.data.map((entry) => (
        <li key={entry.id} className={cn("flex items-start justify-between gap-3 rounded-xl border p-3", entry.resolved && "opacity-60")}>
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium">{entry.question}</p>
            <p className="text-xs text-muted-foreground">
              {REASONS[entry.reason] ?? entry.reason} · {formatDate(entry.created_at)}
            </p>
          </div>
          <Button size="sm" variant={entry.resolved ? "ghost" : "outline"} onClick={() => resolve(entry, !entry.resolved)}>
            <CheckCircle2 /> {entry.resolved ? "Reopen" : "Mark answered"}
          </Button>
        </li>
      ))}
    </ul>
  );
}
