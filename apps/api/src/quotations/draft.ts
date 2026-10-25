import { Types } from "mongoose";
import { bomCosts, quotationReadiness, withMarkup, type Blocker, type BomItemDto, type WorkItemDto } from "@veenix/shared";
import { plain } from "../common/plain";
import { nextCode } from "../counters/counters";
import { loadOrg } from "../orgs/org.model";
import type { ProjectDoc } from "../projects/project.model";
import { QuotationModel, type QuotationDoc } from "./quotation.model";

export function readinessOf(project: ProjectDoc) {
  return quotationReadiness(plain<WorkItemDto[]>(project.workItems), plain<BomItemDto[]>(project.bomItems));
}

export function readinessError(blockers: Blocker[]) {
  return `Not ready to quote yet: ${blockers[0].message}${blockers.length > 1 ? ` (+${blockers.length - 1} more)` : ""}`;
}

/** Rewrites a draft's lines from the live BOM: priced lines only, in work-item order, keeping any markup already set. */
function fill(quotation: QuotationDoc, project: ProjectDoc, markups: Map<string, number>, defaultMarkup: number) {
  const bomItems = plain<BomItemDto[]>(project.bomItems);
  const costs = bomCosts(bomItems);
  const workItems = new Map(plain<WorkItemDto[]>(project.workItems).map((w) => [w.id, w]));
  const ready = bomItems
    .filter((b) => b.workItemId && workItems.has(b.workItemId) && costs[b.id].priced)
    .sort((a, b) => workItems.get(a.workItemId!)!.seq - workItems.get(b.workItemId!)!.seq || a.seq - b.seq);
  quotation.set(
    "lineItems",
    ready.map((b, i) => {
      const cost = costs[b.id].cost;
      const markupPct = markups.get(b.id) ?? defaultMarkup;
      return {
        bomItemId: new Types.ObjectId(b.id), workItemName: workItems.get(b.workItemId!)!.name, workPackage: b.workPackage,
        qty: b.qty, unit: b.unit, bomCost: cost, markupPct, clientPrice: withMarkup(cost, markupPct), seq: i,
      };
    }),
  );
}

const markupsOf = (q: QuotationDoc | null) => new Map((q?.lineItems ?? []).filter((l) => l.bomItemId).map((l) => [String(l.bomItemId), l.markupPct]));

/** Edits, deletions and newly priced work flow into the draft without a manual sync. */
export async function refreshDraftQuotation(project: ProjectDoc) {
  const draft = await QuotationModel.findOne({ projectId: project._id, status: "DRAFT" });
  if (!draft) return;
  fill(draft, project, markupsOf(draft), (await loadOrg()).defaultMarkupPct);
  await draft.save();
}

export async function createDraft(project: ProjectDoc, basedOn: QuotationDoc | null, defaultMarkup?: number) {
  const last = await QuotationModel.findOne({ projectId: project._id }).sort({ revision: -1 }).lean();
  const draft = new QuotationModel({
    code: await nextCode("QT"),
    projectId: project._id,
    revision: (last?.revision ?? 0) + 1,
    status: "DRAFT",
    events: [{ type: "CREATED", note: basedOn ? `Revised from Rev ${basedOn.revision}` : null }],
    terms: (basedOn?.terms ?? []).map((t) => ({ seq: t.seq, name: t.name, trigger: t.trigger, pct: t.pct })),
  });
  fill(draft, project, markupsOf(basedOn), defaultMarkup ?? (await loadOrg()).defaultMarkupPct);
  await draft.save();
  return draft;
}
