import { Types, type Model, type PipelineStage } from "mongoose";
import { z } from "zod";
import { can, formatDate, formatMoney2, type Permission, type Role } from "@veenix/shared";
import { ctx } from "../common/context";
import { forbidden, rule } from "../common/errors";
import { InvoiceModel } from "../billing/invoice.model";
import { DashboardService } from "../dashboard/dashboard.service";
import { LeadModel } from "../leads/lead.model";
import { PurchaseOrderModel } from "../procurement/purchase-order.model";
import { ProjectModel } from "../projects/project.model";
import { QuotationModel } from "../quotations/quotation.model";
import { VariationOrderModel } from "../variations/variation-order.model";
import { VendorModel } from "../vendors/vendor.model";
import { SiteUpdateModel } from "../updates/site-update.model";
import { TaskModel } from "../tasks/task.model";
import { taskScope } from "../tasks/tasks.service";
import { defineTool } from "./tools";

export type QueryField = { type: "string" | "number" | "money" | "date" | "boolean" | "id"; label: string };

export interface QueryEntity {
  model: Model<any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- always a tenantPlugin model
  permission: Permission | null;
  fields: Record<string, QueryField>; // nothing else can be read
  unwind?: string; // fixed by the map, for embedded lists such as milestones
  scope?: () => object; // for services that apply their own scope
}

const entities = new Map<string, QueryEntity>();
export function defineQueryEntity(name: string, entity: QueryEntity) {
  entities.set(name, entity);
}

const OPS = ["eq", "ne", "gt", "gte", "lt", "lte", "in"] as const;
const scalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export const queryInput = z.strictObject({
  entity: z.string(),
  filters: z.array(z.strictObject({ field: z.string(), op: z.enum(OPS), value: z.union([scalar, z.array(z.union([z.string(), z.number()]))]) })).max(10),
  groupBy: z.string().nullable(),
  metric: z.strictObject({ type: z.enum(["rows", "count", "sum"]), field: z.string().nullable() }),
  sort: z.strictObject({ field: z.string(), dir: z.enum(["asc", "desc"]) }).nullable(),
  limit: z.int().min(1).max(50).nullable(),
});
export type QueryInput = z.infer<typeof queryInput>;

function field(e: QueryEntity, name: string): QueryField {
  const f = e.fields[name];
  if (!f) throw rule(`Unknown field "${name}". Allowed fields: ${Object.keys(e.fields).join(", ")}`);
  return f;
}

/** Casts one filter value to its field's type. Anything else, objects included, is refused. */
function cast(f: QueryField, name: string, v: unknown): unknown {
  const bad = () => rule(`"${String(v)}" isn't a valid ${f.type} for ${name}`);
  if (v === null) return null;
  switch (f.type) {
    case "id":
      if (typeof v !== "string" || !/^[a-f\d]{24}$/i.test(v)) throw bad();
      return new Types.ObjectId(v);
    case "date": {
      const d = typeof v === "string" ? new Date(v) : null;
      if (!d || isNaN(d.getTime())) throw bad();
      return d;
    }
    case "number":
    case "money":
      if (typeof v !== "number" || !Number.isFinite(v)) throw bad();
      return v;
    case "boolean":
      if (typeof v !== "boolean") throw bad();
      return v;
    case "string":
      if (typeof v !== "string") throw bad();
      return v;
  }
}

/** The pipeline, built only from the entity map. tenantPlugin puts its own $match in front. */
export function buildPipeline(e: QueryEntity, q: QueryInput): PipelineStage[] {
  const role = ctx().role as Role;
  const stages: PipelineStage[] = [];
  if (e.scope) stages.push({ $match: e.scope() });
  if (e.unwind) stages.push({ $unwind: `$${e.unwind}` });

  if (q.filters.length) {
    const and = q.filters.map(({ field: name, op, value }) => {
      const f = field(e, name);
      if (op === "in") {
        if (!Array.isArray(value) || value.length > 50) throw rule(`"in" needs a list of up to 50 values for ${name}`);
        return { [name]: { $in: value.map((v) => cast(f, name, v)) } };
      }
      if (Array.isArray(value)) throw rule(`Only "in" takes a list (${name})`);
      return { [name]: { [`$${op}`]: cast(f, name, value) } };
    });
    stages.push({ $match: { $and: and } });
  }

  const limit = q.limit ?? 20;
  if (q.metric.type === "rows") {
    if (q.groupBy) throw rule("Grouping needs a count or a sum");
    if (q.sort) {
      field(e, q.sort.field);
      stages.push({ $sort: { [q.sort.field]: q.sort.dir === "asc" ? 1 : -1, _id: 1 } });
    }
  } else {
    if (q.groupBy) field(e, q.groupBy);
    let value: unknown = 1;
    if (q.metric.type === "sum") {
      const f = field(e, q.metric.field ?? "");
      if (f.type !== "number" && f.type !== "money") throw rule(`${q.metric.field} can't be summed`);
      if (f.type === "money" && !can(role, "report:read")) throw forbidden("Totals of money need the reports permission");
      value = `$${q.metric.field}`;
    }
    stages.push({ $group: { _id: q.groupBy ? `$${q.groupBy}` : null, value: { $sum: value } } });
    const by = q.sort && q.sort.field === q.groupBy ? "_id" : "value";
    if (q.sort && q.sort.field !== q.groupBy && q.sort.field !== "value") throw rule(`Sort grouped results by "value" or "${q.groupBy}"`);
    stages.push({ $sort: { [by]: q.sort?.dir === "asc" ? 1 : -1, _id: 1 } });
  }
  stages.push({ $limit: limit + 1 }); // one extra row tells us the limit cut something off
  return stages;
}

function show(f: QueryField | undefined, v: unknown): string {
  if (v === null || v === undefined) return "";
  if (f?.type === "money") return formatMoney2(v as number);
  if (f?.type === "date") return formatDate(v as Date);
  return String(v);
}

// ponytail: no joins, so a cross-entity question takes several calls; add a fixed join to the map when the log shows one is common.
export async function runQuery(q: QueryInput) {
  const e = entities.get(q.entity);
  if (!e) throw rule(`Unknown entity "${q.entity}". Entities: ${[...entities.keys()].join(", ")}`);
  if (e.permission && !can(ctx().role as Role, e.permission)) throw forbidden("You don't have permission to see that.");
  const limit = q.limit ?? 20;
  const found = await e.model.aggregate(buildPipeline(e, q)).option({ maxTimeMS: 5000 });
  const truncated = found.length > limit;
  const rows = found.slice(0, limit) as Record<string, unknown>[];

  if (q.metric.type === "rows") {
    const names = Object.keys(e.fields);
    const get = (r: Record<string, unknown>, path: string) => path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], r);
    const picked = rows.map((r) => Object.fromEntries(names.map((n) => [n, get(r, n) ?? null])));
    return {
      content: JSON.stringify({ rows: picked, truncated }),
      display: { type: "table", columns: names.map((n) => e.fields[n].label), rows: picked.map((r) => names.map((n) => show(e.fields[n], r[n]))) },
    };
  }
  const valueField = q.metric.type === "sum" ? e.fields[q.metric.field!] : undefined;
  const groupField = q.groupBy ? e.fields[q.groupBy] : undefined;
  const label = q.metric.type === "sum" ? `Total ${valueField!.label.toLowerCase()}` : "Count";
  const out: Record<string, unknown>[] = rows.map((r) => ({ ...(q.groupBy ? { [q.groupBy]: r._id } : {}), value: r.value }));
  return {
    content: JSON.stringify({ rows: out, truncated, ...(valueField?.type === "money" ? { formatted: out.map((r) => show(valueField, r.value)) } : {}) }),
    display: {
      type: "table",
      columns: [...(groupField ? [groupField.label] : []), label],
      rows: out.map((r) => [...(q.groupBy ? [show(groupField, r[q.groupBy])] : []), show(valueField, r.value)]),
    },
  };
}

function describeEntities() {
  return [...entities.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, e]) => `${name}: ${Object.entries(e.fields).map(([f, d]) => `${f} (${d.type})`).join(", ")}`)
    .join("\n");
}

defineTool<QueryInput>({
  name: "query_records",
  // A getter, so entities added by later files are listed too. Sorted, so the prompt cache holds.
  get description() {
    return `Answer questions about records: list rows, count, or total a number, with filters and grouping. The server computes totals and formats money; report its figures, don't calculate. Money is in sen. Dates are ISO strings.\n${describeEntities()}`;
  },
  input: queryInput,
  permission: null, // checked per entity
  level: "read",
  run: runQuery,
});

const dashboard = new DashboardService();

defineTool({
  name: "get_business_report",
  description: "The business report: lead win rates by source, signed deals, margins on signed projects, and spend committed and paid per vendor. Money is in sen.",
  input: z.strictObject({}),
  permission: "report:read",
  level: "read",
  run: async () => ({ content: JSON.stringify(await dashboard.reports()) }),
});

const id = (label: string): QueryField => ({ type: "id", label });
const str = (label: string): QueryField => ({ type: "string", label });
const date = (label: string): QueryField => ({ type: "date", label });
const money = (label: string): QueryField => ({ type: "money", label });
const num = (label: string): QueryField => ({ type: "number", label });

// Headline fields only. A record's money follows its read permission, as in the app; sums of money need report:read.
// lineItems stays out of every entity.
defineQueryEntity("projects", {
  model: ProjectModel,
  permission: "project:read",
  fields: {
    _id: id("Project id"), code: str("Code"), name: str("Name"), clientName: str("Client"), stage: str("Stage"), city: str("City"),
    state: str("State"), createdAt: date("Created"), stageEnteredAt: date("In stage since"), targetStart: date("Target start"), targetHandover: date("Target handover"),
    contractValue: money("Contract value"), budgetMin: money("Budget from"), budgetMax: money("Budget to"),
  },
});

defineQueryEntity("client_milestones", {
  model: ProjectModel,
  permission: "project:read",
  unwind: "milestones",
  fields: {
    _id: id("Project id"), code: str("Project code"), name: str("Project"), "milestones.name": str("Milestone"), "milestones.pct": num("Percent"),
    "milestones.amount": money("Amount"), "milestones.status": str("Status"),
  },
});

defineQueryEntity("purchase_orders", {
  model: PurchaseOrderModel,
  permission: "project:read",
  fields: {
    _id: id("PO id"), code: str("Code"), projectId: id("Project id"), vendorId: id("Vendor id"), description: str("Description"), amount: money("Amount"),
    status: str("Status"), issueDate: date("Issued"), deliveryBy: date("Delivery by"),
  },
});

defineQueryEntity("po_milestones", {
  model: PurchaseOrderModel,
  permission: "project:read",
  unwind: "milestones",
  fields: {
    _id: id("PO id"), code: str("PO code"), projectId: id("Project id"), vendorId: id("Vendor id"), "milestones.label": str("Milestone"),
    "milestones.amount": money("Amount"), "milestones.status": str("Status"), "milestones.invoiceNo": str("Vendor invoice no."),
    "milestones.invoiceDate": date("Invoiced"), "milestones.paidAmount": money("Paid"), "milestones.paidDate": date("Paid on"), "milestones.method": str("Method"),
  },
});

defineQueryEntity("invoices", {
  model: InvoiceModel,
  permission: "project:read",
  fields: {
    _id: id("Invoice id"), code: str("Code"), projectId: id("Project id"), invoiceDate: date("Invoice date"), dueDate: date("Due"),
    amount: money("Amount before SST"), sstAmount: money("SST"), status: str("Status"), "einvoice.status": str("e-Invoice status"),
  },
});

defineQueryEntity("quotations", {
  model: QuotationModel,
  permission: "project:read",
  fields: {
    _id: id("Quotation id"), code: str("Code"), revision: num("Revision"), projectId: id("Project id"), status: str("Status"),
    sentAt: date("Sent"), acceptedAt: date("Accepted"), signedBy: str("Signed by"), createdAt: date("Created"),
  },
});

defineQueryEntity("variation_orders", {
  model: VariationOrderModel,
  permission: "project:read",
  fields: {
    _id: id("VO id"), code: str("Code"), projectId: id("Project id"), title: str("Title"), reason: str("Reason"), amount: money("Amount"),
    status: str("Status"), raisedAt: date("Raised"),
  },
});

defineQueryEntity("vendors", {
  model: VendorModel,
  permission: "vendor:read",
  fields: {
    _id: id("Vendor id"), name: str("Name"), type: str("Trade"), location: str("Location"), active: { type: "boolean", label: "Active" },
    jobsCount: num("Jobs"), experienceYears: num("Years of experience"),
  },
});

defineQueryEntity("leads", {
  model: LeadModel,
  permission: "lead:read",
  fields: {
    _id: id("Lead id"), code: str("Code"), name: str("Name"), source: str("Source"), campaign: str("Campaign"), status: str("Status"),
    propertyType: str("Property type"), city: str("City"), state: str("State"), budgetMin: money("Budget from"), budgetMax: money("Budget to"),
    surveyAt: date("Site survey"), createdAt: date("Created"),
  },
});

defineQueryEntity("tasks", {
  model: TaskModel,
  permission: null,
  scope: taskScope,
  fields: {
    _id: id("Task id"), title: str("Title"), status: str("Status"), dueAt: date("Due"), assigneeId: id("Assignee id"), projectId: id("Project id"),
    leadId: id("Lead id"), createdAt: date("Created"), doneAt: date("Done"),
  },
});

defineQueryEntity("site_updates", {
  model: SiteUpdateModel,
  permission: "project:read",
  fields: { _id: id("Update id"), projectId: id("Project id"), kind: str("Kind"), text: str("Text"), authorId: id("Author id"), createdAt: date("Added") },
});
