import type { Metadata } from "next";

import { AgentsView } from "@/components/agents-view";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Live agents" };

export default function AgentsPage() {
  return (
    <>
      <PageHeader
        title="Live agents"
        description="Watch the agents work. Every glowing node is a real call to the model, streamed as it happens."
      />
      <AgentsView />
    </>
  );
}
