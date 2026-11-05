import Link from "next/link";
import { Ban, CalendarCheck2, CheckCircle2, FileSignature, MapPin, Search } from "lucide-react";
import type { ProjectListItemDto } from "@veenix/shared";
import { api } from "@/lib/api";
import { Avatar } from "@/components/ui/avatar";
import { cn, formatCurrency } from "@/lib/utils";
import { PROJECT_STAGES, PROJECT_STAGE_LABEL, type ProjectStage } from "@/lib/types";

function daysInStage(date: Date) {
  return Math.floor((Date.now() - date.getTime()) / 86_400_000);
}

const STAGE_ICON: Record<ProjectStage, typeof Search> = {
  SITE_VISIT: Search,
  QUOTING: FileSignature,
  WORK_IN_PROGRESS: CalendarCheck2,
  COMPLETED: CheckCircle2,
  CANCELLED: Ban,
};

const STAGE_ACCENT: Record<ProjectStage, string> = {
  SITE_VISIT: "bg-primary",
  QUOTING: "bg-amber-400",
  WORK_IN_PROGRESS: "bg-primary",
  COMPLETED: "bg-emerald-500",
  CANCELLED: "bg-rose-400",
};

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const projects = await api<ProjectListItemDto[]>("/projects");

  const columns = PROJECT_STAGES.map((stage) => ({
    stage,
    projects: projects.filter((p) => p.stage === stage),
  }));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Projects</h1>
        <p className="mt-1 text-muted-foreground">
          {projects.length} total — every job, one board
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 @5xl:grid-cols-5">
        {columns.map(({ stage, projects: colProjects }) => {
          const Icon = STAGE_ICON[stage];
          return (
            <div key={stage} className="flex flex-col gap-3 rounded-xl border bg-muted/30 p-3">
              <div className="flex items-center gap-2 px-1">
                <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-card shadow-xs", stage === "CANCELLED" ? "text-rose-600" : stage === "COMPLETED" ? "text-emerald-600" : "text-primary")}>
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <h2 className="flex-1 text-sm font-semibold">{PROJECT_STAGE_LABEL[stage]}</h2>
                <span className="rounded-full bg-card px-2 py-0.5 text-xs font-semibold text-muted-foreground shadow-xs">{colProjects.length}</span>
              </div>

              <div className="flex flex-col gap-2.5">
                {colProjects.map((p) => {
                  const billed = p.milestones.filter((m) => m.status === "PAID").reduce((s, m) => s + m.amount, 0);
                  const isWip = p.stage === "WORK_IN_PROGRESS";
                  const pctBilled = isWip && p.contractValue > 0 ? Math.round((billed / p.contractValue) * 100) : null;
                  const place = p.city ?? p.siteAddress.split(",")[0];
                  return (
                    <Link
                      key={p.id}
                      href={`/projects/${p.id}`}
                      className="group flex flex-col gap-2.5 overflow-hidden rounded-xl border bg-card p-3.5 shadow-xs transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
                    >
                      <span className={cn("-mx-3.5 -mt-3.5 mb-0.5 h-1", STAGE_ACCENT[stage])} aria-hidden />
                      <div className="flex items-start gap-2.5">
                        <Avatar name={p.clientName} className="h-8 w-8 shrink-0 text-[11px]" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold leading-tight">{p.name.split(",")[0]}</div>
                          <div className="truncate text-xs text-muted-foreground">{p.clientName}</div>
                        </div>
                        {pctBilled !== null && (
                          <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold text-primary">{pctBilled}%</span>
                        )}
                      </div>

                      <div className="text-sm font-semibold tabular-nums">
                        {isWip ? `${formatCurrency(billed)} billed` : formatCurrency(p.contractValue)}
                      </div>
                      {isWip && p.contractValue > 0 && (
                        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(100, pctBilled ?? 0)}%` }} />
                        </div>
                      )}

                      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                        {stage === "CANCELLED" && p.cancelReason ? (
                          <span className="truncate">{p.cancelReason}</span>
                        ) : (
                          <span className="inline-flex min-w-0 items-center gap-1">
                            <MapPin className="h-3 w-3 shrink-0" />
                            <span className="truncate">{place}</span>
                          </span>
                        )}
                        <span className="shrink-0 whitespace-nowrap">{daysInStage(p.stageEnteredAt)}d</span>
                      </div>
                    </Link>
                  );
                })}
                {colProjects.length === 0 && (
                  <div className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">No jobs</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
