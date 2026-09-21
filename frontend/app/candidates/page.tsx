import type { Metadata } from "next";

import { CandidatesView } from "@/components/candidates-view";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Candidates" };

export default function CandidatesPage() {
  return (
    <>
      <PageHeader
        title="Candidates"
        description="Upload resumes and the Resume Parser agent turns them into structured profiles."
      />
      <CandidatesView />
    </>
  );
}
