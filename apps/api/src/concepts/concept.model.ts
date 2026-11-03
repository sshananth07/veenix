import { Schema, model, type InferSchemaType, type Types } from "mongoose";
import { orgIdField, tenantPlugin } from "../common/fields";

const { ObjectId, Mixed } = Schema.Types;

/** A room concept (spec §7): a restyled photo and a room description for the 3D view. Never attached to client documents. */
const conceptSchema = new Schema(
  {
    orgId: orgIdField,
    projectId: { type: ObjectId, default: null }, // exactly one of projectId and leadId
    leadId: { type: ObjectId, default: null },
    sourceKey: { type: String, required: true }, // the photo the user sent
    brief: { type: String, required: true },
    name: { type: String, required: true },
    status: { type: String, enum: ["generating", "ready", "failed"], default: "generating" },
    imageKey: { type: String, default: null },
    room: { type: Mixed, default: null }, // a fitted Room; null when image-only
    error: { type: String, default: null },
    conversationId: { type: ObjectId, required: true },
    createdBy: { type: ObjectId, required: true },
    saved: { type: Boolean, default: false },
  },
  { collection: "design_concepts", timestamps: true },
);
conceptSchema.index({ orgId: 1, projectId: 1, saved: 1 });
conceptSchema.index({ orgId: 1, leadId: 1, saved: 1 });
conceptSchema.index({ orgId: 1, createdAt: -1 });
// Scoped roles see only their projects' concepts; lead concepts (projectId null) are hidden from them.
conceptSchema.plugin(tenantPlugin, { projectField: "projectId" });
export const DesignConceptModel = model("DesignConcept", conceptSchema);
export type DesignConcept = InferSchemaType<typeof conceptSchema> & { _id: Types.ObjectId; createdAt: Date };
