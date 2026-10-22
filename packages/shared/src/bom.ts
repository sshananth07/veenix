import { lineTotal, type Sen } from "./money";
import type { BomItemDto, WorkItemDto } from "./dto";

export function calcBomTotal(input: { qty: number; unitCost: Sen; materials?: { qty: number; unitCost: Sen }[] }) {
  const base = lineTotal(input.qty, input.unitCost);
  const materials = (input.materials ?? []).reduce((s, m) => s + lineTotal(m.qty, m.unitCost), 0);
  return { base, materials, total: base + materials };
}

export type BomCost = { cost: Sen; priced: boolean; source: "PO" | "SELF" | "ESTIMATE" };

// What the quotation is priced from: the awarded PO for outsourced work,
// the labour + materials roll-up for self-performed work.
export function bomCosts(bomItems: BomItemDto[]): Record<string, BomCost> {
  const costs: Record<string, BomCost> = {};
  for (const b of bomItems) {
    if (b.performedBy === "SELF") costs[b.id] = { cost: b.estTotal, priced: b.estTotal > 0, source: "SELF" };
    else if (b.awarded) costs[b.id] = { cost: b.awarded.amount, priced: true, source: "PO" };
    else costs[b.id] = { cost: b.estTotal, priced: false, source: "ESTIMATE" };
  }
  return costs;
}

export type Blocker = { message: string; tab: "bom" | "vendors" };
export type Readiness = { ready: boolean; blockers: Blocker[]; total: number; priced: number };

// A quotation can only be built once every line has a firm price. Same rules
// and messages as the old lib/bom.ts getQuotationReadiness.
export function quotationReadiness(workItems: WorkItemDto[], bomItems: BomItemDto[]): Readiness {
  const costs = bomCosts(bomItems);
  const lines = [...bomItems].sort((a, b) => a.seq - b.seq);
  const blockers: Blocker[] = [];
  if (lines.length === 0) blockers.push({ message: "Add at least one BOM line", tab: "bom" });
  for (const w of [...workItems].sort((a, b) => a.seq - b.seq)) {
    if (!lines.some((b) => b.workItemId === w.id)) blockers.push({ message: `Work item "${w.name}" has no BOM lines yet`, tab: "bom" });
  }
  for (const b of lines) {
    if (!b.workItemId) blockers.push({ message: `"${b.workPackage}" is not under a work item`, tab: "bom" });
    else if (b.performedBy === "SELF" && !costs[b.id].priced) blockers.push({ message: `"${b.workPackage}" has no cost`, tab: "bom" });
    else if (b.performedBy !== "SELF" && !costs[b.id].priced)
      blockers.push({ message: `"${b.workPackage}" is waiting for an accepted vendor quote`, tab: "vendors" });
  }
  return { ready: blockers.length === 0, blockers, total: lines.length, priced: Object.values(costs).filter((c) => c.priced).length };
}
