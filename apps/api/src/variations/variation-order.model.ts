import { Schema, model } from "mongoose";
import { VO_STATUSES } from "@veenix/shared";
import { orgIdField, sen, tenantPlugin, text } from "../common/fields";

const voSchema = new Schema(
  {
    orgId: orgIdField,
    code: { type: String, required: true },
    projectId: { type: Schema.Types.ObjectId, required: true },
    title: text(),
    description: { type: String, required: true },
    reason: text(),
    raisedBy: text(),
    amount: sen(),
    status: { type: String, enum: VO_STATUSES, default: "DRAFT" },
    raisedAt: { type: Date, default: () => new Date() },
    bomItemId: { type: Schema.Types.ObjectId, default: null },
    programmeImpact: text(),
    attachmentPath: text(),
    attachmentName: text(),
  },
  { collection: "variation_orders", timestamps: true },
);
voSchema.index({ orgId: 1, code: 1 }, { unique: true });
voSchema.index({ orgId: 1, projectId: 1 });
voSchema.plugin(tenantPlugin, { projectField: "projectId" });
export const VariationOrderModel = model("VariationOrder", voSchema);
