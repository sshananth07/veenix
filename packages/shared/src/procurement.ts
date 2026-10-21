import type { ProjectCore } from "./dto";

type Rfq = ProjectCore["rfqs"][number];
type Po = ProjectCore["purchaseOrders"][number];

export type PackageStage = "REQUEST" | "AWAITING" | "COMPARE" | "PAYING" | "DONE";

export function getPackageStage(rfq: Rfq | undefined, po: Po | undefined): PackageStage {
  if (po) return po.milestones.length > 0 && po.milestones.every((m) => m.status === "PAID") ? "DONE" : "PAYING";
  const quotes = rfq?.quotes ?? [];
  if (quotes.length === 0) return "REQUEST";
  return quotes.some((q) => q.receivedAt) ? "COMPARE" : "AWAITING";
}

export function getPackages(project: ProjectCore) {
  return project.bomItems
    .filter((b) => b.performedBy !== "SELF")
    .map((bom) => {
      const rfq = project.rfqs.find((r) => r.bomItemId === bom.id);
      const po = rfq ? project.purchaseOrders.find((p) => p.rfqId === rfq.id) : undefined;
      return { bom, rfq, po, stage: getPackageStage(rfq, po) };
    });
}