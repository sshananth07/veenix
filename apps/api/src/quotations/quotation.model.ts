import { Schema, model, type HydratedDocument, type InferSchemaType } from "mongoose";
import { QUOTATION_STATUSES } from "@veenix/shared";
import { orgIdField, sen, tenantPlugin, text } from "../common/fields";

const { ObjectId } = Schema.Types;

// Frozen copy of each priced line, so later BOM edits can't change what the client was offered.
const lineSchema = new Schema({
  bomItemId: { type: ObjectId, default: null },
  workItemName: text(),
  workPackage: { type: String, required: true },
  qty: { type: Number, default: 1 },
  unit: { type: String, default: "lot" },
  bomCost: sen(),
  markupPct: { type: Number, required: true },
  clientPrice: sen(),
  seq: { type: Number, default: 0 },
});
const termSchema = new Schema({ seq: { type: Number, required: true }, name: { type: String, required: true }, trigger: { type: String, default: "-" }, pct: { type: Number, required: true } });
const eventSchema = new Schema({ type: { type: String, required: true }, note: text(), actorId: { type: ObjectId, default: null } }, { timestamps: { createdAt: true, updatedAt: false } });

const quotationSchema = new Schema(
  {
    orgId: orgIdField,
    code: { type: String, required: true },
    revision: { type: Number, required: true },
    projectId: { type: ObjectId, required: true },
    status: { type: String, enum: QUOTATION_STATUSES, default: "DRAFT" },
    sentAt: { type: Date, default: null },
    viewedAt: { type: Date, default: null },
    acceptedAt: { type: Date, default: null },
    signedBy: text(),
    lineItems: { type: [lineSchema], default: [] },
    terms: { type: [termSchema], default: [] },
    events: { type: [eventSchema], default: [] },
    snapshot: { type: new Schema({ key: String, sha256: String }, { _id: false }), default: null },
  },
  { collection: "quotations", timestamps: true, optimisticConcurrency: true },
);
quotationSchema.index({ orgId: 1, code: 1 }, { unique: true });
quotationSchema.index({ orgId: 1, projectId: 1, revision: 1 }, { unique: true });
// At most one DRAFT and one ACCEPTED per project, guaranteed by the database.
quotationSchema.index({ orgId: 1, projectId: 1, status: 1 }, { unique: true, partialFilterExpression: { status: { $in: ["DRAFT", "ACCEPTED"] } } });
quotationSchema.plugin(tenantPlugin, { projectField: "projectId" });

export type QuotationDoc = HydratedDocument<InferSchemaType<typeof quotationSchema>>;
export const QuotationModel = model("Quotation", quotationSchema);
