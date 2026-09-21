import { JobsSkeleton } from "@/components/jobs-list";
import { PageHeader } from "@/components/page-header";

export default function Loading() {
  return (
    <>
      <PageHeader title="Jobs" description="Open roles and their AI-written descriptions." />
      <JobsSkeleton />
    </>
  );
}
