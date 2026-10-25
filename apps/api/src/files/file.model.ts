import { Schema, model } from "mongoose";
import { orgIdField, tenantPlugin } from "../common/fields";

const fileSchema = new Schema(
  {
    orgId: orgIdField,
    projectId: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true },
    path: { type: String, required: true }, // storage key
    size: { type: Number, required: true },
    contentType: { type: String, required: true },
    uploadedBy: { type: Schema.Types.ObjectId, default: null },
  },
  { collection: "files", timestamps: true },
);
fileSchema.index({ orgId: 1, projectId: 1, createdAt: -1 });
fileSchema.plugin(tenantPlugin, { projectField: "projectId" });
export const FileModel = model("ProjectFile", fileSchema);
