import type { Metadata } from "next";

import { KanbanBoard } from "@/components/kanban-board";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Pipeline" };

export default function PipelinePage() {
  return (
    <>
      <PageHeader
        title="Pipeline"
        description="Drag candidates between stages. Cards are ranked by match score for the selected job."
      />
      <KanbanBoard />
    </>
  );
}
