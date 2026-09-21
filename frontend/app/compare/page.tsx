import type { Metadata } from "next";
import Link from "next/link";
import { GitCompareArrows } from "lucide-react";

import { CompareView } from "@/components/compare-view";
import { EmptyState } from "@/components/states";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = { title: "Compare" };

export default async function ComparePage({ searchParams }: PageProps<"/compare">) {
  const { job, ids } = await searchParams;
  const jobId = Number(Array.isArray(job) ? job[0] : job);
  const matchIds = String(Array.isArray(ids) ? ids[0] : (ids ?? ""))
    .split(",")
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);

  if (!Number.isInteger(jobId) || jobId < 1) {
    return (
      <EmptyState
        icon={GitCompareArrows}
        title="Nothing to compare yet"
        description="Open a job's screening board, tick two or three candidates, and press Compare."
        action={
          <Link href="/screening" className={buttonVariants()}>
            Go to screening
          </Link>
        }
      />
    );
  }
  return <CompareView jobId={jobId} matchIds={matchIds} />;
}
