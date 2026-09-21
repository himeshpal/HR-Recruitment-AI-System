import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <>
      <PageHeader title="Pipeline" description="Drag candidates between stages. Cards are ranked by match score for the selected job." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5" aria-busy="true" aria-label="Loading pipeline">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-72 rounded-xl" />
        ))}
      </div>
    </>
  );
}
