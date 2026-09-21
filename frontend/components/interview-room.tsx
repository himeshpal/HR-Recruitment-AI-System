"use client";

import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { ArrowLeft, Bot, Loader2, Mic, MicOff, Send, Sparkles, Timer, Volume2, VolumeX } from "lucide-react";
import { toast } from "sonner";

import { BlindToggle } from "@/components/blind-toggle";
import { ScorecardView, formatDuration } from "@/components/scorecard-view";
import { ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, apiFetch, postJson } from "@/lib/api";
import { displayName, useBlind } from "@/lib/blind";
import { parseApiDate } from "@/lib/format";
import { useDictation, useReadAloud } from "@/lib/speech";
import type { Interview } from "@/lib/types";
import { useFetch } from "@/lib/use-fetch";
import { cn } from "@/lib/utils";

const MAX_CHARS = 4000;
const noSubscription = () => () => {};

export function InterviewRoom({ id }: { id: number }) {
  const interview = useFetch<Interview>(`/api/interviews/${id}`);
  if (interview.state.status === "loading") return <RoomSkeleton />;
  if (interview.state.status === "error") return <ErrorState message={interview.state.message} onRetry={interview.reload} />;
  return <Room initial={interview.state.data} />;
}

/** Reveals new interviewer messages a few characters at a time, unless the reader prefers reduced motion. */
function Typewriter({ text, animate }: { text: string; animate: boolean }) {
  const reduced = useSyncExternalStore(noSubscription, () => window.matchMedia("(prefers-reduced-motion: reduce)").matches, () => false);
  const [shown, setShown] = useState(0);
  const moving = animate && !reduced;

  useEffect(() => {
    if (!moving) return;
    const timer = setInterval(() => setShown((n) => (n >= text.length ? n : n + 3)), 18);
    return () => clearInterval(timer);
  }, [moving, text]);

  return <>{moving ? text.slice(0, shown) : text}</>;
}

function Room({ initial }: { initial: Interview }) {
  const blind = useBlind();
  const [iv, setIv] = useState(initial);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingAnswer, setPendingAnswer] = useState<string | null>(null);
  const [freshTurn, setFreshTurn] = useState<number | null>(null); // the turn that should type itself out
  const [suggesting, setSuggesting] = useState<"strong" | "weak" | null>(null);
  const [readAloud, setReadAloud] = useState(false);
  const [now, setNow] = useState<number | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const done = iv.status === "completed";
  const candidateLabel = displayName(iv.candidate, blind);

  // Timer: ticks once a second while the interview is running.
  useEffect(() => {
    if (done) return;
    const tick = () => setNow(Date.now());
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [done]);
  const started = parseApiDate(iv.created_at).getTime();
  const elapsed = done
    ? (iv.scorecard?.duration_seconds ?? 0)
    : now === null ? 0 : Math.max(0, Math.floor((now - started) / 1000));

  const dictation = useDictation(draft, setDraft);
  const voice = useReadAloud();

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [iv.turns.length, pendingAnswer, sending]);

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    dictation.stop();
    setSending(true);
    setPendingAnswer(text);
    setDraft("");
    try {
      const next = await postJson<Interview>(`/api/interviews/${iv.id}/answer`, { text });
      const last = next.turns[next.turns.length - 1];
      setFreshTurn(last.role === "interviewer" ? next.turns.length - 1 : null);
      setIv(next);
      if (readAloud && last.role === "interviewer") voice.speak(last.text);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Someone (or another tab) already answered: show the interview as it really is.
        toast.info(err.message);
        setIv(await apiFetch<Interview>(`/api/interviews/${iv.id}`));
      } else {
        toast.error((err as Error).message);
        setDraft(text);
      }
    } finally {
      setPendingAnswer(null);
      setSending(false);
    }
  }

  async function suggest(quality: "strong" | "weak") {
    setSuggesting(quality);
    try {
      const { text } = await postJson<{ text: string }>(`/api/interviews/${iv.id}/suggest-answer?quality=${quality}`);
      setDraft(text);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSuggesting(null);
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void send();
    }
  }

  const { progress } = iv;
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="space-y-3">
        <Link href={`/screening/${iv.job_id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" /> Back to screening
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Interview</h1>
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{candidateLabel}</span> for {iv.job_title}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <BlindToggle />
            <span className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm tabular-nums" aria-label="Interview time">
              <Timer className="size-4 text-muted-foreground" /> {formatDuration(elapsed)}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3" aria-label={`Question ${progress.current_question} of ${progress.total_questions}`}>
          <div className="flex flex-1 gap-1.5" role="presentation">
            {Array.from({ length: progress.total_questions }).map((_, i) => (
              <span
                key={i}
                className={cn(
                  "h-1.5 flex-1 rounded-full transition-colors",
                  done || i < progress.current_question - 1 ? "bg-primary" : i === progress.current_question - 1 ? "bg-primary/50" : "bg-muted",
                )}
              />
            ))}
          </div>
          <span className="text-xs text-muted-foreground">{done ? "Finished" : `Question ${progress.current_question} of ${progress.total_questions}`}</span>
        </div>
      </div>

      <div className="space-y-4 rounded-xl border bg-card p-4 sm:p-5" role="log" aria-live="polite" aria-label="Interview conversation">
        <AnimatePresence initial={false}>
          {iv.turns.map((turn, index) => {
            const mine = turn.role === "candidate";
            return (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn("flex gap-3", mine && "flex-row-reverse")}
              >
                {!mine && (
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary" aria-hidden>
                    <Bot className="size-4" />
                  </span>
                )}
                <div
                  className={cn(
                    "max-w-[85%] space-y-1 rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                    mine ? "rounded-br-sm bg-primary text-primary-foreground" : "rounded-bl-sm bg-muted",
                  )}
                >
                  {turn.kind === "follow_up" && <Badge variant="outline" className="mb-0.5">Follow-up</Badge>}
                  <p className="whitespace-pre-wrap">
                    {mine ? turn.text : <Typewriter text={turn.text} animate={index === freshTurn} />}
                  </p>
                </div>
              </motion.div>
            );
          })}
          {pendingAnswer && (
            <motion.div key="pending" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-row-reverse gap-3">
              <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary/70 px-4 py-2.5 text-sm text-primary-foreground">
                <p className="whitespace-pre-wrap">{pendingAnswer}</p>
              </div>
            </motion.div>
          )}
          {sending && (
            <motion.div key="typing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-3" role="status" aria-label="The interviewer is thinking">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary" aria-hidden>
                <Bot className="size-4" />
              </span>
              <div className="flex items-center gap-1 rounded-2xl rounded-bl-sm bg-muted px-4 py-3">
                {[0, 1, 2].map((i) => (
                  <motion.span
                    key={i}
                    className="size-1.5 rounded-full bg-muted-foreground"
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
                  />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <div ref={endRef} />
      </div>

      {!done ? (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="answer" className="text-sm font-medium">
              Your answer
            </label>
            <Textarea
              id="answer"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={sending}
              maxLength={MAX_CHARS}
              rows={5}
              placeholder="Type your answer, or use the microphone. Press Ctrl+Enter to send."
            />
            {dictation.error && <p className="text-xs text-destructive" role="alert">{dictation.error}</p>}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={send} disabled={sending || !draft.trim()}>
              {sending ? <Loader2 className="animate-spin" /> : <Send />}
              Send answer
            </Button>
            {dictation.supported && (
              <Button
                variant={dictation.listening ? "default" : "outline"}
                onClick={dictation.listening ? dictation.stop : dictation.start}
                disabled={sending}
                aria-pressed={dictation.listening}
              >
                {dictation.listening ? <MicOff /> : <Mic />}
                {dictation.listening ? "Stop dictating" : "Dictate"}
              </Button>
            )}
            {voice.supported && (
              <Button
                variant="outline"
                aria-pressed={readAloud}
                onClick={() => {
                  if (readAloud) voice.cancel();
                  else voice.speak(iv.turns[iv.turns.length - 1]?.text ?? "");
                  setReadAloud((v) => !v);
                }}
              >
                {readAloud ? <Volume2 /> : <VolumeX />}
                Read questions aloud
              </Button>
            )}
            <span className="ml-auto text-xs tabular-nums text-muted-foreground">
              {draft.length}/{MAX_CHARS}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
            <Sparkles className="size-3.5 text-primary" aria-hidden />
            <span className="font-medium text-foreground">Demo helper</span>
            <span>Let an AI write a sample answer:</span>
            <Button variant="outline" size="xs" onClick={() => suggest("strong")} disabled={sending || suggesting !== null}>
              {suggesting === "strong" && <Loader2 className="animate-spin" />} Strong sample
            </Button>
            <Button variant="outline" size="xs" onClick={() => suggest("weak")} disabled={sending || suggesting !== null}>
              {suggesting === "weak" && <Loader2 className="animate-spin" />} Weak sample
            </Button>
          </div>
        </div>
      ) : (
        iv.scorecard && <ScorecardView card={iv.scorecard} turns={iv.turns} />
      )}
    </div>
  );
}

function RoomSkeleton() {
  return (
    <div className="mx-auto max-w-3xl space-y-5" aria-busy="true" aria-label="Loading interview">
      <Skeleton className="h-16 w-80" />
      <Skeleton className="h-72 rounded-xl" />
      <Skeleton className="h-32 rounded-xl" />
    </div>
  );
}
