import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";

import { JobsList } from "@/components/jobs-list";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = { title: "Jobs" };

export default function JobsPage() {
  return (
    <>
      <PageHeader
        title="Jobs"
        description="Open roles and their AI-written descriptions."
        actions={
          <Link href="/jobs/new" className={buttonVariants()}>
            <Plus /> New job
          </Link>
        }
      />
      <JobsList />
    </>
  );
}
