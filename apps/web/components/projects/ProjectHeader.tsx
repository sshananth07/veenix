import { Building2, Check, Home, MapPin } from "lucide-react";
import type { MemberDto } from "@veenix/shared";
import type { ProjectDetail } from "@/lib/projectQuery";
import { cn, formatDate, toDateInput } from "@/lib/utils";
import { PROJECT_STAGE_LABEL } from "@/lib/types";

import { StatusBadge } from "@/components/StatusBadge";
import { EditProjectDialog } from "@/components/projects/EditProjectDialog";
import { TeamDialog } from "@/components/projects/TeamDialog";

const JOURNEY = ["SITE_VISIT", "QUOTING", "WORK_IN_PROGRESS", "COMPLETED"] as const;
type Stage = (typeof JOURNEY)[number];

// One line under each stage: the date it was reached once done, where it
// stands while current, "Pending" until then.
function stageDetail(stage: Stage, project: ProjectDetail, state: "done" | "current" | "pending") {
  if (state === "pending") return "Pending";
  const signed = project.quotations.find((q) => q.status === "ACCEPTED");
  const open = project.quotations.find((q) => ["SENT", "VIEWED", "QUESTIONED"].includes(q.status));
  const draft = project.quotations.find((q) => q.status === "DRAFT");
  const first = project.quotations[0];
  const paid = project.milestones.filter((m) => m.status === "PAID").length;

  if (state === "done") {
    switch (stage) {
      case "SITE_VISIT":
        return formatDate(project.surveyAt ?? project.createdAt);
      case "QUOTING":
        return signed?.acceptedAt ? formatDate(signed.acceptedAt) : first ? formatDate(first.sentAt ?? first.createdAt) : "Done";
      default:
        return "Done";
    }
  }

  switch (stage) {
    case "SITE_VISIT":
      return project.surveyAt ? `Survey ${formatDate(project.surveyAt)}` : "Survey and scope";
    case "QUOTING":
      return open ? `Rev ${open.revision} with client` : draft ? `Rev ${draft.revision} draft` : "Price and quote";
    case "WORK_IN_PROGRESS":
      return project.milestones.length > 0 ? `${paid} of ${project.milestones.length} payments received` : "Current";
    case "COMPLETED":
      return "Handover";
  }
}

/** `members` is passed only to roles that can assign the project team. */
export function ProjectHeader({ project, members }: { project: ProjectDetail; members?: MemberDto[] }) {
  const stageIndex = JOURNEY.indexOf(project.stage as Stage);
  const cancelled = project.stage === "CANCELLED";
  const completed = project.stage === "COMPLETED";
  const place = [project.city, project.state].filter(Boolean).join(", ") || project.siteAddress;
  const property = [project.propertyType, project.builtUpArea].filter(Boolean).join(", ");

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          {project.photoPath ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/uploads/photo/${project.id}?v=${encodeURIComponent(project.photoPath)}`}
              alt=""
              className="h-[74px] w-[100px] shrink-0 rounded-lg border object-cover shadow-xs"
            />
          ) : (
            <div className="flex h-[74px] w-[100px] shrink-0 items-center justify-center rounded-lg border bg-muted/50 text-muted-foreground">
              <Building2 className="h-7 w-7" />
            </div>
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
              <StatusBadge status={project.stage} />
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              {property && (
                <span className="inline-flex items-center gap-1.5">
                  <Home className="h-4 w-4" />
                  {property}
                </span>
              )}
              {property && place && <span aria-hidden className="hidden sm:inline">•</span>}
              {place && (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="h-4 w-4" />
                  {place}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
        {members && <TeamDialog project={project} members={members} />}
        <EditProjectDialog
          project={{
            id: project.id,
            name: project.name,
            clientName: project.clientName,
            clientPhone: project.clientPhone,
            clientEmail: project.clientEmail,
            clientTin: project.clientTin,
            clientIdType: project.clientIdType,
            clientIdNo: project.clientIdNo,
            addressLine1: project.addressLine1,
            addressLine2: project.addressLine2,
            addressLine3: project.addressLine3,
            postcode: project.postcode,
            city: project.city,
            state: project.state,
            siteAddress: project.siteAddress,
            photoPath: project.photoPath,
            propertyType: project.propertyType,
            builtUpArea: project.builtUpArea,
            budgetMin: project.budgetMin,
            budgetMax: project.budgetMax,
            pmName: project.pmName,
            siteName: project.siteName,
            stage: project.stage,
            cancelReason: project.cancelReason,
            targetStart: toDateInput(project.targetStart),
            targetHandover: toDateInput(project.targetHandover),
          }}
        />
        </div>
      </div>

      {cancelled ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-3 text-sm text-red-800">
          Cancelled{project.cancelReason ? `: ${project.cancelReason}` : ""}
        </div>
      ) : (
        <ol className="grid grid-cols-4 rounded-xl border bg-card px-3 py-6 shadow-xs sm:px-6" aria-label="Project stage">
          {JOURNEY.map((stage, i) => {
            const done = i < stageIndex || completed;
            const current = i === stageIndex && !completed;
            const state = done ? "done" : current ? "current" : "pending";
            return (
              <li key={stage} className="relative flex flex-col items-center px-1 text-center">
                {i < JOURNEY.length - 1 && (
                  <span
                    aria-hidden
                    className={cn("absolute left-[calc(50%+28px)] right-[calc(-50%+28px)] top-[21px] h-0.5 rounded-full", i < stageIndex || completed ? "bg-emerald-500" : "bg-border")}
                  />
                )}
                <span
                  className={cn(
                    "relative z-10 flex h-11 w-11 items-center justify-center rounded-full text-base font-semibold",
                    done && "bg-emerald-500 text-white",
                    current && "bg-primary text-primary-foreground ring-4 ring-primary/15",
                    !done && !current && "bg-muted text-muted-foreground"
                  )}
                >
                  {done ? <Check className="h-5 w-5" strokeWidth={3} /> : i + 1}
                </span>
                <div className={cn("mt-2.5 text-sm", current ? "font-semibold" : "font-medium")}>{PROJECT_STAGE_LABEL[stage]}</div>
                <div className={cn("text-xs", current ? "font-medium text-primary" : "text-muted-foreground")}>{stageDetail(stage, project, state)}</div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
