import { DashboardOverview } from "@/components/dashboard-overview";
import { PageHeader } from "@/components/page-header";
import { SystemStatus } from "@/components/system-status";

export default function Home() {
  return (
    <>
      <PageHeader title="Dashboard" description="Agent-based hiring, from job description to offer." />
      <div className="space-y-6">
        <DashboardOverview />
        <SystemStatus />
      </div>
    </>
  );
}
