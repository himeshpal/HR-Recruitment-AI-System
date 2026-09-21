import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { InterviewRoom } from "@/components/interview-room";

export const metadata: Metadata = { title: "Interview" };

export default async function InterviewPage({ params }: PageProps<"/interview/[id]">) {
  const { id } = await params;
  const interviewId = Number(id);
  if (!Number.isInteger(interviewId) || interviewId < 1) notFound();
  return <InterviewRoom id={interviewId} />;
}
