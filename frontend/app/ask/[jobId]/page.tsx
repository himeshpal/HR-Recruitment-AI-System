import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { QaView } from "@/components/qa-view";

export const metadata: Metadata = { title: "Candidate Q&A" };

export default async function AskPage({ params }: PageProps<"/ask/[jobId]">) {
  const { jobId } = await params;
  const id = Number(jobId);
  if (!Number.isInteger(id) || id < 1) notFound();
  return <QaView jobId={id} />;
}
