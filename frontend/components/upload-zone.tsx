"use client";

import { useCallback, useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, FileText, Loader2, RotateCw, UploadCloud, XCircle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { apiFetch, type ApiError } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import type { Candidate } from "@/lib/types";
import { cn } from "@/lib/utils";

type Status = "queued" | "uploading" | "done" | "duplicate" | "error";
type Item = { id: string; file: File; status: Status; message?: string };

const ACCEPT = ".pdf,.docx,.txt";
const MAX_CONCURRENT = 2; // stays well inside the LLM provider's free-tier rate limit
const MAX_BYTES = 5 * 1024 * 1024;

export function UploadZone({ onUploaded }: { onUploaded: (candidate: Candidate) => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);
  const started = useRef(new Set<string>()); // guards against starting an upload twice
  const inputRef = useRef<HTMLInputElement>(null);

  const patch = useCallback(
    (id: string, change: Partial<Item>) =>
      setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...change } : item))),
    [],
  );

  const run = useCallback(
    async (item: Item) => {
      const form = new FormData();
      form.append("file", item.file);
      try {
        const candidate = await apiFetch<Candidate>("/api/candidates/upload", { method: "POST", body: form });
        patch(item.id, { status: "done", message: candidate.name });
        onUploaded(candidate);
      } catch (err) {
        const error = err as ApiError;
        patch(item.id, { status: error.status === 409 ? "duplicate" : "error", message: error.message });
      }
    },
    [onUploaded, patch],
  );

  // Simple queue: keep up to MAX_CONCURRENT uploads running.
  useEffect(() => {
    const active = items.filter((i) => i.status === "uploading").length;
    const next = items
      .filter((i) => i.status === "queued" && !started.current.has(i.id))
      .slice(0, MAX_CONCURRENT - active);
    if (!next.length) return;
    next.forEach((i) => started.current.add(i.id));
    setItems((prev) => prev.map((i) => (next.some((n) => n.id === i.id) ? { ...i, status: "uploading" } : i)));
    next.forEach((i) => void run(i));
  }, [items, run]);

  function addFiles(files: File[]) {
    const supported = files.filter((f) => /\.(pdf|docx|txt)$/i.test(f.name));
    const usable = supported.filter((f) => f.size <= MAX_BYTES);
    if (supported.length < files.length) toast.error("Some files were skipped: only PDF, DOCX and TXT are supported.");
    if (usable.length < supported.length) toast.error("Some files were skipped: the limit is 5 MB per resume.");
    setItems((prev) => [
      ...prev,
      ...usable.map((file) => ({ id: `${Date.now()}-${Math.random()}`, file, status: "queued" as const })),
    ]);
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    addFiles(Array.from(event.dataTransfer.files));
  }

  function retry(id: string) {
    started.current.delete(id);
    patch(id, { status: "queued", message: undefined });
  }

  const finished = items.filter((i) => ["done", "duplicate", "error"].includes(i.status)).length;
  const openPicker = () => inputRef.current?.click();

  return (
    <div className="space-y-4">
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload resumes: drop files here or press Enter to browse"
        onClick={openPicker}
        onKeyDown={(e: KeyboardEvent) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), openPicker())}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
          dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/40",
        )}
      >
        <motion.span animate={{ y: dragging ? -4 : 0 }} className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <UploadCloud className="size-6" />
        </motion.span>
        <p className="font-medium">{dragging ? "Drop to upload" : "Drag and drop resumes here"}</p>
        <p className="text-sm text-muted-foreground">or click to browse. PDF, DOCX or TXT, up to 5 MB each.</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            addFiles(Array.from(e.target.files ?? []));
            e.target.value = ""; // allow picking the same file again
          }}
        />
      </div>

      {items.length > 0 && (
        <div className="space-y-3 rounded-xl border p-4">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="font-medium">
              {finished} of {items.length} processed
            </span>
            {finished > 0 && (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setItems((prev) => prev.filter((i) => !["done", "duplicate", "error"].includes(i.status)))}
              >
                Clear finished
              </Button>
            )}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
            <motion.div
              className="h-full rounded-full bg-primary"
              animate={{ width: `${(finished / items.length) * 100}%` }}
              transition={{ type: "spring", stiffness: 120, damping: 20 }}
            />
          </div>
          <ul className="space-y-1.5">
            <AnimatePresence initial={false}>
              {items.map((item) => (
                <motion.li
                  key={item.id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  className="flex items-center gap-3 rounded-lg bg-muted/40 px-3 py-2 text-sm"
                >
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{item.file.name}</p>
                    <p className={cn("truncate text-xs", item.status === "error" ? "text-destructive" : "text-muted-foreground")}>
                      <StatusText item={item} />
                    </p>
                  </div>
                  <StatusIcon status={item.status} />
                  {item.status === "error" && (
                    <Button variant="ghost" size="icon-xs" aria-label={`Retry ${item.file.name}`} onClick={() => retry(item.id)}>
                      <RotateCw />
                    </Button>
                  )}
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </div>
      )}
    </div>
  );
}

function StatusText({ item }: { item: Item }) {
  switch (item.status) {
    case "queued":
      return <>Waiting · {formatBytes(item.file.size)}</>;
    case "uploading":
      return <>Reading and parsing with the Resume Parser agent…</>;
    case "done":
      return <>Added {item.message}</>;
    default:
      return <>{item.message}</>;
  }
}

function StatusIcon({ status }: { status: Status }) {
  switch (status) {
    case "uploading":
      return <Loader2 className="size-4 animate-spin text-primary" aria-label="Processing" />;
    case "done":
      return <CheckCircle2 className="size-4 text-emerald-500" aria-label="Done" />;
    case "duplicate":
      return <AlertTriangle className="size-4 text-amber-500" aria-label="Already uploaded" />;
    case "error":
      return <XCircle className="size-4 text-destructive" aria-label="Failed" />;
    default:
      return <span className="size-2 rounded-full bg-muted-foreground/40" aria-label="Queued" />;
  }
}
