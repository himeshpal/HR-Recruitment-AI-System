"use client";

import { useEffect } from "react";

import { ErrorState } from "@/components/states";

// One boundary for every route: an unexpected crash shows a friendly message instead of a blank page.
export default function RouteError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return <ErrorState message="This page hit an unexpected problem. You can try again." onRetry={retry} />;
}
