import { Schema, model } from "mongoose";
import { INVOICE_STATUSES } from "@veenix/shared";
import { orgIdField, sen, tenantPlugin, text } from "../common/fields";

const einvoiceSchema = new Schema(
  {
    status: { type: String, enum: ["NOT_SUBMITTED", "SUBMITTED", "VALID", "INVALID", "CANCELLED"], default: "NOT_SUBMITTED" },
    environment: { type: String, enum: ["preprod", "prod", null], default: null }, // where it was submitted
    submissionUid: text(),
    uuid: text(),
    longId: text(),
    validatedAt: { type: Date, default: null },
    errors: { type: [String], default: null }, // readable lines: ours or LHDN's
  },
  { _id: false, suppressReservedKeysWarning: true },
);

const invoiceSchema = new Schema(
  {
    orgId: orgIdField,
    code: { type: String, required: true },
    projectId: { type: Schema.Types.ObjectId, required: true },
    milestoneId: { type: Schema.Types.ObjectId, required: true },
    invoiceDate: { type: Date, default: () => new Date() },
    dueDate: { type: Date, default: null },
    amount: sen(), // before SST
    sstAmount: sen(),
    status: { type: String, enum: INVOICE_STATUSES, default: "ISSUED" },
    einvoice: { type: einvoiceSchema, default: () => ({}) },
    snapshot: { type: new Schema({ key: String, sha256: String }, { _id: false }), default: null },
  },
  { collection: "invoices", timestamps: true },
);
invoiceSchema.index({ orgId: 1, code: 1 }, { unique: true });
invoiceSchema.index({ orgId: 1, milestoneId: 1 }, { unique: true }); // one invoice per milestone
invoiceSchema.index({ orgId: 1, projectId: 1 });
invoiceSchema.plugin(tenantPlugin, { projectField: "projectId" });
export const InvoiceModel = model("Invoice", invoiceSchema);
