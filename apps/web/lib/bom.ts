import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";

export type BomCost = { cost: number; priced: boolean; source: "PO" | "SELF" | "ESTIMATE" };

// The number the quotation is priced from: the awarded PO for outsourced
// work, the labour + materials roll-up for self-performed work.
export async function getBomCosts(projectId: string) {
  const [bomItems, pos] = await Promise.all([
    prisma.bomItem.findMany({ where: { projectId } }),
    prisma.purchaseOrder.findMany({ where: { projectId }, include: { rfq: true } }),
  ]);
  const poByBom = new Map(pos.filter((p) => p.rfq).map((p) => [p.rfq!.bomItemId, p]));
  const costs = new Map<string, BomCost>();
  for (const b of bomItems) {
    if (b.performedBy === "SELF") {
      costs.set(b.id, { cost: b.estTotal, priced: b.estTotal > 0, source: "SELF" });
    } else {
      const po = poByBom.get(b.id);
      costs.set(b.id, po ? { cost: po.amount, priced: true, source: "PO" } : { cost: b.estTotal, priced: false, source: "ESTIMATE" });
    }
  }
  return costs;
}

export type Blocker = { message: string; tab: "bom" | "vendors" };

// A quotation can only be built once every line has a firm price: a vendor
// quote accepted for outsourced work, a costed labour + materials line for
// self-performed work, and no empty work items.
export async function getQuotationReadiness(projectId: string) {
  const [workItems, bomItems, costs] = await Promise.all([
    prisma.workItem.findMany({ where: { projectId }, include: { bomItems: true }, orderBy: { seq: "asc" } }),
    prisma.bomItem.findMany({ where: { projectId }, orderBy: { seq: "asc" } }),
    getBomCosts(projectId),
  ]);

  const blockers: Blocker[] = [];
  if (bomItems.length === 0) blockers.push({ message: "Add at least one BOM line", tab: "bom" });
  for (const w of workItems) {
    if (w.bomItems.length === 0) blockers.push({ message: `Work item "${w.name}" has no BOM lines yet`, tab: "bom" });
  }
  for (const b of bomItems) {
    if (!b.workItemId) blockers.push({ message: `"${b.workPackage}" is not under a work item`, tab: "bom" });
    else if (b.performedBy === "SELF" && !costs.get(b.id)?.priced) blockers.push({ message: `"${b.workPackage}" has no cost`, tab: "bom" });
    else if (b.performedBy !== "SELF" && !costs.get(b.id)?.priced)
      blockers.push({ message: `"${b.workPackage}" is waiting for an accepted vendor quote`, tab: "vendors" });
  }
  return { ready: blockers.length === 0, blockers, total: bomItems.length, priced: [...costs.values()].filter((c) => c.priced).length };
}

// Why a BOM line cannot be removed, or null if it can.
export async function bomDeleteBlocker(bomItemId: string) {
  const po = await prisma.purchaseOrder.findFirst({ where: { rfq: { bomItemId } } });
  if (po) return `already has purchase order ${po.code}`;
  const signed = await prisma.quotationLineItem.findFirst({ where: { bomItemId, quotation: { status: "ACCEPTED" } } });
  if (signed) return "is part of the signed quotation, so removing it needs a Variation Order";
  return null;
}

function nextQuotationCode(count: number) {
  return `QT-${new Date().getFullYear()}-${String(count + 1).padStart(4, "0")}`;
}

async function uniqueQuotationCode() {
  let n = await prisma.quotation.count();
  let code = nextQuotationCode(n);
  while (await prisma.quotation.findUnique({ where: { code } })) code = nextQuotationCode(++n);
  return code;
}

// Rewrites a draft's lines from the live BOM: priced lines only, in work
// item order, carrying over any markup already set. Edits, deletions and
// newly priced work therefore flow into the draft without a manual sync.
export async function fillQuotationFromBom(
  quotationId: string,
  projectId: string,
  markups: Map<string, number>,
  defaultMarkup?: number
) {
  const settings = await getSettings();
  const [bomItems, costs] = await Promise.all([
    prisma.bomItem.findMany({ where: { projectId }, include: { workItem: true } }),
    getBomCosts(projectId),
  ]);
  const ready = bomItems
    .filter((b) => b.workItemId && costs.get(b.id)?.priced)
    .sort((a, b) => (a.workItem!.seq - b.workItem!.seq) || a.seq - b.seq);

  await prisma.$transaction([
    prisma.quotationLineItem.deleteMany({ where: { quotationId } }),
    ...ready.map((b, i) => {
      const cost = costs.get(b.id)!.cost;
      const markupPct = markups.get(b.id) ?? defaultMarkup ?? settings.defaultMarkupPct;
      return prisma.quotationLineItem.create({
        data: {
          quotationId,
          bomItemId: b.id,
          workItemName: b.workItem!.name,
          workPackage: b.workPackage,
          qty: b.qty,
          unit: b.unit,
          bomCost: cost,
          markupPct,
          clientPrice: Math.round(cost * (1 + markupPct / 100)),
          seq: i,
        },
      });
    }),
  ]);
}

export async function refreshDraftQuotation(projectId: string) {
  const draft = await prisma.quotation.findFirst({ where: { projectId, status: "DRAFT" }, include: { lineItems: true } });
  if (!draft) return;
  const markups = new Map(draft.lineItems.filter((l) => l.bomItemId).map((l) => [l.bomItemId!, l.markupPct]));
  await fillQuotationFromBom(draft.id, projectId, markups);
}

export async function createDraftQuotation(projectId: string, basedOnId?: string, defaultMarkup?: number) {
  const previous = basedOnId
    ? await prisma.quotation.findUnique({ where: { id: basedOnId }, include: { lineItems: true, terms: { orderBy: { seq: "asc" } } } })
    : null;
  const last = await prisma.quotation.findFirst({ where: { projectId }, orderBy: { revision: "desc" } });
  const quotation = await prisma.quotation.create({
    data: {
      code: await uniqueQuotationCode(),
      projectId,
      revision: (last?.revision ?? 0) + 1,
      status: "DRAFT",
      events: { create: [{ type: "CREATED", note: previous ? `Revised from Rev ${previous.revision}` : null }] },
      terms: { create: (previous?.terms ?? []).map((t) => ({ seq: t.seq, name: t.name, trigger: t.trigger, pct: t.pct })) },
    },
  });
  const markups = new Map((previous?.lineItems ?? []).filter((l) => l.bomItemId).map((l) => [l.bomItemId!, l.markupPct]));
  await fillQuotationFromBom(quotation.id, projectId, markups, defaultMarkup);
  return quotation;
}
