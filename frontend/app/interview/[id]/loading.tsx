import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl space-y-5" aria-busy="true" aria-label="Loading interview">
      <Skeleton className="h-16 w-80" />
      <Skeleton className="h-72 rounded-xl" />
    </div>
  );
}
