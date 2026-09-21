import { notFound } from "next/navigation";

import { JobStudio } from "@/components/job-studio";

export default async function JobPage({ params, searchParams }: PageProps<"/jobs/[id]">) {
  const { id } = await params;
  const jobId = Number(id);
  if (!Number.isInteger(jobId) || jobId < 1) notFound();

  const { generate } = await searchParams;
  return <JobStudio jobId={jobId} autoGenerate={generate === "1"} />;
}
