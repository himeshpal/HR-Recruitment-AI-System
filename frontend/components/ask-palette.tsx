"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Briefcase, Info, Loader2, MapPin, Search, ShieldAlert } from "lucide-react";

import { Avatar } from "@/components/candidate-card";
import { VerdictBadge } from "@/components/verdict-badge";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { postJson } from "@/lib/api";
import { displayName, useBlind } from "@/lib/blind";
import { STAGE_LABELS, type AskResponse, type Stage, type Verdict } from "@/lib/types";

export const OPEN_ASK_EVENT = "open-ask-hr";

const EXAMPLES = [
  "Python developers with at least 3 years of experience",
  "Who is in the interview stage?",
  "Top 3 candidates by match score",
  "Candidates with either Tableau or Power BI",
];

/** The job the recruiter is looking at, taken from the address (/screening/5 or /jobs/5). */
function currentJobId(pathname: string): number | null {
  const match = /^\/(?:screening|jobs|ask)\/(\d+)/.exec(pathname);
  return match ? Number(match[1]) : null;
}

/** Ctrl+K search over the candidate pool in plain English. Read-only, and it never shows contact details. */
export function AskPalette() {
  const pathname = usePathname();
  const blind = useBlind();
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<AskResponse | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((v) => !v);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_ASK_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_ASK_EVENT, onOpen);
    };
  }, []);

  async function ask(text: string) {
    const q = text.trim();
    if (q.length < 3 || busy) return;
    setBusy(true);
    setError(null);
    try {
      setAnswer(await postJson<AskResponse>("/api/ask", { question: q, job_id: currentJobId(pathname) }));
    } catch (err) {
      setAnswer(null);
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void ask(question);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="top-[12vh] max-h-[76vh] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-2xl" initialFocus={inputRef}>
        <DialogHeader className="border-b p-4">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Search className="size-4 text-primary" /> Ask HR
          </DialogTitle>
          <DialogDescription>Search your candidates in plain English. It only searches: it can&apos;t change anything or show contact details.</DialogDescription>
          <form onSubmit={submit} className="mt-2 flex gap-2">
            <input
              ref={inputRef}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              maxLength={300}
              placeholder="e.g. Python developers with 3+ years in the interview stage"
              aria-label="Ask HR question"
              className="h-9 flex-1 rounded-lg border bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            <button
              type="submit"
              disabled={busy || question.trim().length < 3}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />} Search
            </button>
          </form>
        </DialogHeader>

        <div className="max-h-[52vh] overflow-y-auto p-4" aria-live="polite">
          {!answer && !error && !busy && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Try one of these</p>
              <div className="flex flex-wrap gap-2">
                {EXAMPLES.map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => {
                      setQuestion(example);
                      void ask(example);
                    }}
                    className="rounded-full border px-3 py-1 text-xs hover:bg-muted"
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>
          )}

          {error && (
            <p role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <Info className="mt-0.5 size-4 shrink-0" /> {error}
            </p>
          )}

          {answer?.refusal && (
            <p role="status" className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
              <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-500" /> {answer.refusal}
            </p>
          )}

          {answer && !answer.refusal && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">How I understood it:</span> {answer.understood}
              </p>
              <p className="text-sm" role="status">
                <span className="font-semibold tabular-nums">{answer.total}</span> candidate{answer.total === 1 ? "" : "s"} found
                {answer.total > answer.results.length && ` (showing ${answer.results.length})`}
              </p>
              <ul className="space-y-2">
                {answer.results.map((row) => (
                  <li key={row.id}>
                    <Link
                      href={`/candidates?open=${row.id}`}
                      onClick={() => setOpen(false)}
                      className="flex items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50"
                    >
                      <Avatar name={blind ? "#" : row.name} className="size-8 text-xs" />
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="font-medium">{displayName(row, blind)}</span>
                          <Badge variant="outline">{STAGE_LABELS[row.stage as Stage] ?? row.stage}</Badge>
                          {row.verdict && <VerdictBadge verdict={row.verdict as Verdict} />}
                          {row.score !== null && <span className="text-xs font-semibold tabular-nums text-muted-foreground">score {Math.round(row.score)}</span>}
                        </div>
                        <p className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                          <span>{row.headline ?? "No headline"}</span>
                          <span className="flex items-center gap-1"><Briefcase className="size-3" />{row.years} yrs</span>
                          {row.location && !blind && <span className="flex items-center gap-1"><MapPin className="size-3" />{row.location}</span>}
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {row.skills.slice(0, 6).map((s) => (
                            <Badge key={s} variant="secondary">{s}</Badge>
                          ))}
                        </div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
