import { ClipboardCheck, Layers, Package, Pencil, Plus, Trash2, Wallet } from "lucide-react";
import type { ProjectDetail } from "@/lib/projectQuery";
import type { BomCost } from "@/lib/bom";
import { cn, formatCurrency } from "@/lib/utils";
import { deleteWorkItem } from "@/actions/workItems";
import { FormDialog } from "@/components/FormDialog";
import { Button } from "@/components/ui/button";
import { BomFormDialog } from "@/components/projects/bom/BomFormDialog";
import { WorkItemDialog } from "@/components/projects/bom/WorkItemDialog";
import { BomRow } from "@/components/projects/bom/BomRow";
import { BOM_GRID } from "@/components/projects/bom/grid";

const iconButton =
  "flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40";

export function BomTab({ project, costs }: { project: ProjectDetail; costs: Record<string, BomCost> }) {
  const workItems = project.workItems.map((w) => ({ id: w.id, name: w.name }));
  const isPriced = (b: ProjectDetail["bomItems"][number]) => costs[b.id]?.priced ?? false;
  const readyWork = project.workItems.filter((w) => {
    const lines = project.bomItems.filter((b) => b.workItemId === w.id);
    return lines.length > 0 && lines.every(isPriced);
  }).length;
  const pendingWork = project.workItems.length - readyWork;
  const hasDraft = project.quotations.some((q) => q.status === "DRAFT");
  const signedBomIds = new Set(
    project.quotations.filter((q) => q.status === "ACCEPTED").flatMap((q) => q.lineItems.map((l) => l.bomItemId).filter(Boolean))
  );
  const poBomIds = new Set(project.purchaseOrders.map((p) => p.rfq?.bomItemId).filter(Boolean));

  const total = project.bomItems.reduce((s, b) => s + (costs[b.id]?.cost ?? b.estTotal), 0);
  const selfCount = project.bomItems.filter((b) => b.performedBy === "SELF").length;
  const outsourcedCount = project.bomItems.length - selfCount;
  const ungrouped = project.bomItems.filter((b) => !b.workItemId);
  const emptyWork = project.workItems.filter((w) => !project.bomItems.some((b) => b.workItemId === w.id)).length;
  const awaitingVendor = project.bomItems.filter((b) => b.performedBy !== "SELF" && !costs[b.id]?.priced).length;
  const issues = [
    project.bomItems.length === 0 ? "no BOM lines yet" : null,
    emptyWork > 0 ? `${emptyWork} empty work ${emptyWork === 1 ? "item" : "items"}` : null,
    awaitingVendor > 0 ? `${awaitingVendor} awaiting a vendor quote` : null,
    ungrouped.length > 0 ? `${ungrouped.length} not under a work item` : null,
  ].filter(Boolean) as string[];

  const rowProps = { projectId: project.id, workItems, hasDraft };
  const toRow = (b: ProjectDetail["bomItems"][number]) => ({
    bom: {
      id: b.id,
      workItemId: b.workItemId,
      workPackage: b.workPackage,
      description: b.description,
      qty: b.qty,
      unit: b.unit,
      unitCost: b.unitCost,
      estTotal: b.estTotal,
      performedBy: b.performedBy,
      materials: b.materials.map((m) => ({ id: m.id, name: m.name, qty: m.qty, unit: m.unit, unitCost: m.unitCost, total: m.total })),
    },
    cost: costs[b.id]?.cost ?? b.estTotal,
    source: costs[b.id]?.source,
    locked: poBomIds.has(b.id),
    inSigned: signedBomIds.has(b.id),
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Work items and BOM</h2>
          <p className="max-w-3xl text-sm text-muted-foreground">
            A <span className="font-medium text-foreground">work item</span> is a room or scope, like Kitchen. The <span className="font-medium text-foreground">BOM lines</span> inside it are the jobs, like tiling, cabinets and painting. Every line is priced here, and this is the single source for RFQs, POs and the quotation.
          </p>
        </div>
        <WorkItemDialog
          projectId={project.id}
          trigger={
            <Button>
              <Plus className="h-4 w-4" />
              Work item
            </Button>
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={Layers} label="Work items" value={String(project.workItems.length)} sub="Rooms / scopes" />
        <Stat icon={Package} label="BOM lines" value={String(project.bomItems.length)} sub={`${selfCount} self-performed, ${outsourcedCount} outsourced`} />
        <Stat icon={Wallet} label="Direct cost" value={formatCurrency(total)} sub="Total cost, before markup" />
        <Stat
          icon={ClipboardCheck}
          label="Ready to quote"
          value={`${readyWork} / ${project.workItems.length}`}
          sub="Work items completed"
          pill={pendingWork > 0 ? `${pendingWork} pending` : undefined}
          note={issues.length > 0 ? issues.join(", ") : undefined}
          good={issues.length === 0 && project.workItems.length > 0}
        />
      </div>

      {project.workItems.length === 0 && ungrouped.length === 0 && (
        <div className="rounded-xl border border-dashed bg-card px-6 py-14 text-center">
          <Layers className="mx-auto h-8 w-8 text-muted-foreground" />
          <h3 className="mt-3 font-semibold">Start with a work item</h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            For example &quot;Kitchen&quot;. Under it you add the lines of work: demolition, cabinets, tiling, painting.
          </p>
        </div>
      )}

      {project.workItems.map((w) => {
        const lines = project.bomItems.filter((b) => b.workItemId === w.id);
        const subtotal = lines.reduce((s, b) => s + (costs[b.id]?.cost ?? b.estTotal), 0);
        const ready = lines.length > 0 && lines.every(isPriced);
        const reason = lines.length === 0 ? "No BOM lines yet" : "Some lines are not priced yet";
        const lockedReason = lines.some((b) => poBomIds.has(b.id)) ? "A line here already has a purchase order" : null;
        return (
          <section key={w.id} className="overflow-hidden rounded-xl border bg-card shadow-sm">
            <header className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Layers className="h-6 w-6" />
              </span>
              <div className="min-w-0 flex-1 basis-48">
                <h3 className="text-lg font-semibold tracking-tight">{w.name}</h3>
                <p className="truncate text-sm text-muted-foreground">
                  {w.description || `${lines.length} ${lines.length === 1 ? "line" : "lines"}`}
                </p>
              </div>
              <div className="text-right">
                <div className="text-xs text-muted-foreground">Subtotal (Direct cost)</div>
                <div className="text-xl font-semibold tabular-nums">{formatCurrency(subtotal)}</div>
              </div>
              <span
                title={ready ? undefined : reason}
                className={cn("rounded-full px-3 py-1 text-xs font-medium", ready ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800")}
              >
                {ready ? "Ready to quote" : "Needs attention"}
              </span>
              <div className="flex items-center gap-1">
                <WorkItemDialog
                  projectId={project.id}
                  workItem={{ id: w.id, name: w.name, description: w.description }}
                  trigger={
                    <button className={iconButton} aria-label={`Edit ${w.name}`} title="Edit work item">
                      <Pencil className="h-4 w-4" />
                    </button>
                  }
                />
                <FormDialog
                  destructive
                  title={`Delete "${w.name}"?`}
                  description={
                    lines.length > 0
                      ? `This also deletes its ${lines.length} BOM ${lines.length === 1 ? "line" : "lines"}, any RFQs on them, and removes them from the draft quotation.`
                      : "This work item is empty. It will be removed."
                  }
                  submitLabel="Delete work item"
                  pendingLabel="Deleting..."
                  action={deleteWorkItem.bind(null, w.id)}
                  trigger={
                    <button className={cn(iconButton, "hover:bg-red-50 hover:text-red-600")} aria-label={`Delete ${w.name}`} title={lockedReason ?? "Delete work item"}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  }
                />
              </div>
              <BomFormDialog
                projectId={project.id}
                workItems={workItems}
                defaultWorkItemId={w.id}
                hasDraftQuotation={hasDraft}
                trigger={
                  <Button>
                    <Plus className="h-4 w-4" />
                    BOM line
                  </Button>
                }
              />
            </header>

            {lines.length === 0 ? (
              <p className="border-t px-4 py-8 text-center text-sm text-muted-foreground">No BOM lines yet. Add the first one to price this work item.</p>
            ) : (
              <div className="px-4 pb-4">
                <div className="overflow-hidden rounded-lg border">
                  <div className={cn("hidden gap-x-4 bg-muted/40 px-4 py-2.5 text-xs font-medium text-muted-foreground md:grid", BOM_GRID)}>
                    <span>Job name</span>
                    <span>Type</span>
                    <span>Quantity &amp; rate</span>
                    <span>Direct cost</span>
                    <span>Labour + materials</span>
                    <span />
                  </div>
                  <ul className="divide-y">
                    {lines.map((b) => (
                      <BomRow key={b.id} {...rowProps} {...toRow(b)} />
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </section>
        );
      })}

      {ungrouped.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-amber-300 bg-amber-50/50">
          <header className="border-b border-amber-200 px-4 py-3">
            <h3 className="font-semibold text-amber-900">Not under a work item</h3>
            <p className="text-xs text-amber-800">Edit each line and choose its work item. Quotations only include lines that belong to one.</p>
          </header>
          <ul className="divide-y bg-card">
            {ungrouped.map((b) => (
              <BomRow key={b.id} {...rowProps} {...toRow(b)} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  sub,
  pill,
  note,
  good,
}: {
  icon: typeof Layers;
  label: string;
  value: string;
  sub: string;
  pill?: string;
  note?: string;
  good?: boolean;
}) {
  return (
    <div className="flex items-start gap-4 rounded-xl border bg-card p-5 shadow-sm">
      <span className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-xl", good ? "bg-emerald-100 text-emerald-700" : "bg-primary/10 text-primary")}>
        <Icon className="h-6 w-6" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <span className="text-sm font-medium">{label}</span>
          {pill && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">{pill}</span>}
        </div>
        <div className="mt-1 whitespace-nowrap text-2xl font-bold tracking-tight tabular-nums">{value}</div>
        <div className="text-xs text-muted-foreground">{sub}</div>
        {note && <div className="mt-1 text-xs text-amber-700">{note}</div>}
      </div>
    </div>
  );
}
