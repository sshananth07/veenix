import { Schema, model } from "mongoose";
import { orgIdField, tenantPlugin, text } from "../common/fields";

export const VENDOR_COLLATION = { locale: "en", strength: 2 } as const; // case-insensitive

const vendorSchema = new Schema(
  {
    orgId: orgIdField,
    name: { type: String, required: true },
    type: text(),
    registrationNo: text(),
    contactPerson: text(),
    phone: text(),
    email: text(),
    location: text(),
    experienceYears: { type: Number, default: null },
    active: { type: Boolean, default: true },
    jobsCount: { type: Number, default: 0 },
    notes: text(),
  },
  { collection: "vendors", timestamps: true },
);
vendorSchema.index({ orgId: 1, name: 1 }, { unique: true, collation: VENDOR_COLLATION });
vendorSchema.plugin(tenantPlugin);
export const VendorModel = model("Vendor", vendorSchema);
