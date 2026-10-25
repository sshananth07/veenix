import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";
import { calcBomTotal, lineTotal, WORK_UNITS, type BomItemInput } from "@veenix/shared";
import { findSub } from "../common/fields";
import { notFound, rule } from "../common/errors";
import { tx } from "../common/tx";
import { changed } from "../live/live";
import { PurchaseOrderModel } from "../procurement/purchase-order.model";
import { RfqModel } from "../procurement/rfq.model";
import { QuotationModel } from "../quotations/quotation.model";
import { refreshDraftQuotation } from "../quotations/draft";
import { VariationOrderModel } from "../variations/variation-order.model";
import { loadProject, loadProjectBy, type ProjectDoc } from "./project.model";

type Id = Types.ObjectId;

/** Why a BOM line can't be removed, or null if it can. Same messages as the old lib/bom.ts. */
async function deleteBlocker(projectId: Id, bomItemId: Id): Promise<string | null> {
  const rfq = await RfqModel.findOne({ projectId, bomItemId }).select("_id").lean();
  if (rfq) {
    const po = await PurchaseOrderModel.findOne({ rfqId: rfq._id }).select("code").lean();
    if (po) return `already has purchase order ${po.code}`;
  }
  if (await QuotationModel.exists({ projectId, status: "ACCEPTED", "lineItems.bomItemId": bomItemId })) {
    return "is part of the signed quotation, so removing it needs a Variation Order";
  }
  return null;
}

/** What Prisma's onDelete rules used to do (spec §5.3). */
async function cascade(projectId: Id, bomItemIds: Id[]) {
  await RfqModel.deleteMany({ projectId, bomItemId: { $in: bomItemIds } });
  await QuotationModel.updateMany(
    { projectId, "lineItems.bomItemId": { $in: bomItemIds } },
    { $set: { "lineItems.$[l].bomItemId": null } },
    { arrayFilters: [{ "l.bomItemId": { $in: bomItemIds } }] },
  );
  await VariationOrderModel.updateMany({ projectId, bomItemId: { $in: bomItemIds } }, { $set: { bomItemId: null } });
}

async function saveAndRefresh(project: ProjectDoc) {
  await project.save();
  await refreshDraftQuotation(project);
  changed({ kind: "project", projectId: String(project._id) });
}

const nameTaken = (project: ProjectDoc, name: string, exceptId?: Id) =>
  project.workItems.some((w) => !(exceptId && w._id.equals(exceptId)) && w.name.toLowerCase() === name.toLowerCase());

@Injectable()
export class BomService {
  async createWorkItem(projectId: Id, input: { name: string; description: string | null }) {
    await tx(async () => {
      const project = await loadProject(projectId);
      if (nameTaken(project, input.name)) throw rule(`"${input.name}" already exists on this project`);
      project.workItems.push({ seq: project.workItems.length + 1, ...input });
      await project.save();
      changed({ kind: "project", projectId: String(projectId) });
    });
  }

  async updateWorkItem(workItemId: Id, input: { name: string; description: string | null }) {
    await tx(async () => {
      const project = await loadProjectBy({ "workItems._id": workItemId }, "Work item");
      const item = findSub(project.workItems, workItemId)!;
      if (nameTaken(project, input.name, workItemId)) throw rule(`"${input.name}" already exists on this project`);
      item.set(input);
      await saveAndRefresh(project);
    });
  }

  /** Removes the work item and every BOM line under it. Refused if any line has a PO or is in the signed quotation. */
  async deleteWorkItem(workItemId: Id) {
    await tx(async () => {
      const project = await loadProjectBy({ "workItems._id": workItemId }, "Work item");
      const projectId = project._id;
      const lines = project.bomItems.filter((b) => b.workItemId?.equals(workItemId));
      for (const b of lines) {
        const blocker = await deleteBlocker(projectId, b._id);
        if (blocker) throw rule(`Cannot delete: "${b.workPackage}" ${blocker}.`);
      }
      await cascade(projectId, lines.map((b) => b._id));
      project.set("bomItems", project.bomItems.filter((b) => !b.workItemId?.equals(workItemId)));
      project.set("workItems", project.workItems.filter((w) => !w._id.equals(workItemId)));
      await saveAndRefresh(project);
    });
  }

  /** Create (bomItemId null) or edit a BOM line. The total is always recomputed here, never taken from the form. */
  async saveBomItem(projectId: Id, bomItemId: Id | null, input: BomItemInput) {
    await tx(async () => {
      const project = await loadProject(projectId);
      if (!findSub(project.workItems, input.workItemId)) throw rule("Choose a valid work item");
      const current = bomItemId ? findSub(project.bomItems, bomItemId) : undefined;
      if (bomItemId && !current) throw notFound("BOM line");
      // A unit outside the list is only allowed if the line already had it (old data).
      if (!WORK_UNITS.includes(input.unit) && current?.unit !== input.unit) throw rule("Choose a unit from the list");

      const qty = input.unit === "lot" ? 1 : input.qty;
      const materials = input.performedBy === "SELF" ? input.materials.map((m) => ({ ...m, total: lineTotal(m.qty, m.unitCost) })) : [];
      const { total } = calcBomTotal({ qty, unitCost: input.unitCost, materials });
      if (total <= 0) throw rule("Enter a cost: the line total must be greater than zero");

      const fields = {
        workItemId: new Types.ObjectId(input.workItemId), workPackage: input.workPackage, description: input.description,
        qty, unit: input.unit, unitCost: input.unitCost, estTotal: total, performedBy: input.performedBy, materials,
      };
      if (current) {
        if (input.performedBy === "SELF" && (await RfqModel.exists({ projectId, bomItemId }))) {
          throw rule("This line already has vendor RFQs. Remove the vendor requests before making it self-performed.");
        }
        current.set(fields);
      } else {
        project.bomItems.push({ ...fields, seq: Math.max(0, ...project.bomItems.map((b) => b.seq)) + 1 });
      }
      await saveAndRefresh(project);
    });
  }

  async deleteBomItem(bomItemId: Id) {
    await tx(async () => {
      const project = await loadProjectBy({ "bomItems._id": bomItemId }, "BOM line");
      const projectId = project._id;
      const blocker = await deleteBlocker(projectId, bomItemId);
      if (blocker) throw rule(`Cannot delete: this line ${blocker}.`);
      await cascade(projectId, [bomItemId]);
      project.set("bomItems", project.bomItems.filter((b) => !b._id.equals(bomItemId)));
      await saveAndRefresh(project);
    });
  }
}
