import { can, type MemberDto, type ProjectDetailDto, type SiteUpdateDto, type TaskDto } from "@veenix/shared";
import { api } from "@/lib/api";
import { requireOrg } from "@/lib/session";
import { LiveRefresh } from "@/components/LiveRefresh";
import { getPackages } from "@/lib/procurement";
import { PROJECT_TABS, type ProjectTabKey } from "@/lib/projectQuery";
import { BackButton } from "@/components/BackButton";
import { ProjectHeader } from "@/components/projects/ProjectHeader";
import { ProjectTabs } from "@/components/projects/ProjectTabs";
import { OverviewTab } from "@/components/projects/OverviewTab";
import { BomTab } from "@/components/projects/BomTab";
import { VendorsTab } from "@/components/projects/VendorsTab";
import { QuotationTab } from "@/components/projects/QuotationTab";
import { VariationOrdersTab } from "@/components/projects/VariationOrdersTab";
import { PaymentsTab } from "@/components/projects/PaymentsTab";
import { FilesTab } from "@/components/projects/FilesTab";
import { UpdatesTab } from "@/components/projects/UpdatesTab";

export default async function ProjectDetailPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; v?: string; view?: string; invoice?: string }> }) {
  const [params, searchParams] = await Promise.all([props.params, props.searchParams]);
  const { role } = await requireOrg();
  const [project, members] = await Promise.all([
    api<ProjectDetailDto>(`/projects/${params.id}`),
    can(role, "project:assign") ? api<MemberDto[]>("/org/members") : undefined,
  ]);

  const tab: ProjectTabKey = PROJECT_TABS.find((t) => t.key === searchParams.tab)?.key ?? "overview";
  const [updates, tasks] = tab === "updates"
    ? await Promise.all([api<SiteUpdateDto[]>(`/projects/${project.id}/updates`), api<TaskDto[]>(`/tasks?projectId=${project.id}`)])
    : [[], []];
  const { costs, readiness, pricing: settings } = project;

  const packages = getPackages(project);
  const toAccept = packages.filter((p) => p.stage === "COMPARE").length;
  const toRequest = packages.filter((p) => p.stage === "REQUEST").length;
  const draft = project.quotations.find((q) => q.status === "DRAFT");
  const pendingVos = project.variationOrders.filter((v) => v.status !== "ACCEPTED").length;

  const badges: Parameters<typeof ProjectTabs>[0]["badges"] = {
    bom: project.bomItems.length > 0 ? { text: String(project.bomItems.length), tone: "info" } : undefined,
    vendors: toAccept > 0 ? { text: `${toAccept} to accept`, tone: "alert" } : toRequest > 0 ? { text: `${toRequest} to request`, tone: "info" } : undefined,
    quotation: project.quotations.length > 0 ? { text: draft ? "Draft" : `Rev ${project.quotations[project.quotations.length - 1].revision}`, tone: "info" } : undefined,
    variations: pendingVos > 0 ? { text: String(pendingVos), tone: "alert" } : undefined,
  };

  return (
    <div className="space-y-5">
      <BackButton fallbackHref="/projects" label="Projects" />
      <LiveRefresh projectId={project.id} />
      <ProjectHeader project={project} members={members} />
      <ProjectTabs projectId={project.id} active={tab} badges={badges} />

      <div className="pt-1">
        {tab === "overview" && <OverviewTab project={project} costs={costs} readiness={readiness} />}
        {tab === "updates" && <UpdatesTab projectId={project.id} updates={updates} tasks={tasks} canWrite={can(role, "update:write")} canDeleteTasks={can(role, "task:write")} />}
        {tab === "bom" && <BomTab project={project} costs={costs} />}
        {tab === "vendors" && <VendorsTab project={project} />}
        {tab === "quotation" && (
          <QuotationTab
            project={project}
            costs={costs}
            readiness={readiness}
            settings={{ defaultMarkupPct: settings.defaultMarkupPct, minMarkupPct: settings.minMarkupPct }}
            selectedRevision={searchParams.v ? Number(searchParams.v) : null}
            clientView={searchParams.view === "client"}
          />
        )}
        {tab === "variations" && <VariationOrdersTab project={project} />}
        {tab === "payments" && <PaymentsTab project={project} selectedInvoiceId={searchParams.invoice ?? null} />}
        {tab === "files" && <FilesTab project={project} />}
      </div>
    </div>
  );
}
