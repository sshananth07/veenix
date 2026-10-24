import { Schema, Types, model } from "mongoose";
import { ctx } from "../common/context";
import { orgIdField, tenantPlugin } from "../common/fields";

const auditSchema = new Schema(
  {
    orgId: orgIdField,
    actorId: { type: Schema.Types.ObjectId, default: null },
    action: { type: String, required: true },
    entityType: { type: String, required: true },
    entityId: { type: Schema.Types.ObjectId, required: true },
    projectId: { type: Schema.Types.ObjectId, default: null },
    data: { type: Schema.Types.Mixed, default: null },
  },
  { collection: "audit_events", timestamps: { createdAt: true, updatedAt: false } },
);
auditSchema.index({ orgId: 1, createdAt: -1 });
auditSchema.index({ orgId: 1, entityId: 1 });
auditSchema.plugin(tenantPlugin);
export const AuditModel = model("AuditEvent", auditSchema);

/** Records who did what. Call it inside the same tx() as the change, so both commit or neither does. */
export async function audit(action: string, entityType: string, entityId: Types.ObjectId, data?: object, projectId?: Types.ObjectId) {
  const c = ctx();
  await AuditModel.create([{ orgId: c.orgId, actorId: c.userId, action, entityType, entityId, projectId: projectId ?? null, data: data ?? null }]);
}
