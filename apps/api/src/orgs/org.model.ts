import { Schema, model, type InferSchemaType } from "mongoose";

const orgSchema = new Schema(
  {
    companyName: { type: String, required: true },
    companyReg: { type: String, default: "" },
    companyAddress: { type: String, default: "" },
    companyPhone: { type: String, default: "" },
    logoPath: { type: String, default: null },
    bankName: { type: String, default: "" },
    bankAccountName: { type: String, default: "" },
    bankAccount: { type: String, default: "" },
    swiftCode: { type: String, default: null },
    defaultMarkupPct: { type: Number, default: 40 },
    minMarkupPct: { type: Number, default: 20 },
    sstBps: { type: Number, default: 800 },
    einvoice: { type: Schema.Types.Mixed, default: null }, // plan 10
    status: { type: String, enum: ["active", "suspended"], default: "active" },
    createdBy: { type: Schema.Types.ObjectId, required: true },
  },
  { collection: "organizations", timestamps: true },
);
export type Org = InferSchemaType<typeof orgSchema> & { _id: import("mongoose").Types.ObjectId };
export const OrgModel = model("Organization", orgSchema);
