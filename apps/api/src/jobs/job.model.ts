import { Schema, model } from "mongoose";

// Not under the tenant plugin: the runner claims jobs for every organization.
const jobSchema = new Schema(
  {
    orgId: { type: Schema.Types.ObjectId, required: true },
    type: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, default: {} },
    status: { type: String, enum: ["pending", "running", "done", "failed"], default: "pending" },
    attempts: { type: Number, default: 0 },
    runAt: { type: Date, default: () => new Date() },
    lockedUntil: { type: Date, default: null },
    lastError: { type: String, default: null },
    doneAt: { type: Date, default: null },
  },
  { collection: "jobs", timestamps: true },
);
jobSchema.index({ status: 1, runAt: 1 });
jobSchema.index({ doneAt: 1 }, { expireAfterSeconds: 30 * 86_400 });
export const JobModel = model("Job", jobSchema);
