"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Briefcase, FlaskConical, Kanban, LayoutDashboard, ListChecks, Search, Sparkles, Users } from "lucide-react";

import { OPEN_ASK_EVENT } from "@/components/ask-palette";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/jobs", label: "Jobs", icon: Briefcase },
  { href: "/candidates", label: "Candidates", icon: Users },
  { href: "/screening", label: "Screening", icon: ListChecks },
  { href: "/pipeline", label: "Pipeline", icon: Kanban },
  { href: "/agents", label: "Live agents", icon: Activity },
  { href: "/evaluation", label: "Evaluation", icon: FlaskConical },
];

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
      <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
        <Sparkles className="size-4" />
      </span>
      AI Recruiter
    </Link>
  );
}

export function AppSidebar() {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <>
      {/* Desktop: fixed sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r bg-sidebar p-4 md:flex">
        <Brand />
        <nav className="mt-8 flex flex-1 flex-col gap-1" aria-label="Main">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={isActive(href) ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive(href)
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon className="size-4" />
              {label}
            </Link>
          ))}
        </nav>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event(OPEN_ASK_EVENT))}
          className="mb-3 flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <Search className="size-4" />
          <span className="flex-1">Ask HR</span>
          <kbd className="rounded border bg-muted px-1.5 text-[10px] font-medium">Ctrl K</kbd>
        </button>
        <div className="flex items-center justify-between border-t pt-3">
          <span className="text-xs text-muted-foreground">Theme</span>
          <ThemeToggle />
        </div>
      </aside>

      {/* Mobile: brand and actions on one row, the menu as a scrollable strip below (nine items do not fit in one row). */}
      <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur md:hidden">
        <div className="flex items-center justify-between gap-2 px-4 py-2">
          <Brand />
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Ask HR"
              onClick={() => window.dispatchEvent(new Event(OPEN_ASK_EVENT))}
              className="rounded-lg p-2 text-muted-foreground transition-colors"
            >
              <Search className="size-4" />
            </button>
            <ThemeToggle />
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2" aria-label="Main">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={isActive(href) ? "page" : undefined}
              className={cn(
                "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
                isActive(href) ? "bg-primary/10 text-primary" : "text-muted-foreground",
              )}
            >
              <Icon className="size-3.5" />
              {label}
            </Link>
          ))}
        </nav>
      </header>
    </>
  );
}
