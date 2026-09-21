import type { Metadata } from "next";

import { CandidatesView } from "@/components/candidates-view";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Candidates" };

export default async function CandidatesPage({ searchParams }: PageProps<"/candidates">) {
  const { open } = await searchParams;
  const openId = Number(Array.isArray(open) ? open[0] : open);
  return (
    <>
      <PageHeader
        title="Candidates"
        description="Upload resumes and the Resume Parser agent turns them into structured profiles."
      />
      <CandidatesView initialOpenId={Number.isInteger(openId) && openId > 0 ? openId : null} />
    </>
  );
}
