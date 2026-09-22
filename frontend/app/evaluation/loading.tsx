import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <>
      <PageHeader title="Evaluation" description="How we know it works: the results of the automated checks that run the real agents." />
      <Skeleton className="h-64 rounded-xl" />
    </>
  );
}
