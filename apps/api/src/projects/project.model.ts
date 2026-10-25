import { Schema, Types, model, type HydratedDocument, type InferSchemaType } from "mongoose";
import { ASSIGNABLE_ROLES, MILESTONE_STATUSES, PERFORMED_BY, PROJECT_STAGES } from "@veenix/shared";
import { orgIdField, sen, senOrNull, tenantPlugin, text } from "../common/fields";
import { notFound } from "../common/errors";

const { ObjectId } = Schema.Types;

const materialSchema = new Schema({ name: { type: String, required: true }, qty: { type: Number, required: true }, unit: { type: String, default: "nos" }, unitCost: sen(), total: sen() });

const bomItemSchema = new Schema({
  workItemId: { type: ObjectId, default: null },
  seq: { type: Number, required: true },
  workPackage: { type: String, required: true },
  description: text(),
  qty: { type: Number, default: 1 },
  unit: { type: String, default: "lot" },
  unitCost: sen(),
  estTotal: sen(),
  performedBy: { type: String, enum: PERFORMED_BY, default: "OUTSOURCED" },
  materials: { type: [materialSchema], default: [] },
  // A copy of the accepted PO price, written in the same transaction as the PO.
  awarded: { type: new Schema({ poId: { type: ObjectId, required: true }, amount: sen() }, { _id: false }), default: null },
});

const workItemSchema = new Schema({ seq: { type: Number, required: true }, name: { type: String, required: true }, description: text() });

// Client payment milestones (Prisma's PaymentMilestone).
const milestoneSchema = new Schema({
  seq: { type: Number, required: true },
  name: { type: String, required: true },
  trigger: { type: String, default: "-" },
  pct: { type: Number, default: null },
  amount: sen(),
  status: { type: String, enum: MILESTONE_STATUSES, default: "NOT_YET_DUE" },
  invoiceId: { type: ObjectId, default: null },
});

const assigneeSchema = new Schema({ userId: { type: ObjectId, required: true }, role: { type: String, enum: ASSIGNABLE_ROLES, required: true } }, { _id: false });

const projectSchema = new Schema(
  {
    orgId: orgIdField,
    code: { type: String, required: true },
    name: { type: String, required: true },
    clientName: { type: String, required: true },
    clientPhone: text(), clientEmail: text(),
    addressLine1: text(), addressLine2: text(), addressLine3: text(), postcode: text(), city: text(), state: text(),
    siteAddress: { type: String, default: "" },
    propertyType: text(), builtUpArea: text(),
    budgetMin: senOrNull(), budgetMax: senOrNull(),
    campaign: text(),
    surveyAt: { type: Date, default: null },
    photoPath: text(),
    contractValue: sen(),
    targetStart: { type: Date, default: null },
    targetHandover: { type: Date, default: null },
    pmName: text(), siteName: text(),
    stage: { type: String, enum: PROJECT_STAGES, default: "SITE_VISIT" },
    stageEnteredAt: { type: Date, default: () => new Date() },
    cancelReason: text(),
    leadId: { type: ObjectId, default: null },
    assignees: { type: [assigneeSchema], default: [] },
    workItems: { type: [workItemSchema], default: [] },
    bomItems: { type: [bomItemSchema], default: [] },
    milestones: { type: [milestoneSchema], default: [] },
  },
  { collection: "projects", timestamps: true, optimisticConcurrency: true },
);
projectSchema.index({ orgId: 1, code: 1 }, { unique: true });
projectSchema.index({ orgId: 1, stage: 1 });
projectSchema.index({ orgId: 1, "assignees.userId": 1 });
projectSchema.index({ orgId: 1, leadId: 1 }, { unique: true, partialFilterExpression: { leadId: { $type: "objectId" } } });
projectSchema.plugin(tenantPlugin, { projectField: "_id" });

export type ProjectDoc = HydratedDocument<InferSchemaType<typeof projectSchema>>;
export const ProjectModel = model("Project", projectSchema);

export async function loadProject(id: Types.ObjectId | string): Promise<ProjectDoc> {
  const p = await ProjectModel.findById(id);
  if (!p) throw notFound("Project");
  return p;
}

/** The project that holds an embedded record, e.g. `{ "bomItems._id": id }`. Several actions only know the child's id. */
export async function loadProjectBy(filter: Record<string, unknown>, what = "Record"): Promise<ProjectDoc> {
  const p = await ProjectModel.findOne(filter);
  if (!p) throw notFound(what);
  return p;
}
