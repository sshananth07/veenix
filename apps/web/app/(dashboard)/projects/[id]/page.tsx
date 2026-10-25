import type { ProjectDetailDto } from "@veenix/shared";
import { api } from "@/lib/api";
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

export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { tab?: string; v?: string; view?: string; invoice?: string };
}) {
  const project = await api<ProjectDetailDto>(`/projects/${params.id}`);

  const tab: ProjectTabKey = PROJECT_TABS.find((t) => t.key === searchParams.tab)?.key ?? "overview";
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
      <ProjectHeader project={project} />
      <ProjectTabs projectId={project.id} active={tab} badges={badges} />

      <div className="pt-1">
        {tab === "overview" && <OverviewTab project={project} costs={costs} readiness={readiness} />}
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
