import type { Metadata } from "next";

import { JobsList } from "@/components/jobs-list";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Screening" };

export default function ScreeningIndexPage() {
  return (
    <>
      <PageHeader
        title="Screening"
        description="Pick a job to rank your candidates against it. The AI never sees names, contact details or schools."
      />
      <JobsList basePath="/screening" />
    </>
  );
}
