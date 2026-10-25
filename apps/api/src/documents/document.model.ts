import { Schema, model } from "mongoose";
import { orgIdField, tenantPlugin } from "../common/fields";

const sendSchema = new Schema({ channel: { type: String, enum: ["email", "whatsapp"], required: true }, to: { type: String, default: null }, by: { type: Schema.Types.ObjectId, default: null } }, { timestamps: { createdAt: true, updatedAt: false } });

const documentSchema = new Schema(
  {
    orgId: orgIdField,
    type: { type: String, required: true },
    refId: { type: Schema.Types.ObjectId, required: true },
    projectId: { type: Schema.Types.ObjectId, required: true },
    filename: { type: String, required: true },
    key: { type: String, required: true },
    sha256: { type: String, required: true },
    sends: { type: [sendSchema], default: [] },
  },
  { collection: "documents", timestamps: true },
);
documentSchema.index({ orgId: 1, type: 1, refId: 1, createdAt: -1 });
documentSchema.plugin(tenantPlugin, { projectField: "projectId" });
export const DocumentModel = model("Document", documentSchema);
