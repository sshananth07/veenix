import { Schema, model } from "mongoose";
import { SITE_UPDATE_KINDS } from "@veenix/shared";
import { orgIdField, tenantPlugin } from "../common/fields";

const { ObjectId } = Schema.Types;

const siteUpdateSchema = new Schema(
  {
    orgId: orgIdField,
    projectId: { type: ObjectId, required: true },
    kind: { type: String, enum: SITE_UPDATE_KINDS, required: true },
    text: { type: String, required: true },
    photos: { type: [new Schema({ path: { type: String, required: true }, name: { type: String, required: true } }, { _id: false })], default: [] },
    authorId: { type: ObjectId, default: null },
    messageId: { type: ObjectId, default: null }, // the assistant message that added it
  },
  { collection: "site_updates", timestamps: true },
);
siteUpdateSchema.index({ orgId: 1, projectId: 1, createdAt: -1 });
siteUpdateSchema.plugin(tenantPlugin, { projectField: "projectId" });
export const SiteUpdateModel = model("SiteUpdate", siteUpdateSchema);
