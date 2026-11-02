import Link from "next/link";
import { PROJECT_TABS, type ProjectTabKey } from "@/lib/projectQuery";
import { cn } from "@/lib/utils";

// Tabs are plain links (?tab=...) so every tab is deep-linkable, the Overview
// cards can jump straight into one, and the back button is not filled with
// tab clicks (they replace the history entry).
export function ProjectTabs({
  projectId,
  active,
  badges,
}: {
  projectId: string;
  active: ProjectTabKey;
  badges: Partial<Record<ProjectTabKey, { text: string; tone: "info" | "alert" }>>;
}) {
  return (
    <nav aria-label="Project sections" className="overflow-x-auto rounded-xl border bg-card shadow-xs">
      <ul className="flex min-w-max gap-1 p-1">
        {PROJECT_TABS.map((tab) => {
          const badge = badges[tab.key];
          const isActive = tab.key === active;
          return (
            <li key={tab.key}>
              <Link
                href={`/projects/${projectId}?tab=${tab.key}`}
                replace
                scroll={false}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "relative flex items-center gap-2 whitespace-nowrap rounded-lg px-4 py-2.5 text-sm font-medium transition-colors",
                  isActive ? "bg-primary/10 font-semibold text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {tab.label}
                {badge && (
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none",
                      badge.tone === "alert" ? "bg-amber-100 text-amber-800" : isActive ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
                    )}
                  >
                    {badge.text}
                  </span>
                )}
                {isActive && <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-primary" />}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
