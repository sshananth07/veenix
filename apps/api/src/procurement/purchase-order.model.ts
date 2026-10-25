import { Schema, model } from "mongoose";
import { PO_MILESTONE_STATUSES, PO_STATUSES } from "@veenix/shared";
import { orgIdField, sen, senOrNull, tenantPlugin, text } from "../common/fields";

const { ObjectId } = Schema.Types;

// A vendor payment term, its vendor invoice and its payment in one row.
const poMilestoneSchema = new Schema({
  seq: { type: Number, required: true },
  label: { type: String, required: true },
  pct: { type: Number, required: true },
  amount: sen(),
  status: { type: String, enum: PO_MILESTONE_STATUSES, default: "PENDING" },
  invoiceNo: text(),
  invoiceDate: { type: Date, default: null },
  invoicePath: text(),
  invoiceName: text(),
  paidAmount: senOrNull(),
  paidDate: { type: Date, default: null },
  method: text(),
  bankRef: text(),
  paidFrom: text(),
});

const poSchema = new Schema(
  {
    orgId: orgIdField,
    code: { type: String, required: true },
    projectId: { type: ObjectId, required: true },
    rfqId: { type: ObjectId, default: null },
    vendorId: { type: ObjectId, required: true },
    description: { type: String, required: true },
    qty: { type: String, required: true },
    amount: sen(),
    issueDate: { type: Date, default: () => new Date() },
    deliveryBy: { type: Date, default: null },
    remarks: text(),
    status: { type: String, enum: PO_STATUSES, default: "ISSUED" },
    milestones: { type: [poMilestoneSchema], default: [] },
  },
  { collection: "purchase_orders", timestamps: true, optimisticConcurrency: true },
);
poSchema.index({ orgId: 1, code: 1 }, { unique: true });
poSchema.index({ orgId: 1, rfqId: 1 }, { unique: true, partialFilterExpression: { rfqId: { $type: "objectId" } } }); // one PO per package
poSchema.index({ orgId: 1, projectId: 1 });
poSchema.index({ orgId: 1, vendorId: 1 });
poSchema.plugin(tenantPlugin, { projectField: "projectId" });
export const PurchaseOrderModel = model("PurchaseOrder", poSchema);
