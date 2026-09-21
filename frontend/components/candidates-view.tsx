"use client";

import { useCallback, useMemo, useState } from "react";
import { Search, Users } from "lucide-react";

import { CandidateCard } from "@/components/candidate-card";
import { CandidateSheet } from "@/components/candidate-sheet";
import { EmptyState, ErrorState } from "@/components/states";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { UploadZone } from "@/components/upload-zone";
import type { Candidate } from "@/lib/types";
import { useFetch } from "@/lib/use-fetch";

export function CandidatesView() {
  const { state, reload, update } = useFetch<Candidate[]>("/api/candidates");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);

  const onUploaded = useCallback(
    (candidate: Candidate) => update((list) => [candidate, ...list.filter((c) => c.id !== candidate.id)]),
    [update],
  );

  const candidates = useMemo(() => (state.status === "ready" ? state.data : []), [state]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((c) =>
      [c.name, c.profile?.headline ?? "", ...(c.profile?.skills ?? [])].some((text) => text.toLowerCase().includes(q)),
    );
  }, [candidates, query]);
  const open = candidates.find((c) => c.id === openId) ?? null;

  return (
    <div className="space-y-8">
      <UploadZone onUploaded={onUploaded} />

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight">
            Candidates{state.status === "ready" && <span className="ml-2 text-sm font-normal text-muted-foreground">{candidates.length}</span>}
          </h2>
          {candidates.length > 0 && (
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input
                aria-label="Search candidates"
                placeholder="Search by name, title or skill"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-8"
              />
            </div>
          )}
        </div>

        {state.status === "loading" && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading candidates">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-36 rounded-xl" />
            ))}
          </div>
        )}
        {state.status === "error" && <ErrorState message={state.message} onRetry={reload} />}
        {state.status === "ready" && candidates.length === 0 && (
          <EmptyState
            icon={Users}
            title="No candidates yet"
            description="Upload resumes above. Each one is read and structured by the Resume Parser agent."
          />
        )}
        {state.status === "ready" && candidates.length > 0 && filtered.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">No candidates match “{query}”.</p>
        )}
        {filtered.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((candidate) => (
              <CandidateCard key={candidate.id} candidate={candidate} onOpen={() => setOpenId(candidate.id)} />
            ))}
          </div>
        )}
      </section>

      <CandidateSheet
        candidate={open}
        onClose={() => setOpenId(null)}
        onDeleted={(id) => {
          setOpenId(null);
          update((list) => list.filter((c) => c.id !== id));
        }}
      />
    </div>
  );
}
