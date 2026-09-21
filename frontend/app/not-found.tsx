import Link from "next/link";
import { SearchX } from "lucide-react";

import { EmptyState } from "@/components/states";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <EmptyState
      icon={SearchX}
      title="Page not found"
      description="That page or record does not exist. It may have been deleted."
      action={
        <Link href="/" className={buttonVariants({ variant: "outline" })}>
          Back to dashboard
        </Link>
      }
    />
  );
}
