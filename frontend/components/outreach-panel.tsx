"use client";

import { useState } from "react";
import { CalendarPlus, CalendarX2, Check, ClipboardCopy, Handshake, Loader2, Mail, Pencil, Send, Trash2, TriangleAlert, Undo2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ErrorState } from "@/components/states";
import { API_URL, del, postJson, putJson } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { EmailKind, Match, OutreachMessage } from "@/lib/types";
import { useFetch } from "@/lib/use-fetch";
import { cn } from "@/lib/utils";

const KINDS: { value: EmailKind; label: string; icon: typeof Mail; help: string }[] = [
  { value: "invite", label: "Interview invite", icon: CalendarPlus, help: "Adds a calendar file the candidate can open." },
  { value: "reject", label: "Rejection", icon: CalendarX2, help: "Kind and specific. Never mentions scores or AI." },
  { value: "offer", label: "Offer", icon: Handshake, help: "Only states details you type in. Anything else stays in [brackets]." },
];

const SENDER_KEY = "outreach-sender";

function savedSender(): string {
  try {
    return window.localStorage.getItem(SENDER_KEY) ?? "";
  } catch {
    return "";
  }
}

/** The email as the recruiter should see it: the first name is hidden while blind mode is on. */
function shown(message: OutreachMessage, blind: boolean) {
  if (!blind) return { subject: message.rendered_subject, body: message.rendered_body };
  const hide = (text: string) => text.replaceAll("{{first_name}}", "[first name]");
  return { subject: hide(message.subject), body: hide(message.body) };
}

export function OutreachPanel({ match, blind }: { match: Match; blind: boolean }) {
  const messages = useFetch<OutreachMessage[]>(`/api/candidates/${match.candidate.id}/messages?job_id=${match.job_id}`);
  const { update } = messages;

  const add = (message: OutreachMessage) => update((list) => [message, ...list]);
  const replace = (message: OutreachMessage) => update((list) => list.map((m) => (m.id === message.id ? message : m)));
  const remove = (id: number) => update((list) => list.filter((m) => m.id !== id));

  return (
    <div className="space-y-6">
      <Composer match={match} onCreated={add} />
      <section className="space-y-3" aria-label="Drafted emails">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Drafts and sent emails</h3>
        {messages.state.status === "loading" && <Skeleton className="h-40 rounded-xl" />}
        {messages.state.status === "error" && <ErrorState message={messages.state.message} onRetry={messages.reload} />}
        {messages.state.status === "ready" && messages.state.data.length === 0 && (
          <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">No emails yet. Draft one above.</p>
        )}
        {messages.state.status === "ready" &&
          messages.state.data.map((m) => <MessageCard key={m.id} message={m} blind={blind} onChange={replace} onDeleted={remove} />)}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- composer

function Composer({ match, onCreated }: { match: Match; onCreated: (m: OutreachMessage) => void }) {
  const [kind, setKind] = useState<EmailKind>("invite");
  const [sender, setSender] = useState(savedSender);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState(45);
  const [mode, setMode] = useState<"video" | "phone" | "onsite">("video");
  const [location, setLocation] = useState("");
  const [salary, setSalary] = useState("");
  const [startDate, setStartDate] = useState("");
  const [replyBy, setReplyBy] = useState("");
  const [includeGaps, setIncludeGaps] = useState(true);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsTime = kind === "invite" && (!date || !time);

  async function draft() {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { job_id: match.job_id, kind, sender_name: sender.trim() };
      if (kind === "invite") {
        const start = new Date(`${date}T${time}`);
        body.interview = {
          starts_at: start.toISOString(),
          duration_minutes: duration,
          mode,
          location: location.trim(),
          time_label: start.toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit", hour12: true, timeZoneName: "short" }).replace(" at ", ", "),
        };
      } else if (kind === "offer") {
        body.offer = { salary: salary.trim(), start_date: startDate.trim(), reply_by: replyBy.trim() };
      } else {
        body.include_gaps = includeGaps;
        body.feedback_points = feedback.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 5);
      }
      const message = await postJson<OutreachMessage>(`/api/candidates/${match.candidate.id}/messages`, body);
      try {
        window.localStorage.setItem(SENDER_KEY, sender.trim());
      } catch {
        // remembering the name is a convenience only
      }
      onCreated(message);
      toast.success("Draft ready. Read it before you send it.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4 rounded-xl border p-4" aria-label="Draft an email">
      <div>
        <h3 className="flex items-center gap-2 font-medium">
          <Mail className="size-4 text-primary" /> Outreach agent
        </h3>
        <p className="text-sm text-muted-foreground">
          The agent writes the email without ever seeing the candidate&apos;s name. Details you give are filled in by code, so it can&apos;t invent times, salaries or links.
        </p>
      </div>

      <div role="group" aria-label="Email type" className="grid gap-2 sm:grid-cols-3">
        {KINDS.map(({ value, label, icon: Icon, help }) => (
          <button
            key={value}
            type="button"
            aria-pressed={kind === value}
            onClick={() => setKind(value)}
            className={cn(
              "flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors",
              kind === value ? "border-primary bg-primary/5" : "hover:bg-muted/50",
            )}
          >
            <span className="flex items-center gap-1.5 text-sm font-medium">
              <Icon className="size-4" /> {label}
            </span>
            <span className="text-xs text-muted-foreground">{help}</span>
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Your name (email signature)" htmlFor="o-sender">
          <Input id="o-sender" value={sender} maxLength={80} onChange={(e) => setSender(e.target.value)} placeholder="e.g. Priya Shah" />
        </Field>

        {kind === "invite" && (
          <>
            <Field label="Date" htmlFor="o-date">
              <Input id="o-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Start time" htmlFor="o-time">
              <Input id="o-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </Field>
            <Field label="Length" htmlFor="o-duration">
              <select id="o-duration" value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="h-8 w-full rounded-lg border bg-background px-2 text-sm">
                {[30, 45, 60, 90].map((d) => (
                  <option key={d} value={d}>{d} minutes</option>
                ))}
              </select>
            </Field>
            <Field label="Format" htmlFor="o-mode">
              <select id="o-mode" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} className="h-8 w-full rounded-lg border bg-background px-2 text-sm">
                <option value="video">Video call</option>
                <option value="phone">Phone call</option>
                <option value="onsite">On site</option>
              </select>
            </Field>
            <Field label="Meeting link or address" htmlFor="o-location">
              <Input id="o-location" value={location} maxLength={300} onChange={(e) => setLocation(e.target.value)} placeholder="Paste the link, or leave blank to fill in later" />
            </Field>
          </>
        )}

        {kind === "offer" && (
          <>
            <Field label="Salary" htmlFor="o-salary">
              <Input id="o-salary" value={salary} maxLength={100} onChange={(e) => setSalary(e.target.value)} placeholder="e.g. INR 18 LPA" />
            </Field>
            <Field label="Start date" htmlFor="o-start">
              <Input id="o-start" value={startDate} maxLength={60} onChange={(e) => setStartDate(e.target.value)} placeholder="Leave blank to fill in later" />
            </Field>
            <Field label="Reply by" htmlFor="o-reply">
              <Input id="o-reply" value={replyBy} maxLength={60} onChange={(e) => setReplyBy(e.target.value)} placeholder="Leave blank to fill in later" />
            </Field>
          </>
        )}
      </div>

      {kind === "reject" && (
        <div className="space-y-3">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={includeGaps} onChange={(e) => setIncludeGaps(e.target.checked)} className="mt-1" />
            <span>
              Include gentle feedback on the real skill gaps found in screening
              <span className="block text-xs text-muted-foreground">The same gaps the learning roadmap is based on.</span>
            </span>
          </label>
          <Field label="Anything else to mention (one point per line, up to 5)" htmlFor="o-feedback">
            <Textarea id="o-feedback" rows={3} value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="e.g. Strong communication in the call" />
          </Field>
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={draft} disabled={busy || needsTime}>
          {busy ? <Loader2 className="animate-spin" /> : <Mail />} {busy ? "Writing…" : "Draft email"}
        </Button>
        {needsTime && <span className="text-xs text-muted-foreground">Pick a date and time for the interview.</span>}
      </div>
    </section>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------- one draft

function MessageCard({
  message,
  blind,
  onChange,
  onDeleted,
}: {
  message: OutreachMessage;
  blind: boolean;
  onChange: (m: OutreachMessage) => void;
  onDeleted: (id: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(message.subject);
  const [body, setBody] = useState(message.body);
  const [busy, setBusy] = useState(false);
  const view = shown(message, blind);
  const kind = KINDS.find((k) => k.value === message.kind);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const save = () =>
    run(async () => {
      onChange(await putJson<OutreachMessage>(`/api/messages/${message.id}`, { subject, body }));
      setEditing(false);
      toast.success("Saved");
    });
  const setStatus = (status: "draft" | "sent") =>
    run(async () => onChange(await postJson<OutreachMessage>(`/api/messages/${message.id}/status`, { status })));
  const remove = () =>
    run(async () => {
      await del(`/api/messages/${message.id}`);
      onDeleted(message.id);
    });
  const copy = () =>
    run(async () => {
      await navigator.clipboard.writeText(`Subject: ${message.rendered_subject}\n\n${message.rendered_body}`);
      toast.success("Copied to the clipboard");
    });

  const mailto =
    !blind && message.candidate_email
      ? `mailto:${message.candidate_email}?subject=${encodeURIComponent(message.rendered_subject)}&body=${encodeURIComponent(message.rendered_body)}`
      : null;

  return (
    <article className={cn("space-y-3 rounded-xl border p-4", message.status === "sent" && "bg-muted/30")} aria-label={`${kind?.label ?? message.kind} email`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{kind?.label ?? message.kind}</Badge>
          <Badge variant={message.status === "sent" ? "default" : "outline"}>{message.status === "sent" ? "Sent" : "Draft"}</Badge>
          <span className="text-xs text-muted-foreground">{formatDate(message.created_at)}</span>
        </div>
      </div>

      {message.unresolved_fields.length > 0 && message.status === "draft" && (
        <p role="status" className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5 text-xs">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
          <span>
            Still to fill in before you send: <strong>{message.unresolved_fields.join(", ")}</strong>. Use Edit to replace them.
          </span>
        </p>
      )}

      {editing ? (
        <div className="space-y-2">
          <Input aria-label="Subject" value={subject} maxLength={120} onChange={(e) => setSubject(e.target.value)} />
          <Textarea aria-label="Email body" rows={12} value={body} maxLength={1800} onChange={(e) => setBody(e.target.value)} />
          <p className="text-xs text-muted-foreground">
            <code>{"{{first_name}}"}</code> becomes the candidate&apos;s first name. Keep it if you want the name filled in automatically.
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={busy || !subject.trim() || !body.trim()}>
              {busy ? <Loader2 className="animate-spin" /> : <Check />} Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setSubject(message.subject);
                setBody(message.body);
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm font-medium">{view.subject}</p>
          <pre className="whitespace-pre-wrap rounded-lg bg-muted/40 p-3 font-sans text-sm leading-relaxed">{view.body}</pre>
        </div>
      )}

      {!editing && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setEditing(true)} disabled={busy}>
            <Pencil /> Edit
          </Button>
          <Button size="sm" variant="outline" onClick={copy} disabled={busy}>
            <ClipboardCopy /> Copy
          </Button>
          {mailto && (
            <a href={mailto} className={buttonVariants({ variant: "outline", size: "sm" })}>
              <Send /> Open in email app
            </a>
          )}
          {message.has_ics && (
            <a href={`${API_URL}/api/messages/${message.id}/invite.ics`} download className={buttonVariants({ variant: "outline", size: "sm" })}>
              <CalendarPlus /> Calendar file
            </a>
          )}
          {message.status === "draft" ? (
            <Button size="sm" onClick={() => setStatus("sent")} disabled={busy}>
              <Check /> Mark as sent
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setStatus("draft")} disabled={busy}>
              <Undo2 /> Back to draft
            </Button>
          )}
          <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={remove} disabled={busy} aria-label="Delete this email">
            <Trash2 />
          </Button>
        </div>
      )}
      {blind && !editing && <p className="text-xs text-muted-foreground">Blind mode is on, so the first name and email address are hidden here. Copy still includes them.</p>}
    </article>
  );
}
