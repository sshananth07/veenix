import { Schema, model } from "mongoose";
import { orgIdField, sen, tenantPlugin, text } from "../common/fields";

const { ObjectId } = Schema.Types;
const quoteFields = {
  quotedPrice: sen(),
  leadTimeDays: { type: Number, default: 0 },
  warrantyMonths: { type: Number, default: 0 },
  notes: text(),
  attachmentPath: text(),
  attachmentName: text(),
};

const revisionSchema = new Schema({ round: { type: Number, required: true }, ...quoteFields, receivedAt: { type: Date, required: true } }, { timestamps: { createdAt: true, updatedAt: false } });

const quoteSchema = new Schema({
  vendorId: { type: ObjectId, required: true },
  requestedAt: { type: Date, default: () => new Date() },
  receivedAt: { type: Date, default: null },
  ...quoteFields,
  selected: { type: Boolean, default: false },
  revisions: { type: [revisionSchema], default: [] },
});

const rfqSchema = new Schema(
  {
    orgId: orgIdField,
    code: { type: String, required: true },
    projectId: { type: ObjectId, required: true },
    bomItemId: { type: ObjectId, required: true },
    quantity: { type: String, required: true },
    respondBy: { type: Date, default: null },
    note: text(),
    quotes: { type: [quoteSchema], default: [] },
  },
  { collection: "rfqs", timestamps: true, optimisticConcurrency: true },
);
rfqSchema.index({ orgId: 1, code: 1 }, { unique: true });
rfqSchema.index({ orgId: 1, bomItemId: 1 }, { unique: true }); // one RFQ per package
rfqSchema.index({ orgId: 1, projectId: 1 });
rfqSchema.index({ orgId: 1, "quotes.vendorId": 1 });
rfqSchema.plugin(tenantPlugin, { projectField: "projectId" });
export const RfqModel = model("Rfq", rfqSchema);
