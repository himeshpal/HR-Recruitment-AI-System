import type { Metadata } from "next";

import { EvaluationView } from "@/components/evaluation-view";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Evaluation" };

export default function EvaluationPage() {
  return (
    <>
      <PageHeader
        title="Evaluation"
        description="How we know it works: the results of the automated checks that run the real agents."
      />
      <EvaluationView />
    </>
  );
}
