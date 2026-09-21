import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ScreeningBoard } from "@/components/screening-board";

export const metadata: Metadata = { title: "Screening" };

export default async function ScreeningPage({ params }: PageProps<"/screening/[jobId]">) {
  const { jobId } = await params;
  const id = Number(jobId);
  if (!Number.isInteger(id) || id < 1) notFound();
  return <ScreeningBoard jobId={id} />;
}
