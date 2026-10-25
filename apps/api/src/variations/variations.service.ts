import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";
import type { VoInput } from "@veenix/shared";
import { findSub } from "../common/fields";
import { notFound, rule } from "../common/errors";
import { tx } from "../common/tx";
import { audit } from "../audit/audit";
import { nextCode } from "../counters/counters";
import { changed } from "../live/live";
import { claim } from "../storage/storage";
import { loadProject } from "../projects/project.model";
import { QuotationModel } from "../quotations/quotation.model";
import { VariationOrderModel } from "./variation-order.model";

type Id = Types.ObjectId;

async function loadVo(id: Id) {
  const vo = await VariationOrderModel.findById(id);
  if (!vo) throw notFound("Variation order");
  return vo;
}

@Injectable()
export class VariationsService {
  async create(projectId: Id, input: VoInput) {
    return tx(async () => {
      if (!(await QuotationModel.exists({ projectId, status: "ACCEPTED" }))) throw rule("Variation orders start once the client has signed a quotation");
      const project = await loadProject(projectId);
      if (input.bomItemId && !findSub(project.bomItems, input.bomItemId)) throw rule("Choose a valid BOM line");
      const { file, ...fields } = input;
      const upload = file ? await claim(file, "vo") : null;
      const [vo] = await VariationOrderModel.create([{
        ...fields, projectId, code: await nextCode("VO"), status: "DRAFT",
        ...(upload ? { attachmentPath: upload.path, attachmentName: upload.name } : {}),
      }]);
      changed({ kind: "project", projectId: String(projectId) });
      return { id: String(vo._id) };
    });
  }

  async send(id: Id) {
    const vo = await loadVo(id);
    if (vo.status !== "DRAFT") throw rule("Only a draft variation order can be sent to the client");
    vo.status = "CLIENT_REVIEW";
    await vo.save();
    changed({ kind: "project", projectId: String(vo.projectId) });
  }

  /** Adds the VO's payment milestone and raises the contract value, once. */
  async accept(id: Id) {
    await tx(async () => {
      const vo = await loadVo(id);
      if (vo.status === "ACCEPTED") throw rule("This variation order is already accepted");
      vo.status = "ACCEPTED";
      await vo.save();
      const project = await loadProject(vo.projectId);
      project.milestones.push({ seq: project.milestones.length + 1, name: `${vo.code} - variation`, trigger: "On completion of this VO", pct: null, amount: vo.amount, status: "PENDING_SIGNOFF" });
      project.contractValue += vo.amount;
      await project.save();
      await audit("vo.accepted", "variation_order", vo._id, { amount: vo.amount }, vo.projectId);
      changed({ kind: "project", projectId: String(vo.projectId) });
    });
  }
}
