import type { Metadata } from "next";

import { JobForm } from "@/components/job-form";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "New job" };

export default function NewJobPage() {
  return (
    <>
      <PageHeader title="New job" description="Step 1 of the hiring pipeline: define the role." />
      <JobForm />
    </>
  );
}
