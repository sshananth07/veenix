import { Lock } from "lucide-react";
import type { ProjectDetail } from "@/lib/projectQuery";
import { formatCurrency, formatDate } from "@/lib/utils";
import { StatusBadge } from "@/components/StatusBadge";
import { NewVoDialog } from "@/components/projects/vo/NewVoDialog";
import { VoDetailDrawer } from "@/components/projects/vo/VoDetailDrawer";

export function VariationOrdersTab({ project }: { project: ProjectDetail }) {
  const signed = project.quotations.find((q) => q.status === "ACCEPTED");

  if (!signed) {
    return (
      <div className="rounded-xl border border-dashed bg-card px-6 py-14 text-center">
        <Lock className="mx-auto h-8 w-8 text-muted-foreground" />
        <h3 className="mt-3 font-semibold">Variation orders start after the client signs</h3>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          Until then, scope changes simply go into a new version of the quotation. Once a quotation is signed, it is final and every change is a signed variation.
        </p>
      </div>
    );
  }

  const workItemName = new Map(project.workItems.map((w) => [w.id, w.name]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Variation Orders</h2>
          <p className="text-sm text-muted-foreground">
            Extra scope after {signed.code} Rev {signed.revision} was signed. Each one is priced, signed and dated before work changes.
          </p>
        </div>
        <NewVoDialog
          projectId={project.id}
          projectName={project.name}
          bomItems={project.bomItems.map((b) => ({
            id: b.id,
            workPackage: b.workPackage,
            workItemName: b.workItemId ? (workItemName.get(b.workItemId) ?? null) : null,
          }))}
        />
      </div>

      <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="bg-muted/30 text-left text-xs font-medium text-muted-foreground">
                <th className="px-5 py-2.5 font-medium">VO No.</th>
                <th className="px-2 py-2.5 font-medium">Date</th>
                <th className="px-2 py-2.5 font-medium">Description</th>
                <th className="px-2 py-2.5 text-right font-medium">Amount (RM)</th>
                <th className="px-2 py-2.5 font-medium">Status</th>
                <th className="px-5 py-2.5 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {project.variationOrders.map((vo) => (
                <tr key={vo.id}>
                  <td className="px-5 py-3 font-medium">{vo.code}</td>
                  <td className="px-2 py-3 text-muted-foreground">{formatDate(vo.raisedAt)}</td>
                  <td className="px-2 py-3">
                    <div className="font-medium">{vo.title || vo.description}</div>
                    {vo.bomItem && <div className="text-xs text-muted-foreground">On: {vo.bomItem.workPackage}</div>}
                  </td>
                  <td className="px-2 py-3 text-right tabular-nums">{formatCurrency(vo.amount).replace("RM ", "")}</td>
                  <td className="px-2 py-3">
                    <StatusBadge status={vo.status} />
                  </td>
                  <td className="px-5 py-3 text-right">
                    <VoDetailDrawer
                      vo={vo}
                      trigger={
                        <button className="text-sm font-medium text-primary hover:underline">View</button>
                      }
                    />
                  </td>
                </tr>
              ))}
              {project.variationOrders.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-sm text-muted-foreground">
                    No variation orders yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
