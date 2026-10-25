import { Schema, model } from "mongoose";
import { LEAD_STATUSES } from "@veenix/shared";
import { orgIdField, senOrNull, tenantPlugin, text } from "../common/fields";

const activitySchema = new Schema(
  { note: { type: String, required: true }, author: { type: String, default: "System" }, authorId: { type: Schema.Types.ObjectId, default: null } },
  { timestamps: { createdAt: true, updatedAt: false } },
);

const leadSchema = new Schema(
  {
    orgId: orgIdField,
    code: { type: String, required: true },
    name: { type: String, required: true },
    phone: { type: String, required: true },
    email: text(),
    source: { type: String, default: "Other" },
    campaign: text(),
    propertyType: text(),
    builtUpArea: text(),
    budgetMin: senOrNull(),
    budgetMax: senOrNull(),
    addressLine1: text(), addressLine2: text(), addressLine3: text(), postcode: text(), city: text(), state: text(),
    siteAddress: text(),
    targetStart: text(),
    assignedTo: text(),
    status: { type: String, enum: LEAD_STATUSES, default: "NEW" },
    surveyAt: { type: Date, default: null },
    activities: { type: [activitySchema], default: [] },
  },
  { collection: "leads", timestamps: true },
);
leadSchema.index({ orgId: 1, code: 1 }, { unique: true });
leadSchema.index({ orgId: 1, status: 1, createdAt: -1 });
leadSchema.plugin(tenantPlugin);
export const LeadModel = model("Lead", leadSchema);
