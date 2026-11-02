import { Schema, model } from "mongoose";
import { orgIdField, tenantPlugin } from "../common/fields";

const { ObjectId } = Schema.Types;

const taskSchema = new Schema(
  {
    orgId: orgIdField,
    title: { type: String, required: true },
    status: { type: String, enum: ["open", "done"], default: "open" },
    dueAt: { type: Date, default: null },
    assigneeId: { type: ObjectId, default: null },
    projectId: { type: ObjectId, default: null },
    leadId: { type: ObjectId, default: null },
    createdBy: { type: ObjectId, default: null },
    messageId: { type: ObjectId, default: null }, // the assistant message that created it
    doneAt: { type: Date, default: null },
  },
  { collection: "tasks", timestamps: true },
);
taskSchema.index({ orgId: 1, assigneeId: 1, status: 1, dueAt: 1 });
taskSchema.index({ orgId: 1, projectId: 1 });
// No projectField: the plugin's scope filter would hide a scoped user's own general tasks. TasksService scopes instead.
taskSchema.plugin(tenantPlugin);
export const TaskModel = model("Task", taskSchema);
