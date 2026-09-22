import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <>
      <PageHeader title="Live agents" description="Watch the agents work. Every glowing node is a real call to the model, streamed as it happens." />
      <Skeleton className="h-[540px] rounded-xl" />
    </>
  );
}
