# 06: Domain modules

> For whoever implements this (you or Claude): work task by task and tick each one off in [../README.md](../README.md).

**Goal:** every server action in `apps/web/actions/*` and every page query in `apps/web/app/**/page.tsx` gets an API endpoint, with the same rules and messages, now multi-tenant, in sen, and transactional.

**Architecture:**
- Each module is `<name>.model.ts` + `<name>.service.ts` (an `@Injectable` class) + `<name>.controller.ts`.
- **Services port the old actions line by line.** The differences are spelled out in each task: Mongo instead of Prisma, `tx()` around multi-document writes, the state-transition checks that were missing, and sen.
- The project page payload is built in one place: `projects/core.ts`.

**Tech stack:** NestJS, Mongoose, `@veenix/shared`.

**Spec:** [../spec.md](../spec.md) §5, §7, §8, §17.

## Global constraints
- **Every service method that writes:**
  - goes through `tx()` when it touches more than one document
  - calls `changed(...)` for live updates
  - calls `indexEntry(...)` when it changes a searchable title
  - calls `audit(...)` for the actions listed in plan 03, Task 3.4
- Every controller method has `@Can(...)`, using the permissions from spec §7.
- Records are read with `Model.findById(id)` or `findOne`. The tenant plugin scopes them, so a record in another organization (or an unassigned project) comes back as `null`, and the service answers `notFound(...)` (404).
- Messages are copied from the old actions. Where the old code had none, the new message is given in the step.
- Add every new model file to `src/models.ts`. Register every new controller and service in `AppModule`.

## Review focus
- **Accepting a variation order twice, or marking an invoice paid twice:** the second call is refused, and nothing doubles (the old code doubled the contract value). Tested in Task 6.8.
- **Deleting a BOM line that has an RFQ but no PO:** the RFQ goes with it, signed or past quotation lines keep their copy with `bomItemId: null`, and the draft is refreshed. Tested in Task 6.5.
- **Two people accepting different vendor quotes for the same package at once:** only one PO is created (the unique `rfqId` index). The other gets 409. Tested in Task 6.7.
- **A client signs while a draft exists:** the draft is deleted, the other open versions are superseded, the contract value is set, and the payment schedule is created, all in one transaction. Tested in Task 6.6.
- **A vendor payment larger than the milestone:** refused ("The amount paid can't be more than the milestone amount (RM …)"). Tested in Task 6.7.

> ⚠ Mongoose typing: `InferSchemaType` can type embedded arrays loosely. Where TypeScript complains about a subdocument field, cast locally (`as BomItemSub`) rather than duplicating interfaces. Behaviour is what the tests pin.

---

### Task 6.1: Vendors (the template every other module follows)

**Files:**
- Modify: `apps/api/src/common/fields.ts` (add `text`), `apps/api/src/models.ts`, `apps/api/src/app.module.ts`
- Create: `apps/api/src/common/regex.ts`, `apps/api/src/vendors/vendor.model.ts`, `vendors/vendors.service.ts`, `vendors/vendors.controller.ts`
- Test: `apps/api/src/vendors/vendors.test.ts`

**Interfaces:**
- Produces:
  - `text()`: a nullable string field
  - `escapeRegex(s)`
  - `VendorModel`, `VENDOR_COLLATION`
  - `VendorsService.list(query)`, `get(id)`, `create(input)`, `update(id, input)`, `setActive(id, active)`
  - routes:

    | Route | Permission |
    |---|---|
    | `GET /v1/vendors` | `vendor:read` |
    | `GET /v1/vendors/:id` | `vendor:read` |
    | `POST /v1/vendors` | `vendor:write` |
    | `PATCH /v1/vendors/:id` | `vendor:write` |
    | `PUT /v1/vendors/:id/active` | `vendor:write` |

- [x] **Step 1: Add the helpers**

Append to `src/common/fields.ts`:
```ts
/** A nullable text field (Prisma's `String?`). */
export const text = () => ({ type: String, default: null }) as const;
```

`src/common/regex.ts`:
```ts
/** Makes user input safe inside a $regex. */
export const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const contains = (s: string) => ({ $regex: escapeRegex(s), $options: "i" });
```

- [x] **Step 2: Write `src/vendors/vendor.model.ts`**

```ts
import { Schema, model } from "mongoose";
import { orgIdField, tenantPlugin, text } from "../common/fields";

export const VENDOR_COLLATION = { locale: "en", strength: 2 } as const; // case-insensitive

const vendorSchema = new Schema(
  {
    orgId: orgIdField,
    name: { type: String, required: true },
    type: text(),
    registrationNo: text(),
    contactPerson: text(),
    phone: text(),
    email: text(),
    location: text(),
    experienceYears: { type: Number, default: null },
    active: { type: Boolean, default: true },
    jobsCount: { type: Number, default: 0 },
    notes: text(),
  },
  { collection: "vendors", timestamps: true },
);
vendorSchema.index({ orgId: 1, name: 1 }, { unique: true, collation: VENDOR_COLLATION });
vendorSchema.plugin(tenantPlugin);
export const VendorModel = model("Vendor", vendorSchema);
```

- [x] **Step 3: Write the failing test** `src/vendors/vendors.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { VendorsService } from "./vendors.service";
import { asOrg, newId } from "../../test/ctx";

const svc = new VendorsService();
const base = { type: "Electrical", registrationNo: null, contactPerson: null, phone: null, email: null, location: "Shah Alam", experienceYears: null, notes: null };

describe("VendorsService", () => {
  const org = newId();
  it("refuses a duplicate name regardless of case, per organization", async () => {
    await asOrg(org, () => svc.create({ name: "Seng Heng Elektrik", ...base }));
    await expect(asOrg(org, () => svc.create({ name: "seng heng elektrik", ...base }))).rejects.toThrow('"seng heng elektrik" is already in your vendor list');
    await asOrg(newId(), () => svc.create({ name: "Seng Heng Elektrik", ...base })); // another org is fine
  });
  it("lists with trade filters and the trade list", async () => {
    const r = await asOrg(org, () => svc.list({ q: "", trade: "elec" }));
    expect(r.vendors.map((v) => v.name)).toEqual(["Seng Heng Elektrik"]);
    expect(r.trades).toEqual(["Electrical"]);
  });
});
```

- [x] **Step 4: Run it to confirm it fails**

Run: `pnpm --filter api test vendors`
Expected: FAIL (service missing).

- [x] **Step 5: Write `src/vendors/vendors.service.ts`**

```ts
import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";
import type { PurchaseOrderDto, VendorDetailDto, VendorDto, VendorInput, VendorListDto } from "@veenix/shared";
import { notFound, rule } from "../common/errors";
import { plain } from "../common/plain";
import { contains } from "../common/regex";
import { changed } from "../live/live";
import { indexEntry } from "../search/search";
import { VENDOR_COLLATION, VendorModel } from "./vendor.model";
import { PurchaseOrderModel } from "../procurement/purchase-order.model";
import { RfqModel } from "../procurement/rfq.model";
import { ProjectModel } from "../projects/project.model";

type VendorDoc = { _id: Types.ObjectId; name: string; type?: string | null; location?: string | null };

function index(v: VendorDoc) {
  indexEntry({ kind: "vendor", refId: v._id, projectId: null, title: v.name, subtitle: [v.type, v.location].filter(Boolean).join(" · ") });
  changed({ kind: "vendor", id: String(v._id) });
}

@Injectable()
export class VendorsService {
  async list(q: { q: string; trade?: string; status?: "active" | "inactive" }): Promise<VendorListDto> {
    const filter: Record<string, unknown> = {};
    if (q.trade) filter.type = contains(q.trade);
    if (q.status) filter.active = q.status === "active";
    if (q.q) filter.$or = [{ name: contains(q.q) }, { type: contains(q.q) }, { location: contains(q.q) }];
    const [vendors, all] = await Promise.all([VendorModel.find(filter).sort({ name: 1 }).lean(), VendorModel.find().select("type").lean()]);
    const pos = await PurchaseOrderModel.find({ vendorId: { $in: vendors.map((v) => v._id) } }).lean();
    const trades = [...new Set(all.flatMap((v) => (v.type ?? "").split(",").map((t) => t.trim()).filter(Boolean)))].sort();
    return {
      vendors: vendors.map((v) => ({ ...plain<VendorDto>(v), purchaseOrders: pos.filter((p) => p.vendorId.equals(v._id)).map((p) => plain<PurchaseOrderDto>(p)) })),
      trades,
    };
  }

  /** Mirrors the vendor page's old include: POs with project, RFQ and BOM line; every quote with its RFQ, project and BOM line. */
  async get(id: Types.ObjectId): Promise<VendorDetailDto> {
    const vendor = await VendorModel.findById(id).lean();
    if (!vendor) throw notFound("Vendor");
    const [pos, rfqs] = await Promise.all([
      PurchaseOrderModel.find({ vendorId: id }).sort({ issueDate: -1 }).lean(),
      RfqModel.find({ "quotes.vendorId": id }).lean(),
    ]);
    const projectIds = [...new Set([...pos, ...rfqs].map((x) => String(x.projectId)))];
    const projects = await ProjectModel.find({ _id: { $in: projectIds } }).select("-workItems -milestones").lean();
    const projectById = new Map(projects.map((p) => {
      const { bomItems, ...rest } = plain<Record<string, unknown> & { id: string; bomItems: { id: string }[] }>(p);
      return [rest.id, { project: rest, bom: new Map(bomItems.map((b) => [b.id, b])) }];
    }));
    const rfqById = new Map(rfqs.map((r) => [String(r._id), plain<Record<string, unknown> & { id: string; projectId: string; bomItemId: string }>(r)]));
    const rfqWithBom = (rfqId: string | null) => {
      const r = rfqId ? rfqById.get(rfqId) : undefined;
      if (!r) return null;
      const { quotes: _q, ...rest } = r as Record<string, unknown>;
      return { ...rest, bomItem: projectById.get(r.projectId)?.bom.get(r.bomItemId) ?? null };
    };
    return {
      ...plain<VendorDto>(vendor),
      purchaseOrders: pos.map((po) => {
        const d = plain<Record<string, unknown> & { id: string; projectId: string; rfqId: string | null; milestones: object[] }>(po);
        return { ...d, project: projectById.get(d.projectId)?.project, rfq: rfqWithBom(d.rfqId), milestones: d.milestones.map((m) => ({ ...m, poId: d.id })) };
      }),
      rfqQuotes: rfqs.flatMap((r) =>
        plain<{ id: string; quotes: { vendorId: string }[] }>(r).quotes
          .filter((q) => q.vendorId === String(id))
          .map((q) => ({ ...q, rfqId: String(r._id), rfq: { ...rfqWithBom(String(r._id))!, project: projectById.get(String(r.projectId))?.project } })),
      ),
    } as unknown as VendorDetailDto;
  }

  private async assertUniqueName(name: string, exceptId?: Types.ObjectId) {
    const dup = await VendorModel.findOne(exceptId ? { name, _id: { $ne: exceptId } } : { name }).collation(VENDOR_COLLATION).lean();
    if (dup) throw rule(`"${name}" is already in your vendor list`);
  }

  async create(input: VendorInput) {
    await this.assertUniqueName(input.name);
    const [v] = await VendorModel.create([input]);
    index(v);
    return { id: String(v._id) };
  }

  async update(id: Types.ObjectId, input: VendorInput) {
    await this.assertUniqueName(input.name, id);
    const v = await VendorModel.findOneAndUpdate({ _id: id }, { $set: input }, { new: true, lean: true });
    if (!v) throw notFound("Vendor");
    index(v);
  }

  async setActive(id: Types.ObjectId, active: boolean) {
    const r = await VendorModel.updateOne({ _id: id }, { $set: { active } });
    if (r.matchedCount === 0) throw notFound("Vendor");
    changed({ kind: "vendor", id: String(id) });
  }
}
```

This file imports `PurchaseOrderModel`, `RfqModel` and `ProjectModel`. Write those three model files (Task 6.2) before running the test.

- [x] **Step 6: Write `src/vendors/vendors.controller.ts`**

```ts
import { Controller, Get, Patch, Post, Put } from "@nestjs/common";
import { Types } from "mongoose";
import { vendorActiveInput, vendorInput, vendorListQuery, type VendorInput } from "@veenix/shared";
import { Can } from "../common/decorators";
import { OidParam } from "../common/oid";
import { ZBody, ZQuery } from "../common/zod";
import { VendorsService } from "./vendors.service";

@Controller("vendors")
export class VendorsController {
  constructor(private readonly vendors: VendorsService) {}

  @Can("vendor:read") @Get() list(@ZQuery(vendorListQuery) q: { q: string; trade?: string; status?: "active" | "inactive" }) { return this.vendors.list(q); }
  @Can("vendor:read") @Get(":id") get(@OidParam("id") id: Types.ObjectId) { return this.vendors.get(id); }
  @Can("vendor:write") @Post() create(@ZBody(vendorInput) body: VendorInput) { return this.vendors.create(body); }
  @Can("vendor:write") @Patch(":id") update(@OidParam("id") id: Types.ObjectId, @ZBody(vendorInput) body: VendorInput) { return this.vendors.update(id, body); }
  @Can("vendor:write") @Put(":id/active") active(@OidParam("id") id: Types.ObjectId, @ZBody(vendorActiveInput) body: { active: boolean }) { return this.vendors.setActive(id, body.active); }
}
```

Register them, and add `import "./vendors/vendor.model";` to `src/models.ts`.

- [x] **Step 7: Run the tests** (after Task 6.2's models exist)

Run: `pnpm --filter api test vendors`
Expected: PASS.

- [x] **Step 8: Commit**

```bash
git add apps/api
git commit -m "feat(api): vendors module"
```

---

### Task 6.2: All other domain models

**Files:**
- Create:
  - `apps/api/src/leads/lead.model.ts`
  - `src/projects/project.model.ts`
  - `src/procurement/rfq.model.ts`, `src/procurement/purchase-order.model.ts`
  - `src/quotations/quotation.model.ts`
  - `src/variations/variation-order.model.ts`
  - `src/billing/invoice.model.ts`
  - `src/files/file.model.ts`
- Modify: `src/models.ts`

**Interfaces:**
- Produces:
  - `LeadModel`, `ProjectModel`, `ProjectDoc`, `loadProject(id): Promise<ProjectDoc>`, `RfqModel`, `PurchaseOrderModel`, `QuotationModel`, `QuotationDoc`, `VariationOrderModel`, `InvoiceModel`, `FileModel`
  - field names exactly as in `@veenix/shared` DTOs (= the Prisma names)

- [x] **Step 1: Write the models**

`leads/lead.model.ts`:
```ts
import { Schema, model } from "mongoose";
import { LEAD_STATUSES } from "@veenix/shared";
import { orgIdField, senOrNull, tenantPlugin, text } from "../common/fields";

const activitySchema = new Schema(
  { note: { type: String, required: true }, author: { type: String, default: "System" }, authorId: { type: Schema.Types.ObjectId, default: null } },
  { timestamps: { createdAt: true, updatedAt: false } },
);

const leadSchema = new Schema(
  {
    orgId: orgIdField,
    code: { type: String, required: true },
    name: { type: String, required: true },
    phone: { type: String, required: true },
    email: text(),
    source: { type: String, default: "Other" },
    campaign: text(),
    propertyType: text(),
    builtUpArea: text(),
    budgetMin: senOrNull(),
    budgetMax: senOrNull(),
    addressLine1: text(), addressLine2: text(), addressLine3: text(), postcode: text(), city: text(), state: text(),
    siteAddress: text(),
    targetStart: text(),
    assignedTo: text(),
    status: { type: String, enum: LEAD_STATUSES, default: "NEW" },
    surveyAt: { type: Date, default: null },
    activities: { type: [activitySchema], default: [] },
  },
  { collection: "leads", timestamps: true },
);
leadSchema.index({ orgId: 1, code: 1 }, { unique: true });
leadSchema.index({ orgId: 1, status: 1, createdAt: -1 });
leadSchema.plugin(tenantPlugin);
export const LeadModel = model("Lead", leadSchema);
```

`projects/project.model.ts`:
```ts
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
```

The routes follow the existing server action signatures, so the components don't change:
- When an action takes only a child id (`deleteBomItem(bomItemId)`, `updateLineMarkup(lineId)`, …), the route is keyed by that id.
- The service finds the parent with `loadProjectBy` (or `findOne({ "lineItems._id": … })`).

`procurement/rfq.model.ts`:
```ts
import { Schema, model } from "mongoose";
import { orgIdField, sen, tenantPlugin, text } from "../common/fields";

const { ObjectId } = Schema.Types;
const quoteFields = {
  quotedPrice: sen(),
  leadTimeDays: { type: Number, default: 0 },
  warrantyMonths: { type: Number, default: 0 },
  notes: text(),
  attachmentPath: text(),
  attachmentName: text(),
};

const revisionSchema = new Schema({ round: { type: Number, required: true }, ...quoteFields, receivedAt: { type: Date, required: true } }, { timestamps: { createdAt: true, updatedAt: false } });

const quoteSchema = new Schema({
  vendorId: { type: ObjectId, required: true },
  requestedAt: { type: Date, default: () => new Date() },
  receivedAt: { type: Date, default: null },
  ...quoteFields,
  selected: { type: Boolean, default: false },
  revisions: { type: [revisionSchema], default: [] },
});

const rfqSchema = new Schema(
  {
    orgId: orgIdField,
    code: { type: String, required: true },
    projectId: { type: ObjectId, required: true },
    bomItemId: { type: ObjectId, required: true },
    quantity: { type: String, required: true },
    respondBy: { type: Date, default: null },
    note: text(),
    quotes: { type: [quoteSchema], default: [] },
  },
  { collection: "rfqs", timestamps: true, optimisticConcurrency: true },
);
rfqSchema.index({ orgId: 1, code: 1 }, { unique: true });
rfqSchema.index({ orgId: 1, bomItemId: 1 }, { unique: true }); // one RFQ per package
rfqSchema.index({ orgId: 1, projectId: 1 });
rfqSchema.index({ orgId: 1, "quotes.vendorId": 1 });
rfqSchema.plugin(tenantPlugin, { projectField: "projectId" });
export const RfqModel = model("Rfq", rfqSchema);
```

`procurement/purchase-order.model.ts`:
```ts
import { Schema, model } from "mongoose";
import { PO_MILESTONE_STATUSES, PO_STATUSES } from "@veenix/shared";
import { orgIdField, sen, senOrNull, tenantPlugin, text } from "../common/fields";

const { ObjectId } = Schema.Types;

// A vendor payment term, its vendor invoice and its payment in one row.
const poMilestoneSchema = new Schema({
  seq: { type: Number, required: true },
  label: { type: String, required: true },
  pct: { type: Number, required: true },
  amount: sen(),
  status: { type: String, enum: PO_MILESTONE_STATUSES, default: "PENDING" },
  invoiceNo: text(),
  invoiceDate: { type: Date, default: null },
  invoicePath: text(),
  invoiceName: text(),
  paidAmount: senOrNull(),
  paidDate: { type: Date, default: null },
  method: text(),
  bankRef: text(),
  paidFrom: text(),
});

const poSchema = new Schema(
  {
    orgId: orgIdField,
    code: { type: String, required: true },
    projectId: { type: ObjectId, required: true },
    rfqId: { type: ObjectId, default: null },
    vendorId: { type: ObjectId, required: true },
    description: { type: String, required: true },
    qty: { type: String, required: true },
    amount: sen(),
    issueDate: { type: Date, default: () => new Date() },
    deliveryBy: { type: Date, default: null },
    remarks: text(),
    status: { type: String, enum: PO_STATUSES, default: "ISSUED" },
    milestones: { type: [poMilestoneSchema], default: [] },
  },
  { collection: "purchase_orders", timestamps: true, optimisticConcurrency: true },
);
poSchema.index({ orgId: 1, code: 1 }, { unique: true });
poSchema.index({ orgId: 1, rfqId: 1 }, { unique: true, partialFilterExpression: { rfqId: { $type: "objectId" } } }); // one PO per package
poSchema.index({ orgId: 1, projectId: 1 });
poSchema.index({ orgId: 1, vendorId: 1 });
poSchema.plugin(tenantPlugin, { projectField: "projectId" });
export const PurchaseOrderModel = model("PurchaseOrder", poSchema);
```

`quotations/quotation.model.ts`:
```ts
import { Schema, model, type HydratedDocument, type InferSchemaType } from "mongoose";
import { QUOTATION_STATUSES } from "@veenix/shared";
import { orgIdField, sen, tenantPlugin, text } from "../common/fields";

const { ObjectId } = Schema.Types;

// Frozen copy of each priced line, so later BOM edits can't change what the client was offered.
const lineSchema = new Schema({
  bomItemId: { type: ObjectId, default: null },
  workItemName: text(),
  workPackage: { type: String, required: true },
  qty: { type: Number, default: 1 },
  unit: { type: String, default: "lot" },
  bomCost: sen(),
  markupPct: { type: Number, required: true },
  clientPrice: sen(),
  seq: { type: Number, default: 0 },
});
const termSchema = new Schema({ seq: { type: Number, required: true }, name: { type: String, required: true }, trigger: { type: String, default: "-" }, pct: { type: Number, required: true } });
const eventSchema = new Schema({ type: { type: String, required: true }, note: text(), actorId: { type: ObjectId, default: null } }, { timestamps: { createdAt: true, updatedAt: false } });

const quotationSchema = new Schema(
  {
    orgId: orgIdField,
    code: { type: String, required: true },
    revision: { type: Number, required: true },
    projectId: { type: ObjectId, required: true },
    status: { type: String, enum: QUOTATION_STATUSES, default: "DRAFT" },
    sentAt: { type: Date, default: null },
    viewedAt: { type: Date, default: null },
    acceptedAt: { type: Date, default: null },
    signedBy: text(),
    lineItems: { type: [lineSchema], default: [] },
    terms: { type: [termSchema], default: [] },
    events: { type: [eventSchema], default: [] },
    snapshot: { type: new Schema({ key: String, sha256: String }, { _id: false }), default: null },
  },
  { collection: "quotations", timestamps: true, optimisticConcurrency: true },
);
quotationSchema.index({ orgId: 1, code: 1 }, { unique: true });
quotationSchema.index({ orgId: 1, projectId: 1, revision: 1 }, { unique: true });
// At most one DRAFT and one ACCEPTED per project, guaranteed by the database.
quotationSchema.index({ orgId: 1, projectId: 1, status: 1 }, { unique: true, partialFilterExpression: { status: { $in: ["DRAFT", "ACCEPTED"] } } });
quotationSchema.plugin(tenantPlugin, { projectField: "projectId" });

export type QuotationDoc = HydratedDocument<InferSchemaType<typeof quotationSchema>>;
export const QuotationModel = model("Quotation", quotationSchema);
```
⚠ Verify: `$in` inside `partialFilterExpression` needs MongoDB 6.0+. The local image is 8.0 and Atlas is 8.x, so it works.

`variations/variation-order.model.ts`:
```ts
import { Schema, model } from "mongoose";
import { VO_STATUSES } from "@veenix/shared";
import { orgIdField, sen, tenantPlugin, text } from "../common/fields";

const voSchema = new Schema(
  {
    orgId: orgIdField,
    code: { type: String, required: true },
    projectId: { type: Schema.Types.ObjectId, required: true },
    title: text(),
    description: { type: String, required: true },
    reason: text(),
    raisedBy: text(),
    amount: sen(),
    status: { type: String, enum: VO_STATUSES, default: "DRAFT" },
    raisedAt: { type: Date, default: () => new Date() },
    bomItemId: { type: Schema.Types.ObjectId, default: null },
    programmeImpact: text(),
    attachmentPath: text(),
    attachmentName: text(),
  },
  { collection: "variation_orders", timestamps: true },
);
voSchema.index({ orgId: 1, code: 1 }, { unique: true });
voSchema.index({ orgId: 1, projectId: 1 });
voSchema.plugin(tenantPlugin, { projectField: "projectId" });
export const VariationOrderModel = model("VariationOrder", voSchema);
```

`billing/invoice.model.ts`:
```ts
import { Schema, model } from "mongoose";
import { INVOICE_STATUSES } from "@veenix/shared";
import { orgIdField, sen, tenantPlugin, text } from "../common/fields";

const einvoiceSchema = new Schema(
  {
    status: { type: String, enum: ["NOT_SUBMITTED", "SUBMITTED", "VALID", "INVALID", "CANCELLED"], default: "NOT_SUBMITTED" },
    submissionUid: text(),
    uuid: text(),
    longId: text(),
    validatedAt: { type: Date, default: null },
    errors: { type: Schema.Types.Mixed, default: null },
  },
  { _id: false },
);

const invoiceSchema = new Schema(
  {
    orgId: orgIdField,
    code: { type: String, required: true },
    projectId: { type: Schema.Types.ObjectId, required: true },
    milestoneId: { type: Schema.Types.ObjectId, required: true },
    invoiceDate: { type: Date, default: () => new Date() },
    dueDate: { type: Date, default: null },
    amount: sen(), // before SST
    sstAmount: sen(),
    status: { type: String, enum: INVOICE_STATUSES, default: "ISSUED" },
    einvoice: { type: einvoiceSchema, default: () => ({}) },
    snapshot: { type: new Schema({ key: String, sha256: String }, { _id: false }), default: null },
  },
  { collection: "invoices", timestamps: true },
);
invoiceSchema.index({ orgId: 1, code: 1 }, { unique: true });
invoiceSchema.index({ orgId: 1, milestoneId: 1 }, { unique: true }); // one invoice per milestone
invoiceSchema.index({ orgId: 1, projectId: 1 });
invoiceSchema.plugin(tenantPlugin, { projectField: "projectId" });
export const InvoiceModel = model("Invoice", invoiceSchema);
```

`files/file.model.ts`:
```ts
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
```

Add all eight to `src/models.ts`.

- [x] **Step 2: Build the indexes and check them**

Run: `pnpm --filter api typecheck && pnpm --filter api db:indexes`
Expected: no type errors, and `indexes ok: …` for every model including `Quotation`.

- [x] **Step 3: Commit**

```bash
git add apps/api
git commit -m "feat(api): domain models for leads, projects, procurement, quotations, VOs, invoices, files"
```

---

### Task 6.3: Leads and convert to project

**Files:**
- Create: `apps/api/src/leads/leads.service.ts`, `apps/api/src/leads/leads.controller.ts`
- Test: `apps/api/src/leads/leads.test.ts`

**Interfaces:**
- Consumes: `nextCode`, `tx`, `changed`, `indexEntry`, `currentUser`; `composeAddress`, `hasStructuredAddress`, `LeadInput`, `ConvertLeadInput` and `leadListQuery` from shared.
- Produces:
  - `LeadsService.list(q): LeadListDto`, `get(id): LeadDetailDto`, `create(input)`, `update(id, input)`, `addActivity(id, input)`, `convert(id, input): { projectId }`
  - `indexProject(p)` (exported for reuse by the projects service)
  - routes:

    | Route | Permission | Replaces |
    |---|---|---|
    | `GET /v1/leads` | `lead:read` | |
    | `GET /v1/leads/:id` | `lead:read` | |
    | `POST /v1/leads` | `lead:write` | |
    | `PATCH /v1/leads/:id` | `lead:write` | |
    | `POST /v1/leads/:id/activities` | `lead:write` | `logLeadActivity` |
    | `POST /v1/leads/:id/convert` | `lead:write` | `convertLead` |

- [x] **Step 1: Write the failing test** `src/leads/leads.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { LeadsService } from "./leads.service";
import { LeadModel } from "./lead.model";
import { ProjectModel } from "../projects/project.model";
import { setUser } from "../common/context";
import { asOrg, newId } from "../../test/ctx";
import { leadInput, convertLeadInput } from "@veenix/shared";

const svc = new LeadsService();
const org = newId();
const run = <T>(fn: () => Promise<T>) => asOrg(org, async () => { setUser({ id: newId(), email: "s@x.my", name: "Siti", platformRole: null }); return fn(); }, { role: "sales" });

describe("LeadsService", () => {
  it("creates with a yearly code and searches name, phone, code and place", async () => {
    await run(() => svc.create(leadInput.parse({ name: "Aisyah Rahman", phone: "012-3456789", city: "Petaling Jaya" })));
    const list = await run(() => svc.list({ view: "open", q: "petaling", page: 1 }));
    expect(list.leads[0].code).toMatch(/^L-\d{4}-0001$/);
    expect(list.counts).toEqual({ open: 1, converted: 0, all: 1 });
  });

  it("converts once, needs a full address, and links both ways", async () => {
    const lead = await run(() => LeadModel.findOne().lean());
    const input = convertLeadInput.parse({ projectName: "Aisyah Condo" });
    await expect(run(() => svc.convert(lead!._id, input))).rejects.toThrow("Add the site address before converting");

    const address = { addressLine1: "No. 12, Jalan SS 2/24", postcode: "47300", city: "Petaling Jaya", state: "Selangor" };
    const { projectId } = await run(() => svc.convert(lead!._id, convertLeadInput.parse({ projectName: "Aisyah Condo", address })));
    const project = await run(() => ProjectModel.findById(projectId).lean());
    expect(project).toMatchObject({ name: "Aisyah Condo", clientName: "Aisyah Rahman", siteAddress: "No. 12, Jalan SS 2/24, 47300 Petaling Jaya, Selangor" });
    expect((await run(() => svc.get(lead!._id))).status).toBe("CONVERTED");
    await expect(run(() => svc.convert(lead!._id, input))).rejects.toThrow("This lead is already converted");
  });
});
```

- [x] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter api test leads`
Expected: FAIL (service missing).

- [x] **Step 3: Write `src/leads/leads.service.ts`** (ports `apps/web/actions/leads.ts` and the leads pages' queries)

```ts
import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";
import { composeAddress, hasStructuredAddress, type ConvertLeadInput, type LeadDetailDto, type LeadDto, type LeadInput, type LeadListDto, type LeadStatus } from "@veenix/shared";
import { currentUser } from "../common/context";
import { notFound, rule } from "../common/errors";
import { plain } from "../common/plain";
import { contains } from "../common/regex";
import { tx } from "../common/tx";
import { nextCode } from "../counters/counters";
import { changed } from "../live/live";
import { indexEntry } from "../search/search";
import { LeadModel } from "./lead.model";
import { ProjectModel } from "../projects/project.model";

const PAGE_SIZE = 10; // same as the old leads page
const ADDRESS = ["addressLine1", "addressLine2", "addressLine3", "postcode", "city", "state"] as const;

function indexLead(l: { _id: Types.ObjectId; name: string; code: string; phone: string; city?: string | null }) {
  indexEntry({ kind: "lead", refId: l._id, projectId: null, title: l.name, subtitle: [l.code, l.city].filter(Boolean).join(" · "), keywords: l.phone });
  changed({ kind: "lead", id: String(l._id) });
}

export function indexProject(p: { _id: Types.ObjectId; name: string; code: string; clientName: string; city?: string | null }) {
  indexEntry({ kind: "project", refId: p._id, projectId: p._id, title: p.name, subtitle: [p.code, p.clientName, p.city].filter(Boolean).join(" · ") });
  changed({ kind: "project", projectId: String(p._id) });
}

@Injectable()
export class LeadsService {
  async list(q: { view: "open" | "converted" | "all"; q?: string; source?: string; status?: LeadStatus; page: number }): Promise<LeadListDto> {
    const and: object[] = [];
    if (q.view === "open") and.push({ status: { $ne: "CONVERTED" } });
    if (q.view === "converted") and.push({ status: "CONVERTED" });
    if (q.source) and.push({ source: q.source });
    if (q.status) and.push({ status: q.status });
    if (q.q) and.push({ $or: ["name", "phone", "code", "siteAddress", "city", "state"].map((f) => ({ [f]: contains(q.q!) })) });
    const where = and.length ? { $and: and } : {};

    const [open, converted, all, total] = await Promise.all([
      LeadModel.countDocuments({ status: { $ne: "CONVERTED" } }),
      LeadModel.countDocuments({ status: "CONVERTED" }),
      LeadModel.countDocuments(),
      LeadModel.countDocuments(where),
    ]);
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const page = Math.min(q.page, pages);
    const leads = await LeadModel.find(where).select("-activities").sort({ createdAt: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean();
    const projects = await ProjectModel.find({ leadId: { $in: leads.map((l) => l._id) } }).select("_id leadId").lean();
    return {
      leads: leads.map((l) => {
        const p = projects.find((x) => x.leadId && x.leadId.equals(l._id));
        return { ...plain<LeadDto>(l), project: p ? { id: String(p._id) } : null };
      }),
      counts: { open, converted, all },
      total, page, pages, pageSize: PAGE_SIZE,
    };
  }

  async get(id: Types.ObjectId): Promise<LeadDetailDto> {
    const lead = await LeadModel.findById(id).lean();
    if (!lead) throw notFound("Lead");
    const project = await ProjectModel.findOne({ leadId: id }).select("_id code name").lean();
    return { ...plain<LeadDetailDto>(lead), project: project ? { id: String(project._id), code: project.code, name: project.name } : null };
  }

  async create(input: LeadInput) {
    return tx(async () => {
      const [lead] = await LeadModel.create([{
        ...input,
        status: input.status ?? "NEW",
        siteAddress: composeAddress(input) || null,
        code: await nextCode("L"),
        activities: [{ note: "Lead created", author: "System" }],
      }]);
      indexLead(lead);
      return { id: String(lead._id) };
    });
  }

  async update(id: Types.ObjectId, input: LeadInput) {
    const { status, ...rest } = input;
    const lead = await LeadModel.findOneAndUpdate(
      { _id: id },
      { $set: { ...rest, siteAddress: composeAddress(input) || null, ...(status ? { status } : {}) } },
      { new: true, lean: true },
    );
    if (!lead) throw notFound("Lead");
    indexLead(lead);
  }

  async addActivity(id: Types.ObjectId, input: { note: string; author: string | null }) {
    const u = currentUser();
    const r = await LeadModel.updateOne({ _id: id }, { $push: { activities: { note: input.note, author: input.author ?? u.name, authorId: u.id } } });
    if (r.matchedCount === 0) throw notFound("Lead");
    changed({ kind: "lead", id: String(id) });
  }

  async convert(id: Types.ObjectId, input: ConvertLeadInput) {
    return tx(async () => {
      const lead = await LeadModel.findById(id);
      if (!lead) throw notFound("Lead");
      if (lead.status === "CONVERTED") throw rule("This lead is already converted");

      // A project needs a full site address. If the lead never had one, the convert form sends it and it's saved back onto the lead.
      let address: Record<string, string | null> = Object.fromEntries(ADDRESS.map((k) => [k, lead[k] ?? null]));
      let siteAddress = hasStructuredAddress(lead) ? composeAddress(lead) : (lead.siteAddress ?? "");
      if (input.address) {
        address = { ...input.address };
        siteAddress = composeAddress(input.address);
      } else if (!hasStructuredAddress(lead)) {
        throw rule("Add the site address before converting");
      }

      const [project] = await ProjectModel.create([{
        code: await nextCode("PRJ"),
        name: input.projectName,
        clientName: lead.name,
        clientPhone: lead.phone,
        clientEmail: lead.email,
        ...address,
        siteAddress,
        propertyType: lead.propertyType,
        builtUpArea: lead.builtUpArea,
        budgetMin: lead.budgetMin,
        budgetMax: lead.budgetMax,
        campaign: lead.campaign,
        surveyAt: lead.surveyAt,
        pmName: input.projectOwner ?? lead.assignedTo,
        stage: input.nextStage,
        targetStart: input.targetStart,
        targetHandover: input.targetHandover,
        leadId: lead._id,
      }]);

      lead.set({ ...address, siteAddress, status: "CONVERTED" });
      lead.activities.push({ note: `Converted to project ${project.code}`, author: "System" });
      await lead.save();
      indexLead(lead);
      indexProject(project);
      return { projectId: String(project._id) };
    });
  }
}
```

- [x] **Step 4: Write `src/leads/leads.controller.ts`**

```ts
import { Controller, Get, Patch, Post } from "@nestjs/common";
import { Types } from "mongoose";
import { convertLeadInput, leadActivityInput, leadInput, leadListQuery, type ConvertLeadInput, type LeadInput } from "@veenix/shared";
import { Can } from "../common/decorators";
import { OidParam } from "../common/oid";
import { ZBody, ZQuery } from "../common/zod";
import { LeadsService } from "./leads.service";

@Controller("leads")
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Can("lead:read") @Get() list(@ZQuery(leadListQuery) q: Parameters<LeadsService["list"]>[0]) { return this.leads.list(q); }
  @Can("lead:read") @Get(":id") get(@OidParam("id") id: Types.ObjectId) { return this.leads.get(id); }
  @Can("lead:write") @Post() create(@ZBody(leadInput) b: LeadInput) { return this.leads.create(b); }
  @Can("lead:write") @Patch(":id") update(@OidParam("id") id: Types.ObjectId, @ZBody(leadInput) b: LeadInput) { return this.leads.update(id, b); }
  @Can("lead:write") @Post(":id/activities") activity(@OidParam("id") id: Types.ObjectId, @ZBody(leadActivityInput) b: { note: string; author: string | null }) { return this.leads.addActivity(id, b); }
  @Can("lead:write") @Post(":id/convert") convert(@OidParam("id") id: Types.ObjectId, @ZBody(convertLeadInput) b: ConvertLeadInput) { return this.leads.convert(id, b); }
}
```

- [x] **Step 5: Run the tests**

Run: `pnpm --filter api test leads`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): leads, activity log and convert-to-project"
```

---

### Task 6.4: Projects: detail payload, list, update, assignees

**Files:**
- Create: `apps/api/src/projects/core.ts`, `apps/api/src/projects/projects.service.ts`, `apps/api/src/projects/projects.controller.ts`
- Modify: `apps/api/src/orgs/org.model.ts` (add `loadOrg`)

**Interfaces:**
- Consumes: all the models (Task 6.2); `bomCosts`, `quotationReadiness`, `quotationTotals`, `allocate` and `getAttention` from shared; `claim` and `removeObject` (plan 05); `indexProject` (Task 6.3).
- Produces:
  - `loadOrg(): Promise<Org>`, the current organization
  - `buildCores(projects): Promise<{ cores: ProjectCore[]; org: Org }>`: batched joins with no per-project queries
  - `toInvoiceDto(inv): InvoiceDto`
  - `ProjectsService.list(): ProjectListItemDto[]`, `detail(id): ProjectDetailDto`, `update(id, input)`, `setAssignees(id, input)`
  - routes:

    | Route | Permission |
    |---|---|
    | `GET /v1/projects` | `project:read` |
    | `GET /v1/projects/:id` | `project:read` |
    | `PATCH /v1/projects/:id` | `project:write` |
    | `PUT /v1/projects/:id/assignees` | `project:assign` |

- [x] **Step 1: Add `loadOrg` to `src/orgs/org.model.ts`**

```ts
import { ctx } from "../common/context";
export async function loadOrg(): Promise<Org> {
  const org = await OrgModel.findById(ctx().orgId).lean();
  if (!org) throw new Error("Organization missing for the current context");
  return org as Org;
}
```

- [x] **Step 2: Write `src/projects/core.ts`**

```ts
import type { InvoiceDto, PaymentMilestoneDto, ProjectCore, VendorDto } from "@veenix/shared";
import { allocate, quotationTotals } from "@veenix/shared";
import { plain } from "../common/plain";
import { loadOrg, type Org } from "../orgs/org.model";
import { UserModel } from "../users/user.model";
import { VendorModel } from "../vendors/vendor.model";
import { RfqModel } from "../procurement/rfq.model";
import { PurchaseOrderModel } from "../procurement/purchase-order.model";
import { QuotationModel } from "../quotations/quotation.model";
import { VariationOrderModel } from "../variations/variation-order.model";
import { InvoiceModel } from "../billing/invoice.model";
import { FileModel } from "../files/file.model";

type Lean = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export function toInvoiceDto(i: Lean): InvoiceDto {
  return {
    id: String(i._id), code: i.code, milestoneId: String(i.milestoneId), invoiceDate: i.invoiceDate, dueDate: i.dueDate,
    amount: i.amount, sstAmount: i.sstAmount, status: i.status,
    eInvoiceStatus: i.einvoice?.status ?? "NOT_SUBMITTED", eInvoiceUuid: i.einvoice?.uuid ?? null, eInvoiceValidatedAt: i.einvoice?.validatedAt ?? null,
  };
}

const byProject = <T extends Lean>(rows: T[], id: string) => rows.filter((r) => String(r.projectId) === id);

/** The project page payload for one or many projects, with every query batched across all of them. */
export async function buildCores(projects: Lean[]): Promise<{ cores: ProjectCore[]; org: Org }> {
  const ids = projects.map((p) => p._id);
  const [rfqs, pos, quotations, vos, invoices, files, org] = await Promise.all([
    RfqModel.find({ projectId: { $in: ids } }).sort({ createdAt: 1 }).lean(),
    PurchaseOrderModel.find({ projectId: { $in: ids } }).sort({ issueDate: 1 }).lean(),
    QuotationModel.find({ projectId: { $in: ids } }).sort({ revision: 1 }).lean(),
    VariationOrderModel.find({ projectId: { $in: ids } }).sort({ raisedAt: 1 }).lean(),
    InvoiceModel.find({ projectId: { $in: ids } }).lean(),
    FileModel.find({ projectId: { $in: ids } }).sort({ createdAt: -1 }).lean(),
    loadOrg(),
  ]);
  const vendorIds = [...pos.map((p) => p.vendorId), ...rfqs.flatMap((r) => r.quotes.map((q) => q.vendorId))];
  const userIds = projects.flatMap((p) => p.assignees.map((a: Lean) => a.userId));
  const [vendors, users] = await Promise.all([VendorModel.find({ _id: { $in: vendorIds } }).lean(), UserModel.find({ _id: { $in: userIds } }).lean()]);
  const vendorById = new Map(vendors.map((v) => [String(v._id), plain<VendorDto>(v)]));
  const userById = new Map(users.map((u) => [String(u._id), u]));
  const invoiceById = new Map(invoices.map((i) => [String(i._id), toInvoiceDto(i)]));

  const cores = projects.map((p): ProjectCore => {
    const base = plain<Lean>(p);
    const id = base.id as string;
    const bomById = new Map((base.bomItems as Lean[]).map((b) => [b.id, b]));
    const rfqDtos = byProject(rfqs, id).map((r) => {
      const d = plain<Lean>(r);
      return { ...d, bomItem: bomById.get(d.bomItemId), quotes: d.quotes.map((q: Lean) => ({ ...q, rfqId: d.id, vendor: vendorById.get(q.vendorId) })) };
    });
    const rfqById = new Map(rfqDtos.map(({ quotes: _q, bomItem: _b, ...r }) => [r.id, r]));
    return {
      ...base,
      assignees: base.assignees.map((a: Lean) => ({ ...a, name: userById.get(a.userId)?.name ?? "", email: userById.get(a.userId)?.email ?? "" })),
      milestones: base.milestones.map(({ invoiceId, ...m }: Lean) => ({ ...(m as PaymentMilestoneDto), projectId: id, invoice: invoiceId ? invoiceById.get(invoiceId) ?? null : null })),
      rfqs: rfqDtos,
      purchaseOrders: byProject(pos, id).map((po) => {
        const d = plain<Lean>(po);
        return { ...d, vendor: vendorById.get(d.vendorId), rfq: d.rfqId ? rfqById.get(d.rfqId) ?? null : null, milestones: d.milestones.map((m: Lean) => ({ ...m, poId: d.id })) };
      }),
      quotations: byProject(quotations, id).map((q) => {
        const d = plain<Lean>(q);
        const totals = quotationTotals(d.lineItems, org.sstBps);
        return { ...d, totals, termAmounts: allocate(totals.total, d.terms) };
      }),
      variationOrders: byProject(vos, id).map((v) => {
        const d = plain<Lean>(v);
        return { ...d, bomItem: d.bomItemId ? bomById.get(d.bomItemId) ?? null : null };
      }),
      files: byProject(files, id).map((f) => plain(f)),
    } as ProjectCore;
  });
  return { cores, org };
}
```

- [x] **Step 3: Write `src/projects/projects.service.ts`**

```ts
import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";
import { bomCosts, composeAddress, getAttention, quotationReadiness, type ProjectDetailDto, type ProjectListItemDto, type ProjectUpdateInput } from "@veenix/shared";
import { notFound, rule } from "../common/errors";
import { plain } from "../common/plain";
import { afterCommit, tx } from "../common/tx";
import { claim, removeObject } from "../storage/storage";
import { MembershipModel } from "../orgs/membership.model";
import { ctx } from "../common/context";
import { indexProject } from "../leads/leads.service";
import { PurchaseOrderModel } from "../procurement/purchase-order.model";
import { ProjectModel, loadProject } from "./project.model";
import { buildCores } from "./core";

@Injectable()
export class ProjectsService {
  async list(): Promise<ProjectListItemDto[]> {
    const projects = await ProjectModel.find().select("-workItems -bomItems").sort({ createdAt: -1 }).lean();
    const pos = await PurchaseOrderModel.find({ projectId: { $in: projects.map((p) => p._id) } }).select("-milestones").lean();
    return projects.map((p) => {
      const d = plain<ProjectListItemDto>(p);
      return { ...d, milestones: d.milestones.map((m) => ({ ...m, projectId: d.id })), purchaseOrders: pos.filter((po) => po.projectId.equals(p._id)).map((po) => plain(po)) } as ProjectListItemDto;
    });
  }

  async detail(id: Types.ObjectId): Promise<ProjectDetailDto> {
    const p = await ProjectModel.findById(id).lean();
    if (!p) throw notFound("Project");
    const { cores: [core], org } = await buildCores([p]);
    const readiness = quotationReadiness(core.workItems, core.bomItems);
    return {
      ...core,
      costs: bomCosts(core.bomItems),
      readiness,
      attention: getAttention(core, readiness),
      pricing: { defaultMarkupPct: org.defaultMarkupPct, minMarkupPct: org.minMarkupPct, sstBps: org.sstBps },
    };
  }

  /** Ports actions/projects.ts updateProject. */
  async update(id: Types.ObjectId, input: ProjectUpdateInput) {
    await tx(async () => {
      const project = await loadProject(id);
      const oldPhoto = project.photoPath;
      const { photo, ...fields } = input;
      if (photo === "remove") project.photoPath = null;
      else if (photo) project.photoPath = (await claim(photo, "photos")).path;
      if (fields.stage !== project.stage) project.stageEnteredAt = new Date();
      project.set({
        ...fields,
        siteAddress: composeAddress(fields),
        cancelReason: fields.stage === "CANCELLED" ? fields.cancelReason : null,
      });
      await project.save();
      if (oldPhoto && oldPhoto !== project.photoPath) afterCommit(() => removeObject(oldPhoto));
      indexProject(project);
    });
  }

  /** Who the project is assigned to. Each person must be an active member holding that same role. */
  async setAssignees(id: Types.ObjectId, input: { assignees: { userId: string; role: "project_manager" | "site_staff" }[] }) {
    const members = await MembershipModel.find({ orgId: ctx().orgId, status: "active", userId: { $in: input.assignees.map((a) => new Types.ObjectId(a.userId)) } }).lean();
    for (const a of input.assignees) {
      const m = members.find((x) => String(x.userId) === a.userId);
      if (!m) throw rule("Everyone assigned must be a member of this organization");
      if (m.role !== a.role) throw rule(`That person's role is ${m.role.replace("_", " ")}, not ${a.role.replace("_", " ")}`);
    }
    const project = await loadProject(id);
    project.set("assignees", input.assignees.map((a) => ({ userId: new Types.ObjectId(a.userId), role: a.role })));
    await project.save();
    indexProject(project);
  }
}
```

- [x] **Step 4: Write `src/projects/projects.controller.ts`**

```ts
import { Controller, Get, Patch, Put } from "@nestjs/common";
import { Types } from "mongoose";
import { assigneesInput, projectUpdateInput, type ProjectUpdateInput } from "@veenix/shared";
import { Can } from "../common/decorators";
import { OidParam } from "../common/oid";
import { ZBody } from "../common/zod";
import { ProjectsService } from "./projects.service";

@Controller("projects")
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Can("project:read") @Get() list() { return this.projects.list(); }
  @Can("project:read") @Get(":id") detail(@OidParam("id") id: Types.ObjectId) { return this.projects.detail(id); }
  @Can("project:write") @Patch(":id") update(@OidParam("id") id: Types.ObjectId, @ZBody(projectUpdateInput) b: ProjectUpdateInput) { return this.projects.update(id, b); }
  @Can("project:assign") @Put(":id/assignees") assign(@OidParam("id") id: Types.ObjectId, @ZBody(assigneesInput) b: Parameters<ProjectsService["setAssignees"]>[1]) { return this.projects.setAssignees(id, b); }
}
```

- [x] **Step 5: Check it**

Run: `pnpm --filter api typecheck && pnpm --filter api test`
Expected: PASS. Task 6.5's test calls `detail()` on a real project.

- [x] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): project detail payload with batched joins, list, update, assignees"
```

---

### Task 6.5: Work items, BOM, the draft-quotation refresh

**Files:**
- Create: `apps/api/src/quotations/draft.ts`, `apps/api/src/projects/bom.service.ts`, `apps/api/src/projects/bom.controller.ts`
- Test: `apps/api/src/projects/bom.test.ts`

**Interfaces:**
- Consumes: `loadProject`, the models, `nextCode`, `withMarkup`, `bomCosts`, `quotationReadiness`, `calcBomTotal`, `lineTotal`, `WORK_UNITS`.
- Produces:
  - in `draft.ts`:
    - `readinessOf(project: ProjectDoc): Readiness`
    - `readinessError(blockers): string`
    - `createDraft(project, basedOn: QuotationDoc | null, defaultMarkup?: number): Promise<QuotationDoc>`
    - `refreshDraftQuotation(project): Promise<void>`
  - `BomService.createWorkItem(projectId, input)`, `updateWorkItem(workItemId, input)`, `deleteWorkItem(workItemId)`, `saveBomItem(projectId, bomItemId | null, input)`, `deleteBomItem(bomItemId)`
  - routes (all `bom:write`):
    - `POST /v1/projects/:id/work-items`
    - `PATCH /v1/work-items/:workItemId`
    - `DELETE /v1/work-items/:workItemId`
    - `POST /v1/projects/:id/bom-items`
    - `PUT /v1/projects/:id/bom-items/:bomItemId`
    - `DELETE /v1/bom-items/:bomItemId`

- [ ] **Step 1: Write the failing test** `src/projects/bom.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { BomService } from "./bom.service";
import { ProjectModel } from "./project.model";
import { RfqModel } from "../procurement/rfq.model";
import { QuotationModel } from "../quotations/quotation.model";
import { OrgModel } from "../orgs/org.model";
import { asOrg, newId } from "../../test/ctx";

const bom = new BomService();
const org = newId();
const run = <T>(fn: () => Promise<T>) => asOrg(org, fn);

async function seedProject() {
  await OrgModel.create([{ _id: org, companyName: "T", createdBy: newId() }]);
  const [p] = await run(() => ProjectModel.create([{ code: "PRJ-2026-0001", name: "Condo", clientName: "Aisyah", siteAddress: "x" }]));
  return p._id;
}

describe("BOM", () => {
  it("computes totals in sen on the server and keeps the draft in step", async () => {
    const projectId = await seedProject();
    await run(() => bom.createWorkItem(projectId, { name: "Kitchen", description: null }));
    const wi = (await run(() => ProjectModel.findById(projectId).lean()))!.workItems[0];
    await run(() => bom.saveBomItem(projectId, null, {
      workItemId: String(wi._id), workPackage: "Cabinets", description: null, unit: "ft run", qty: 12.5, unitCost: 34500, performedBy: "SELF",
      materials: [{ name: "Plywood", qty: 3, unit: "pcs", unitCost: 8990 }],
    }));
    const line = (await run(() => ProjectModel.findById(projectId).lean()))!.bomItems[0];
    expect(line.estTotal).toBe(431250 + 26970);
  });

  it("refuses duplicate work item names, case-insensitively", async () => {
    const projectId = (await run(() => ProjectModel.findOne().lean()))!._id;
    await expect(run(() => bom.createWorkItem(projectId, { name: "kitchen", description: null }))).rejects.toThrow('"kitchen" already exists on this project');
  });

  it("cascades a BOM delete to its RFQ and unlinks quotation lines", async () => {
    const p = (await run(() => ProjectModel.findOne().lean()))!;
    const b = p.bomItems[0];
    await run(() => RfqModel.create([{ code: "RFQ-0001", projectId: p._id, bomItemId: b._id, quantity: "1 lot" }]));
    await run(() => QuotationModel.create([{ code: "QT-2026-0001", revision: 1, projectId: p._id, status: "SUPERSEDED", lineItems: [{ bomItemId: b._id, workPackage: "Cabinets", bomCost: 1, markupPct: 0, clientPrice: 1 }] }]));
    await run(() => bom.deleteBomItem(b._id));
    expect(await run(() => RfqModel.countDocuments({ bomItemId: b._id }))).toBe(0);
    expect((await run(() => QuotationModel.findOne({ code: "QT-2026-0001" }).lean()))!.lineItems[0].bomItemId).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter api test bom`
Expected: FAIL (service missing).

- [ ] **Step 3: Write `src/quotations/draft.ts`** (ports `lib/bom.ts`: `fillQuotationFromBom`, `refreshDraftQuotation`, `createDraftQuotation`, `getQuotationReadiness`)

```ts
import { Types } from "mongoose";
import { bomCosts, quotationReadiness, withMarkup, type Blocker, type BomItemDto, type WorkItemDto } from "@veenix/shared";
import { plain } from "../common/plain";
import { nextCode } from "../counters/counters";
import { loadOrg } from "../orgs/org.model";
import type { ProjectDoc } from "../projects/project.model";
import { QuotationModel, type QuotationDoc } from "./quotation.model";

export function readinessOf(project: ProjectDoc) {
  return quotationReadiness(plain<WorkItemDto[]>(project.workItems), plain<BomItemDto[]>(project.bomItems));
}

export function readinessError(blockers: Blocker[]) {
  return `Not ready to quote yet: ${blockers[0].message}${blockers.length > 1 ? ` (+${blockers.length - 1} more)` : ""}`;
}

/** Rewrites a draft's lines from the live BOM: priced lines only, in work-item order, keeping any markup already set. */
function fill(quotation: QuotationDoc, project: ProjectDoc, markups: Map<string, number>, defaultMarkup: number) {
  const bomItems = plain<BomItemDto[]>(project.bomItems);
  const costs = bomCosts(bomItems);
  const workItems = new Map(plain<WorkItemDto[]>(project.workItems).map((w) => [w.id, w]));
  const ready = bomItems
    .filter((b) => b.workItemId && workItems.has(b.workItemId) && costs[b.id].priced)
    .sort((a, b) => workItems.get(a.workItemId!)!.seq - workItems.get(b.workItemId!)!.seq || a.seq - b.seq);
  quotation.set(
    "lineItems",
    ready.map((b, i) => {
      const cost = costs[b.id].cost;
      const markupPct = markups.get(b.id) ?? defaultMarkup;
      return {
        bomItemId: new Types.ObjectId(b.id), workItemName: workItems.get(b.workItemId!)!.name, workPackage: b.workPackage,
        qty: b.qty, unit: b.unit, bomCost: cost, markupPct, clientPrice: withMarkup(cost, markupPct), seq: i,
      };
    }),
  );
}

const markupsOf = (q: QuotationDoc | null) => new Map((q?.lineItems ?? []).filter((l) => l.bomItemId).map((l) => [String(l.bomItemId), l.markupPct]));

/** Edits, deletions and newly priced work flow into the draft without a manual sync. */
export async function refreshDraftQuotation(project: ProjectDoc) {
  const draft = await QuotationModel.findOne({ projectId: project._id, status: "DRAFT" });
  if (!draft) return;
  fill(draft, project, markupsOf(draft), (await loadOrg()).defaultMarkupPct);
  await draft.save();
}

export async function createDraft(project: ProjectDoc, basedOn: QuotationDoc | null, defaultMarkup?: number) {
  const last = await QuotationModel.findOne({ projectId: project._id }).sort({ revision: -1 }).lean();
  const draft = new QuotationModel({
    code: await nextCode("QT"),
    projectId: project._id,
    revision: (last?.revision ?? 0) + 1,
    status: "DRAFT",
    events: [{ type: "CREATED", note: basedOn ? `Revised from Rev ${basedOn.revision}` : null }],
    terms: (basedOn?.terms ?? []).map((t) => ({ seq: t.seq, name: t.name, trigger: t.trigger, pct: t.pct })),
  });
  fill(draft, project, markupsOf(basedOn), defaultMarkup ?? (await loadOrg()).defaultMarkupPct);
  await draft.save();
  return draft;
}
```

- [ ] **Step 4: Write `src/projects/bom.service.ts`** (ports `actions/bom.ts` and `actions/workItems.ts`)

```ts
import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";
import { calcBomTotal, lineTotal, WORK_UNITS, type BomItemInput } from "@veenix/shared";
import { findSub } from "../common/fields";
import { notFound, rule } from "../common/errors";
import { tx } from "../common/tx";
import { changed } from "../live/live";
import { PurchaseOrderModel } from "../procurement/purchase-order.model";
import { RfqModel } from "../procurement/rfq.model";
import { QuotationModel } from "../quotations/quotation.model";
import { refreshDraftQuotation } from "../quotations/draft";
import { VariationOrderModel } from "../variations/variation-order.model";
import { loadProject, loadProjectBy, type ProjectDoc } from "./project.model";

type Id = Types.ObjectId;

/** Why a BOM line can't be removed, or null if it can. Same messages as the old lib/bom.ts. */
async function deleteBlocker(projectId: Id, bomItemId: Id): Promise<string | null> {
  const rfq = await RfqModel.findOne({ projectId, bomItemId }).select("_id").lean();
  if (rfq) {
    const po = await PurchaseOrderModel.findOne({ rfqId: rfq._id }).select("code").lean();
    if (po) return `already has purchase order ${po.code}`;
  }
  if (await QuotationModel.exists({ projectId, status: "ACCEPTED", "lineItems.bomItemId": bomItemId })) {
    return "is part of the signed quotation, so removing it needs a Variation Order";
  }
  return null;
}

/** What Prisma's onDelete rules used to do (spec §5.3). */
async function cascade(projectId: Id, bomItemIds: Id[]) {
  await RfqModel.deleteMany({ projectId, bomItemId: { $in: bomItemIds } });
  await QuotationModel.updateMany(
    { projectId, "lineItems.bomItemId": { $in: bomItemIds } },
    { $set: { "lineItems.$[l].bomItemId": null } },
    { arrayFilters: [{ "l.bomItemId": { $in: bomItemIds } }] },
  );
  await VariationOrderModel.updateMany({ projectId, bomItemId: { $in: bomItemIds } }, { $set: { bomItemId: null } });
}

async function saveAndRefresh(project: ProjectDoc) {
  await project.save();
  await refreshDraftQuotation(project);
  changed({ kind: "project", projectId: String(project._id) });
}

const nameTaken = (project: ProjectDoc, name: string, exceptId?: Id) =>
  project.workItems.some((w) => !(exceptId && w._id.equals(exceptId)) && w.name.toLowerCase() === name.toLowerCase());

@Injectable()
export class BomService {
  async createWorkItem(projectId: Id, input: { name: string; description: string | null }) {
    await tx(async () => {
      const project = await loadProject(projectId);
      if (nameTaken(project, input.name)) throw rule(`"${input.name}" already exists on this project`);
      project.workItems.push({ seq: project.workItems.length + 1, ...input });
      await project.save();
      changed({ kind: "project", projectId: String(projectId) });
    });
  }

  async updateWorkItem(workItemId: Id, input: { name: string; description: string | null }) {
    await tx(async () => {
      const project = await loadProjectBy({ "workItems._id": workItemId }, "Work item");
      const item = findSub(project.workItems, workItemId)!;
      if (nameTaken(project, input.name, workItemId)) throw rule(`"${input.name}" already exists on this project`);
      item.set(input);
      await saveAndRefresh(project);
    });
  }

  /** Removes the work item and every BOM line under it. Refused if any line has a PO or is in the signed quotation. */
  async deleteWorkItem(workItemId: Id) {
    await tx(async () => {
      const project = await loadProjectBy({ "workItems._id": workItemId }, "Work item");
      const projectId = project._id;
      const lines = project.bomItems.filter((b) => b.workItemId?.equals(workItemId));
      for (const b of lines) {
        const blocker = await deleteBlocker(projectId, b._id);
        if (blocker) throw rule(`Cannot delete: "${b.workPackage}" ${blocker}.`);
      }
      await cascade(projectId, lines.map((b) => b._id));
      project.set("bomItems", project.bomItems.filter((b) => !b.workItemId?.equals(workItemId)));
      project.set("workItems", project.workItems.filter((w) => !w._id.equals(workItemId)));
      await saveAndRefresh(project);
    });
  }

  /** Create (bomItemId null) or edit a BOM line. The total is always recomputed here, never taken from the form. */
  async saveBomItem(projectId: Id, bomItemId: Id | null, input: BomItemInput) {
    await tx(async () => {
      const project = await loadProject(projectId);
      if (!findSub(project.workItems, input.workItemId)) throw rule("Choose a valid work item");
      const current = bomItemId ? findSub(project.bomItems, bomItemId) : undefined;
      if (bomItemId && !current) throw notFound("BOM line");
      // A unit outside the list is only allowed if the line already had it (old data).
      if (!WORK_UNITS.includes(input.unit) && current?.unit !== input.unit) throw rule("Choose a unit from the list");

      const qty = input.unit === "lot" ? 1 : input.qty;
      const materials = input.performedBy === "SELF" ? input.materials.map((m) => ({ ...m, total: lineTotal(m.qty, m.unitCost) })) : [];
      const { total } = calcBomTotal({ qty, unitCost: input.unitCost, materials });
      if (total <= 0) throw rule("Enter a cost: the line total must be greater than zero");

      const fields = {
        workItemId: new Types.ObjectId(input.workItemId), workPackage: input.workPackage, description: input.description,
        qty, unit: input.unit, unitCost: input.unitCost, estTotal: total, performedBy: input.performedBy, materials,
      };
      if (current) {
        if (input.performedBy === "SELF" && (await RfqModel.exists({ projectId, bomItemId }))) {
          throw rule("This line already has vendor RFQs. Remove the vendor requests before making it self-performed.");
        }
        current.set(fields);
      } else {
        project.bomItems.push({ ...fields, seq: Math.max(0, ...project.bomItems.map((b) => b.seq)) + 1 });
      }
      await saveAndRefresh(project);
    });
  }

  async deleteBomItem(bomItemId: Id) {
    await tx(async () => {
      const project = await loadProjectBy({ "bomItems._id": bomItemId }, "BOM line");
      const projectId = project._id;
      const blocker = await deleteBlocker(projectId, bomItemId);
      if (blocker) throw rule(`Cannot delete: this line ${blocker}.`);
      await cascade(projectId, [bomItemId]);
      project.set("bomItems", project.bomItems.filter((b) => !b._id.equals(bomItemId)));
      await saveAndRefresh(project);
    });
  }
}
```

- [ ] **Step 5: Write `src/projects/bom.controller.ts`**

```ts
import { Controller, Delete, Patch, Post, Put } from "@nestjs/common";
import { Types } from "mongoose";
import { bomItemInput, workItemInput, type BomItemInput } from "@veenix/shared";
import { Can } from "../common/decorators";
import { OidParam } from "../common/oid";
import { ZBody } from "../common/zod";
import { BomService } from "./bom.service";

type WorkItemBody = { name: string; description: string | null };

@Controller()
export class BomController {
  constructor(private readonly bom: BomService) {}

  @Can("bom:write") @Post("projects/:id/work-items") createWork(@OidParam("id") id: Types.ObjectId, @ZBody(workItemInput) b: WorkItemBody) { return this.bom.createWorkItem(id, b); }
  @Can("bom:write") @Patch("work-items/:workItemId") updateWork(@OidParam("workItemId") wid: Types.ObjectId, @ZBody(workItemInput) b: WorkItemBody) { return this.bom.updateWorkItem(wid, b); }
  @Can("bom:write") @Delete("work-items/:workItemId") deleteWork(@OidParam("workItemId") wid: Types.ObjectId) { return this.bom.deleteWorkItem(wid); }
  @Can("bom:write") @Post("projects/:id/bom-items") createLine(@OidParam("id") id: Types.ObjectId, @ZBody(bomItemInput) b: BomItemInput) { return this.bom.saveBomItem(id, null, b); }
  @Can("bom:write") @Put("projects/:id/bom-items/:bomItemId") updateLine(@OidParam("id") id: Types.ObjectId, @OidParam("bomItemId") bid: Types.ObjectId, @ZBody(bomItemInput) b: BomItemInput) { return this.bom.saveBomItem(id, bid, b); }
  @Can("bom:write") @Delete("bom-items/:bomItemId") deleteLine(@OidParam("bomItemId") bid: Types.ObjectId) { return this.bom.deleteBomItem(bid); }
}
```

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter api test bom`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api
git commit -m "feat(api): work items and BOM with cascades and draft-quotation refresh"
```

---

### Task 6.6: Quotations

**Files:**
- Create: `apps/api/src/billing/schedule.ts`, `apps/api/src/quotations/quotations.service.ts`, `apps/api/src/quotations/quotations.controller.ts`
- Test: `apps/api/src/quotations/quotations.test.ts`

**Interfaces:**
- Consumes: `createDraft`, `readinessOf`, `readinessError` (Task 6.5); `quotationTotals`, `allocate`, `OPEN_QUOTATION_STATUSES`.
- Produces:
  - `applySchedule(project, terms, contractSum)`: sets `project.milestones`
  - `QuotationsService`:

    | Method | Replaces |
    |---|---|
    | `build(projectId, input)` | `buildQuotation` |
    | `revise(id)` | `createRevision` |
    | `discard(id)` | `discardDraft` |
    | `setLineMarkup(lineId, input)` | `updateLineMarkup` |
    | `applyMarkup(id, input)` | `applyMarkupToAll` |
    | `setTerms(id, input)` | `saveQuotationTerms` |
    | `send(id)` | `sendQuotation` |
    | `viewed(id)` | `recordClientResponse(VIEWED)` |
    | `question(id, input)` | `recordClientQuestion` |
    | `reply(id, input)` | `recordReply` |
    | `accept(id, input)` | `recordClientResponse(ACCEPTED)` |

  - routes (each with the permission named after the arrow):
    - `POST /v1/projects/:id/quotations` → `quotation:write`
    - `POST /v1/quotations/:id/revisions` → `quotation:write`
    - `DELETE /v1/quotations/:id` → `quotation:write`
    - `PATCH /v1/quotation-lines/:lineId` → `quotation:write`
    - `POST /v1/quotations/:id/markup` → `quotation:write`
    - `PUT /v1/quotations/:id/terms` → `quotation:write`
    - `POST /v1/quotations/:id/send` → `quotation:send`
    - `POST /v1/quotations/:id/viewed` → `quotation:record`
    - `POST /v1/quotations/:id/questions` → `quotation:record`
    - `POST /v1/quotations/:id/replies` → `quotation:record`
    - `POST /v1/quotations/:id/accept` → `quotation:record`

- [ ] **Step 1: Write the failing test** `src/quotations/quotations.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { QuotationsService } from "./quotations.service";
import { QuotationModel } from "./quotation.model";
import { BomService } from "../projects/bom.service";
import { ProjectModel } from "../projects/project.model";
import { OrgModel } from "../orgs/org.model";
import { asOrg, newId } from "../../test/ctx";

const q = new QuotationsService();
const bom = new BomService();
const org = newId();
const run = <T>(fn: () => Promise<T>) => asOrg(org, fn);
const terms = { terms: [{ name: "Deposit", trigger: "On acceptance", pct: 30 }, { name: "Completion", trigger: "Handover", pct: 70 }] };

async function pricedProject() {
  await OrgModel.create([{ _id: org, companyName: "T", createdBy: newId() }]);
  const [p] = await run(() => ProjectModel.create([{ code: "PRJ-2026-0001", name: "Condo", clientName: "Aisyah", siteAddress: "x" }]));
  await run(() => bom.createWorkItem(p._id, { name: "Kitchen", description: null }));
  const wi = (await run(() => ProjectModel.findById(p._id).lean()))!.workItems[0];
  await run(() => bom.saveBomItem(p._id, null, { workItemId: String(wi._id), workPackage: "Cabinets", description: null, unit: "lot", qty: 1, unitCost: 1_000_000, performedBy: "SELF", materials: [] }));
  return p._id;
}

describe("QuotationsService", () => {
  it("runs draft → sent → signed atomically and builds the schedule", async () => {
    const projectId = await pricedProject();
    const { id } = await run(() => q.build(projectId, { markupPct: 40 }));
    await expect(run(() => q.send(id))).rejects.toThrow("Set the payment terms first");
    await run(() => q.setTerms(id, terms));
    await run(() => q.send(id));
    const { id: draft2 } = await run(() => q.revise(id)); // a newer draft while Rev 1 is with the client
    await run(() => q.accept(id, { signedBy: "Aisyah" }));

    const project = (await run(() => ProjectModel.findById(projectId).lean()))!;
    expect(project.contractValue).toBe(1_512_000); // 1,000,000 × 1.4 + 8% SST
    expect(project.milestones.map((m) => [m.name, m.amount, m.status])).toEqual([
      ["Deposit", 453_600, "AWAITING_PAYMENT"],
      ["Completion", 1_058_400, "NOT_YET_DUE"],
    ]);
    expect(await run(() => QuotationModel.findById(draft2).lean())).toBeNull();
    await expect(run(() => q.revise(id))).rejects.toThrow("The quotation is signed. Further changes go through Variation Orders.");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter api test quotations`
Expected: FAIL (service missing).

- [ ] **Step 3: Write `src/billing/schedule.ts`**

```ts
import { allocate, type Sen } from "@veenix/shared";
import type { ProjectDoc } from "../projects/project.model";

/** Turns payment terms into the project's client payment schedule. The first payment is due straight away. */
export function applySchedule(project: ProjectDoc, terms: { name: string; trigger: string; pct: number }[], contractSum: Sen) {
  const amounts = allocate(contractSum, terms);
  project.set("milestones", terms.map((t, i) => ({
    seq: i + 1, name: t.name, trigger: t.trigger, pct: t.pct, amount: amounts[i], status: i === 0 ? "AWAITING_PAYMENT" : "NOT_YET_DUE",
  })));
}
```

- [ ] **Step 4: Write `src/quotations/quotations.service.ts`** (ports `actions/quotation.ts`)

```ts
import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";
import { OPEN_QUOTATION_STATUSES, quotationTotals, withMarkup, type QuotationStatus } from "@veenix/shared";
import { ctx } from "../common/context";
import { findSub } from "../common/fields";
import { notFound, rule } from "../common/errors";
import { tx } from "../common/tx";
import { audit } from "../audit/audit";
import { changed } from "../live/live";
import { indexEntry } from "../search/search";
import { applySchedule } from "../billing/schedule";
import { loadOrg } from "../orgs/org.model";
import { loadProject } from "../projects/project.model";
import { QuotationModel, type QuotationDoc } from "./quotation.model";
import { createDraft, readinessError, readinessOf } from "./draft";

type Id = Types.ObjectId;
const isOpen = (s: string) => OPEN_QUOTATION_STATUSES.includes(s as QuotationStatus);

async function loadQuotation(id: Id) {
  const q = await QuotationModel.findById(id);
  if (!q) throw notFound("Quotation");
  return q;
}

function event(q: QuotationDoc, type: string, note: string | null = null) {
  q.events.push({ type, note, actorId: ctx().userId });
}

async function saved(q: QuotationDoc, projectName?: string) {
  await q.save();
  indexEntry({ kind: "quotation", refId: q._id, projectId: q.projectId, title: q.code, subtitle: projectName ?? `Rev ${q.revision}` });
  changed({ kind: "project", projectId: String(q.projectId) });
}

@Injectable()
export class QuotationsService {
  async build(projectId: Id, input: { markupPct: number }) {
    return tx(async () => {
      if (await QuotationModel.exists({ projectId })) throw rule("This project already has a quotation. Create a new version from it instead.");
      const project = await loadProject(projectId);
      const readiness = readinessOf(project);
      if (!readiness.ready) throw rule(readinessError(readiness.blockers));
      const q = await createDraft(project, null, input.markupPct);
      await saved(q, project.name);
      return { id: String(q._id) };
    });
  }

  async revise(fromId: Id) {
    return tx(async () => {
      const from = await loadQuotation(fromId);
      const others = await QuotationModel.find({ projectId: from.projectId }).select("status").lean();
      if (others.some((q) => q.status === "ACCEPTED")) throw rule("The quotation is signed. Further changes go through Variation Orders.");
      if (others.some((q) => q.status === "DRAFT")) throw rule("Finish or discard the current draft first.");
      const project = await loadProject(from.projectId);
      const q = await createDraft(project, from);
      await saved(q, project.name);
      return { id: String(q._id) };
    });
  }

  async discard(id: Id) {
    const q = await loadQuotation(id);
    if (q.status !== "DRAFT") throw rule("Only a draft can be discarded");
    await QuotationModel.deleteOne({ _id: id });
    changed({ kind: "project", projectId: String(q.projectId) });
  }

  private async draftForEdit(id: Id) {
    const q = await loadQuotation(id);
    if (q.status !== "DRAFT") throw rule("Only a draft can be edited. Create a new version to change prices.");
    return q;
  }

  async setLineMarkup(lineId: Id, input: { markupPct: number }) {
    const owner = await QuotationModel.findOne({ "lineItems._id": lineId }).select("_id").lean();
    if (!owner) throw notFound("Quotation line");
    const q = await this.draftForEdit(owner._id);
    const line = findSub(q.lineItems, lineId)!;
    line.set({ markupPct: input.markupPct, clientPrice: withMarkup(line.bomCost, input.markupPct) });
    await saved(q);
  }

  async applyMarkup(id: Id, input: { markupPct: number }) {
    const q = await this.draftForEdit(id);
    for (const line of q.lineItems) line.set({ markupPct: input.markupPct, clientPrice: withMarkup(line.bomCost, input.markupPct) });
    await saved(q);
  }

  /** Replaces the client payment terms on a draft. Amounts aren't stored; they're the term's share of the total. */
  async setTerms(id: Id, input: { terms: { name: string; trigger: string; pct: number }[] }) {
    const q = await loadQuotation(id);
    if (q.status !== "DRAFT") throw rule("Payment terms can only be changed on a draft. Create a new version to change them.");
    q.set("terms", input.terms.map((t, i) => ({ seq: i + 1, ...t })));
    await saved(q);
  }

  async send(id: Id) {
    await tx(async () => {
      const q = await loadQuotation(id);
      if (q.status !== "DRAFT") throw rule("Only a draft can be sent");
      if (q.lineItems.length === 0) throw rule("There are no priced lines to send");
      if (q.terms.reduce((s, t) => s + t.pct, 0) !== 100) throw rule("Set the payment terms first. They must add up to 100% of the contract sum.");
      const project = await loadProject(q.projectId);
      const readiness = readinessOf(project);
      if (!readiness.ready) throw rule(readinessError(readiness.blockers));

      await QuotationModel.updateMany({ projectId: q.projectId, status: { $in: OPEN_QUOTATION_STATUSES } }, { $set: { status: "SUPERSEDED" } });
      q.set({ status: "SENT", sentAt: new Date() });
      event(q, "SENT");
      await saved(q, project.name);
      await audit("quotation.sent", "quotation", q._id, { revision: q.revision }, q.projectId);
      // plan 07 adds: await enqueue("document.snapshot", { type: "quotation", id: String(q._id) });
    });
  }

  private async openForClient(id: Id) {
    const q = await loadQuotation(id);
    if (!isOpen(q.status)) throw rule("This version is not awaiting a client response");
    return q;
  }

  async viewed(id: Id) {
    const q = await this.openForClient(id);
    q.set({ status: "VIEWED", viewedAt: q.viewedAt ?? new Date() });
    event(q, "VIEWED");
    await saved(q);
  }

  /** The client asked something (a call, WhatsApp, a site visit). The version waits for our reply. */
  async question(id: Id, input: { comment: string }) {
    const q = await this.openForClient(id);
    q.set({ status: "QUESTIONED", viewedAt: q.viewedAt ?? new Date() });
    event(q, "QUESTIONED", input.comment);
    await saved(q);
  }

  async reply(id: Id, input: { reply: string }) {
    const q = await loadQuotation(id);
    if (q.status !== "QUESTIONED") throw rule("There is no open client question to reply to");
    q.set({ status: "VIEWED" });
    event(q, "REPLIED", input.reply);
    await saved(q);
  }

  /** Client signed: one transaction drops drafts, supersedes other open versions, sets the contract value and creates the schedule. */
  async accept(id: Id, input: { signedBy: string | null }) {
    await tx(async () => {
      const q = await this.openForClient(id);
      const project = await loadProject(q.projectId);
      const signedBy = input.signedBy ?? project.clientName;
      const total = quotationTotals(q.lineItems, (await loadOrg()).sstBps).total;

      await QuotationModel.deleteMany({ projectId: q.projectId, status: "DRAFT" });
      await QuotationModel.updateMany({ projectId: q.projectId, _id: { $ne: q._id }, status: { $in: OPEN_QUOTATION_STATUSES } }, { $set: { status: "SUPERSEDED" } });
      q.set({ status: "ACCEPTED", acceptedAt: new Date(), signedBy });
      event(q, "ACCEPTED", `Signed by ${signedBy}`);
      await saved(q, project.name);

      project.contractValue = total;
      // The client's payment schedule follows the terms they just signed.
      if (project.milestones.length === 0 && q.terms.length > 0) applySchedule(project, q.terms, total);
      await project.save();
      await audit("quotation.accepted", "quotation", q._id, { total, signedBy }, q.projectId);
    });
  }
}
```

- [ ] **Step 5: Write `src/quotations/quotations.controller.ts`**

Use the same pattern as the BOM controller: the `projects/:id/quotations` route lives in this controller as `@Post("projects/:id/quotations")` under `@Controller()`, and the rest are `quotations/...`. Body schemas:

| Route | Body schema |
|---|---|
| build | `buildQuotationInput` |
| lines, markup | `markupInput` |
| terms | `termsInput` |
| questions | `clientQuestionInput` |
| replies | `replyInput` |
| accept | `clientSignedInput` |
| everything else | no body |

Permissions as listed in the Interfaces block.

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter api test quotations`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api
git commit -m "feat(api): quotations with versioning, client responses and atomic signing"
```

---

### Task 6.7: Procurement: RFQs, quotes, POs, vendor payments

**Files:**
- Create: `apps/api/src/procurement/procurement.service.ts`, `apps/api/src/procurement/procurement.controller.ts`
- Test: `apps/api/src/procurement/procurement.test.ts`

**Interfaces:**
- Consumes: `RfqModel`, `PurchaseOrderModel`, `loadProject`, `refreshDraftQuotation`, `claim`, `nextCode`, `allocate`, `formatNumber`, `formatCurrency`.
- Produces: `ProcurementService` methods and routes. Permissions:
  - `vendor_payment:write` for `po-milestones/*`
  - `procurement:write` for everything else

  | Method | Replaces | Route |
  |---|---|---|
  | `requestQuotes(bomItemId, input)` | `requestQuotes` | `POST /v1/bom-items/:bomItemId/rfq/invites` |
  | `removeRequest(quoteId)` | `removeVendorRequest` | `DELETE /v1/rfq-quotes/:quoteId` |
  | `quoteReceived(quoteId, input)` | `quoteReceived` | `POST /v1/rfq-quotes/:quoteId/received` |
  | `reviseQuote(quoteId, input)` | `reviseQuote` | `POST /v1/rfq-quotes/:quoteId/revisions` |
  | `acceptQuote(quoteId, input)` | `acceptQuote` | `POST /v1/rfq-quotes/:quoteId/accept` → `{ poId }` |
  | `setPoTerms(poId, input)` | `setPoTerms` | `PUT /v1/purchase-orders/:poId/terms` |
  | `attachVendorInvoice(milestoneId, input)` | `attachVendorInvoice` | `POST /v1/po-milestones/:milestoneId/invoice` |
  | `recordPayment(milestoneId, input)` | `recordMilestonePayment` | `POST /v1/po-milestones/:milestoneId/payment` |

- [ ] **Step 1: Write the failing test** `src/procurement/procurement.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { ProcurementService } from "./procurement.service";
import { PurchaseOrderModel } from "./purchase-order.model";
import { RfqModel } from "./rfq.model";
import { ProjectModel } from "../projects/project.model";
import { VendorModel } from "../vendors/vendor.model";
import { OrgModel } from "../orgs/org.model";
import { asOrg, newId } from "../../test/ctx";

const svc = new ProcurementService();
const org = newId();
const run = <T>(fn: () => Promise<T>) => asOrg(org, fn);
const terms = { terms: [{ label: "Deposit", pct: 50 }, { label: "Balance", pct: 50 }], deliveryBy: null, remarks: null };
const received = { quotedPrice: 500_001, leadTimeDays: 14, warrantyMonths: 12, notes: null, file: null };

describe("procurement", () => {
  it("awards one package once, even under a race, and pays within the milestone", async () => {
    await OrgModel.create([{ _id: org, companyName: "T", createdBy: newId() }]);
    const [v1, v2] = await run(() => VendorModel.create([{ name: "KH Carpentry" }, { name: "Elite Woodwork" }]));
    const [p] = await run(() => ProjectModel.create([{ code: "PRJ-2026-0001", name: "Condo", clientName: "A", siteAddress: "x", bomItems: [{ seq: 1, workPackage: "Cabinets", estTotal: 600_000 }] }]));
    const bomId = p.bomItems[0]._id;

    await run(() => svc.requestQuotes(bomId, { vendorIds: [String(v1._id), String(v2._id)], respondBy: null, note: null }));
    const rfq = (await run(() => RfqModel.findOne({ bomItemId: bomId }).lean()))!;
    const [q1, q2] = rfq.quotes;
    await run(() => svc.quoteReceived(q1._id, received));
    await run(() => svc.quoteReceived(q2._id, { ...received, quotedPrice: 480_000 }));

    const results = await Promise.allSettled([run(() => svc.acceptQuote(q1._id, terms)), run(() => svc.acceptQuote(q2._id, terms))]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const po = (await run(() => PurchaseOrderModel.findOne({ rfqId: rfq._id }).lean()))!;
    expect(po.milestones.map((m) => m.amount).reduce((a, b) => a + b)).toBe(po.amount);
    const awarded = (await run(() => ProjectModel.findById(p._id).lean()))!.bomItems[0].awarded;
    expect(awarded!.amount).toBe(po.amount);

    const m = po.milestones[0];
    await expect(run(() => svc.recordPayment(m._id, { paidAmount: m.amount, paidDate: null, method: "Bank Transfer", bankRef: null, paidFrom: null }))).rejects.toThrow("Attach the vendor's invoice before recording payment");
    await run(() => PurchaseOrderModel.updateOne({ _id: po._id, "milestones._id": m._id }, { $set: { "milestones.$.status": "INVOICED" } }));
    await expect(run(() => svc.recordPayment(m._id, { paidAmount: m.amount + 1, paidDate: null, method: "Bank Transfer", bankRef: null, paidFrom: null }))).rejects.toThrow("can't be more than the milestone amount");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter api test procurement`
Expected: FAIL (service missing).

- [ ] **Step 3: Write `src/procurement/procurement.service.ts`** (ports the RFQ, quote, PO and payment parts of `actions/vendors.ts`)

```ts
import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";
import { allocate, formatCurrency, formatNumber } from "@veenix/shared";
import { findSub } from "../common/fields";
import { notFound, rule } from "../common/errors";
import { tx } from "../common/tx";
import { audit } from "../audit/audit";
import { nextCode } from "../counters/counters";
import { changed } from "../live/live";
import { indexEntry } from "../search/search";
import { claim } from "../storage/storage";
import { VendorModel } from "../vendors/vendor.model";
import { loadProject, loadProjectBy } from "../projects/project.model";
import { refreshDraftQuotation } from "../quotations/draft";
import { RfqModel } from "./rfq.model";
import { PurchaseOrderModel } from "./purchase-order.model";

type Id = Types.ObjectId;
type Terms = { label: string; pct: number }[];
type QuoteBody = { quotedPrice: number; leadTimeDays: number; warrantyMonths: number; notes: string | null; file: { key: string; name: string } | null };

const termRows = (amount: number, terms: Terms) => {
  const amounts = allocate(amount, terms);
  return terms.map((t, i) => ({ seq: i + 1, label: t.label, pct: t.pct, amount: amounts[i] }));
};

async function rfqWithQuote(quoteId: Id) {
  const rfq = await RfqModel.findOne({ "quotes._id": quoteId });
  if (!rfq) throw notFound("Quote");
  return { rfq, quote: findSub(rfq.quotes, quoteId)! };
}

async function assertNotAwarded(rfqId: Id, message = "This package has already been awarded") {
  if (await PurchaseOrderModel.exists({ rfqId })) throw rule(message);
}

async function poWithMilestone(milestoneId: Id) {
  const po = await PurchaseOrderModel.findOne({ "milestones._id": milestoneId });
  if (!po) throw notFound("Payment milestone");
  return { po, milestone: findSub(po.milestones, milestoneId)! };
}

const touched = (projectId: Id) => changed({ kind: "project", projectId: String(projectId) });

@Injectable()
export class ProcurementService {
  /** Asks one or many vendors to quote a package. One RFQ per package. */
  async requestQuotes(bomItemId: Id, input: { vendorIds: string[]; respondBy: Date | null; note: string | null }) {
    await tx(async () => {
      const project = await loadProjectBy({ "bomItems._id": bomItemId }, "BOM line");
      const projectId = project._id;
      const bom = findSub(project.bomItems, bomItemId)!;
      if (bom.performedBy === "SELF") throw rule("Self-performed work does not need an RFQ");
      const vendors = await VendorModel.find({ _id: { $in: input.vendorIds }, active: true }).select("_id").lean();
      if (vendors.length !== new Set(input.vendorIds).size) throw rule("Pick active vendors from your list");

      let rfq = await RfqModel.findOne({ projectId, bomItemId });
      if (rfq) await assertNotAwarded(rfq._id, "A vendor has already been awarded this package");
      if (!rfq) {
        rfq = new RfqModel({ code: await nextCode("RFQ"), projectId, bomItemId, quantity: `${formatNumber(bom.qty)} ${bom.unit}`, respondBy: input.respondBy, note: input.note });
      } else {
        if (input.respondBy) rfq.respondBy = input.respondBy;
        if (input.note) rfq.note = input.note;
      }
      const invited = new Set(rfq.quotes.map((q) => String(q.vendorId)));
      const toAdd = input.vendorIds.filter((id) => !invited.has(id));
      if (toAdd.length === 0) throw rule("Those vendors have already been asked to quote");
      for (const vendorId of toAdd) rfq.quotes.push({ vendorId: new Types.ObjectId(vendorId) });
      await rfq.save();
      touched(projectId);
    });
  }

  async removeRequest(quoteId: Id) {
    const { rfq, quote } = await rfqWithQuote(quoteId);
    await assertNotAwarded(rfq._id);
    if (quote.receivedAt) throw rule("A quote has already been received from this vendor");
    rfq.set("quotes", rfq.quotes.filter((q) => !q._id.equals(quoteId)));
    await rfq.save();
    touched(rfq.projectId);
  }

  async quoteReceived(quoteId: Id, input: QuoteBody) {
    const { rfq, quote } = await rfqWithQuote(quoteId);
    await assertNotAwarded(rfq._id);
    const file = input.file ? await claim(input.file, "quotes") : null;
    quote.set({
      quotedPrice: input.quotedPrice, leadTimeDays: input.leadTimeDays, warrantyMonths: input.warrantyMonths, notes: input.notes,
      receivedAt: quote.receivedAt ?? new Date(),
      ...(file ? { attachmentPath: file.path, attachmentName: file.name } : {}),
    });
    await rfq.save();
    touched(rfq.projectId);
  }

  /** A revised quote after negotiation. The previous offer goes into the history; the latest stays on the quote. */
  async reviseQuote(quoteId: Id, input: QuoteBody) {
    const { rfq, quote } = await rfqWithQuote(quoteId);
    await assertNotAwarded(rfq._id);
    if (!quote.receivedAt) throw rule("Record the vendor's first quote before adding a revised one");
    const file = input.file ? await claim(input.file, "quotes") : null;
    quote.revisions.push({
      round: quote.revisions.length + 1, quotedPrice: quote.quotedPrice, leadTimeDays: quote.leadTimeDays, warrantyMonths: quote.warrantyMonths,
      notes: quote.notes, attachmentPath: quote.attachmentPath, attachmentName: quote.attachmentName, receivedAt: quote.receivedAt,
    });
    quote.set({
      quotedPrice: input.quotedPrice, leadTimeDays: input.leadTimeDays, warrantyMonths: input.warrantyMonths, notes: input.notes,
      receivedAt: new Date(), attachmentPath: file?.path ?? null, attachmentName: file?.name ?? null,
    });
    await rfq.save();
    touched(rfq.projectId);
  }

  /** Creates the PO and its payment milestones, and copies the price onto the BOM line, in one transaction. */
  async acceptQuote(quoteId: Id, input: { terms: Terms; deliveryBy: Date | null; remarks: string | null }) {
    return tx(async () => {
      const { rfq, quote } = await rfqWithQuote(quoteId);
      if (!quote.receivedAt || quote.quotedPrice <= 0) throw rule("Mark the quote as received first");
      await assertNotAwarded(rfq._id, "A quote has already been accepted for this package");
      const project = await loadProject(rfq.projectId);
      const bom = findSub(project.bomItems, rfq.bomItemId);
      if (!bom) throw notFound("BOM line");

      // The unique rfqId index stops a second PO even if two people accept at the same moment.
      const [po] = await PurchaseOrderModel.create([{
        code: await nextCode("PO"), projectId: rfq.projectId, rfqId: rfq._id, vendorId: quote.vendorId,
        description: bom.workPackage, qty: rfq.quantity, amount: quote.quotedPrice,
        deliveryBy: input.deliveryBy, remarks: input.remarks, milestones: termRows(quote.quotedPrice, input.terms),
      }]);
      for (const q of rfq.quotes) q.selected = q._id.equals(quoteId);
      await rfq.save();
      bom.awarded = { poId: po._id, amount: po.amount };
      await project.save();
      await refreshDraftQuotation(project);

      const vendor = await VendorModel.findById(quote.vendorId).select("name").lean();
      indexEntry({ kind: "po", refId: po._id, projectId: po.projectId, title: po.code, subtitle: [vendor?.name, project.name].filter(Boolean).join(" · ") });
      await audit("quote.accepted", "purchase_order", po._id, { amount: po.amount, vendorId: String(quote.vendorId) }, po.projectId);
      touched(po.projectId);
      return { poId: String(po._id) };
    });
  }

  async setPoTerms(poId: Id, input: { terms: Terms }) {
    await tx(async () => {
      const po = await PurchaseOrderModel.findById(poId);
      if (!po) throw notFound("Purchase order");
      if (po.milestones.some((m) => m.status !== "PENDING")) throw rule("Payment terms are locked once a vendor invoice has been attached");
      po.set("milestones", termRows(po.amount, input.terms));
      await po.save();
      await audit("po.terms_changed", "purchase_order", po._id, { terms: input.terms }, po.projectId);
      touched(po.projectId);
    });
  }

  async attachVendorInvoice(milestoneId: Id, input: { invoiceNo: string; invoiceDate: Date | null; file: { key: string; name: string } | null }) {
    const { po, milestone } = await poWithMilestone(milestoneId);
    if (milestone.status === "PAID") throw rule("This milestone is already paid");
    if (!input.file && !milestone.invoicePath) throw rule("Attach the vendor's invoice (PDF or image)");
    const file = input.file ? await claim(input.file, "invoices") : null;
    milestone.set({
      status: "INVOICED", invoiceNo: input.invoiceNo, invoiceDate: input.invoiceDate ?? new Date(),
      ...(file ? { invoicePath: file.path, invoiceName: file.name } : {}),
    });
    await po.save();
    touched(po.projectId);
  }

  async recordPayment(milestoneId: Id, input: { paidAmount: number; paidDate: Date | null; method: string; bankRef: string | null; paidFrom: string | null }) {
    await tx(async () => {
      const { po, milestone } = await poWithMilestone(milestoneId);
      if (milestone.status === "PAID") throw rule("This milestone is already paid");
      if (milestone.status !== "INVOICED") throw rule("Attach the vendor's invoice before recording payment");
      if (input.paidAmount > milestone.amount) throw rule(`The amount paid can't be more than the milestone amount (${formatCurrency(milestone.amount)})`);
      milestone.set({ status: "PAID", paidAmount: input.paidAmount, paidDate: input.paidDate ?? new Date(), method: input.method, bankRef: input.bankRef, paidFrom: input.paidFrom });
      po.status = po.milestones.every((m) => m.status === "PAID") ? "PAID" : "ISSUED";
      await po.save();
      await audit("po_milestone.paid", "purchase_order", po._id, { milestoneId: String(milestoneId), paidAmount: input.paidAmount }, po.projectId);
      touched(po.projectId);
    });
  }
}
```

- [ ] **Step 4: Write `src/procurement/procurement.controller.ts`**

Use `@Controller()` with the full paths from the Interfaces table. Body schemas:

| Route | Body schema |
|---|---|
| invites | `requestQuotesInput` |
| received, revisions | `quoteInput` |
| accept | `acceptQuoteInput` |
| terms | `poTermsInput` |
| invoice | `vendorInvoiceInput` |
| payment | `vendorPaymentInput` |

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter api test procurement`
Expected: PASS. In the race, the loser fails with 409 `DUPLICATE` or `RULE` "A quote has already been accepted…". Either is correct.

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): procurement with one award per package and checked vendor payments"
```

---

### Task 6.8: Variation orders and billing

**Files:**
- Create: `apps/api/src/variations/variations.service.ts`, `variations/variations.controller.ts`, `apps/api/src/billing/billing.service.ts`, `billing/billing.controller.ts`
- Test: `apps/api/src/billing/billing.test.ts`

**Interfaces:**
- Produces:
  - `VariationsService.create(projectId, input)`, `send(id)`, `accept(id)`
  - `BillingService.createSchedule(projectId, input)`, `generateInvoice(milestoneId): { invoiceId }`, `markPaid(invoiceId)`
  - routes:

    | Route | Permission |
    |---|---|
    | `POST /v1/projects/:id/variation-orders` | `vo:write` |
    | `POST /v1/variation-orders/:id/send` | `vo:record` |
    | `POST /v1/variation-orders/:id/accept` | `vo:record` |
    | `POST /v1/projects/:id/payment-schedule` | `billing:write` |
    | `POST /v1/milestones/:milestoneId/invoice` | `billing:write` |
    | `POST /v1/invoices/:id/paid` | `billing:mark_paid` |

- [ ] **Step 1: Write the failing test** `src/billing/billing.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { BillingService } from "./billing.service";
import { VariationsService } from "../variations/variations.service";
import { InvoiceModel } from "./invoice.model";
import { ProjectModel } from "../projects/project.model";
import { QuotationModel } from "../quotations/quotation.model";
import { OrgModel } from "../orgs/org.model";
import { asOrg, newId } from "../../test/ctx";

const billing = new BillingService();
const vos = new VariationsService();
const org = newId();
const run = <T>(fn: () => Promise<T>) => asOrg(org, fn);

describe("billing and variation orders", () => {
  it("never doubles a VO or a payment, and splits SST from the milestone", async () => {
    await OrgModel.create([{ _id: org, companyName: "T", createdBy: newId() }]);
    const [p] = await run(() => ProjectModel.create([{ code: "PRJ-2026-0001", name: "Condo", clientName: "A", siteAddress: "x", contractValue: 1_080_000, milestones: [{ seq: 1, name: "Deposit", amount: 108_000, status: "AWAITING_PAYMENT" }] }]));
    await run(() => QuotationModel.create([{ code: "QT-2026-0001", revision: 1, projectId: p._id, status: "ACCEPTED" }]));

    const { id: voId } = await run(() => vos.create(p._id, { title: "Extra socket", description: "Two more points", reason: null, raisedBy: null, amount: 50_000, bomItemId: null, programmeImpact: null, file: null }));
    await run(() => vos.accept(voId));
    await expect(run(() => vos.accept(voId))).rejects.toThrow("This variation order is already accepted");
    const after = (await run(() => ProjectModel.findById(p._id).lean()))!;
    expect(after.contractValue).toBe(1_130_000);
    expect(after.milestones).toHaveLength(2);

    const { invoiceId } = await run(() => billing.generateInvoice(after.milestones[0]._id));
    const inv = (await run(() => InvoiceModel.findById(invoiceId).lean()))!;
    expect([inv.amount, inv.sstAmount, inv.code]).toEqual([100_000, 8_000, expect.stringMatching(/^INV-\d{4}-0001$/)]);
    await run(() => billing.markPaid(inv._id));
    await expect(run(() => billing.markPaid(inv._id))).rejects.toThrow("This invoice is already paid");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter api test billing`
Expected: FAIL (services missing).

- [ ] **Step 3: Write `src/variations/variations.service.ts`** (ports `actions/variationOrders.ts` and adds the missing state checks)

```ts
import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";
import type { VoInput } from "@veenix/shared";
import { findSub } from "../common/fields";
import { notFound, rule } from "../common/errors";
import { tx } from "../common/tx";
import { audit } from "../audit/audit";
import { nextCode } from "../counters/counters";
import { changed } from "../live/live";
import { claim } from "../storage/storage";
import { loadProject } from "../projects/project.model";
import { QuotationModel } from "../quotations/quotation.model";
import { VariationOrderModel } from "./variation-order.model";

type Id = Types.ObjectId;

async function loadVo(id: Id) {
  const vo = await VariationOrderModel.findById(id);
  if (!vo) throw notFound("Variation order");
  return vo;
}

@Injectable()
export class VariationsService {
  async create(projectId: Id, input: VoInput) {
    return tx(async () => {
      if (!(await QuotationModel.exists({ projectId, status: "ACCEPTED" }))) throw rule("Variation orders start once the client has signed a quotation");
      const project = await loadProject(projectId);
      if (input.bomItemId && !findSub(project.bomItems, input.bomItemId)) throw rule("Choose a valid BOM line");
      const { file, ...fields } = input;
      const upload = file ? await claim(file, "vo") : null;
      const [vo] = await VariationOrderModel.create([{
        ...fields, projectId, code: await nextCode("VO"), status: "DRAFT",
        ...(upload ? { attachmentPath: upload.path, attachmentName: upload.name } : {}),
      }]);
      changed({ kind: "project", projectId: String(projectId) });
      return { id: String(vo._id) };
    });
  }

  async send(id: Id) {
    const vo = await loadVo(id);
    if (vo.status !== "DRAFT") throw rule("Only a draft variation order can be sent to the client");
    vo.status = "CLIENT_REVIEW";
    await vo.save();
    changed({ kind: "project", projectId: String(vo.projectId) });
  }

  /** Adds the VO's payment milestone and raises the contract value, once. */
  async accept(id: Id) {
    await tx(async () => {
      const vo = await loadVo(id);
      if (vo.status === "ACCEPTED") throw rule("This variation order is already accepted");
      vo.status = "ACCEPTED";
      await vo.save();
      const project = await loadProject(vo.projectId);
      project.milestones.push({ seq: project.milestones.length + 1, name: `${vo.code} - variation`, trigger: "On completion of this VO", pct: null, amount: vo.amount, status: "PENDING_SIGNOFF" });
      project.contractValue += vo.amount;
      await project.save();
      await audit("vo.accepted", "variation_order", vo._id, { amount: vo.amount }, vo.projectId);
      changed({ kind: "project", projectId: String(vo.projectId) });
    });
  }
}
```

- [ ] **Step 4: Write `src/billing/billing.service.ts`** (ports `actions/milestones.ts` and `actions/milestoneSchedule.ts`)

```ts
import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";
import { addDays, quotationTotals, splitSstInclusive } from "@veenix/shared";
import { findSub } from "../common/fields";
import { notFound, rule } from "../common/errors";
import { tx } from "../common/tx";
import { audit } from "../audit/audit";
import { nextCode } from "../counters/counters";
import { changed } from "../live/live";
import { indexEntry } from "../search/search";
import { loadOrg } from "../orgs/org.model";
import { loadProject, loadProjectBy } from "../projects/project.model";
import { QuotationModel } from "../quotations/quotation.model";
import { InvoiceModel } from "./invoice.model";
import { applySchedule } from "./schedule";

type Id = Types.ObjectId;
const INVOICE_DUE_DAYS = 7;

@Injectable()
export class BillingService {
  /** Fallback for a signed quotation without payment terms: the schedule is typed in against the signed total. */
  async createSchedule(projectId: Id, input: { terms: { name: string; trigger: string; pct: number }[] }) {
    await tx(async () => {
      const project = await loadProject(projectId);
      if (project.milestones.length > 0) throw rule("Payment milestones already exist for this project");
      const signed = await QuotationModel.findOne({ projectId, status: "ACCEPTED" });
      if (!signed) throw rule("Payment milestones are set up once the client has signed a quotation");
      const total = quotationTotals(signed.lineItems, (await loadOrg()).sstBps).total;
      signed.set("terms", input.terms.map((t, i) => ({ seq: i + 1, ...t })));
      await signed.save();
      applySchedule(project, input.terms, total);
      await project.save();
      await audit("schedule.created", "project", project._id, { total }, project._id);
      changed({ kind: "project", projectId: String(projectId) });
    });
  }

  /** One invoice per milestone. The milestone amount includes SST; the invoice shows it split out. */
  async generateInvoice(milestoneId: Id) {
    return tx(async () => {
      const project = await loadProjectBy({ "milestones._id": milestoneId }, "Payment milestone");
      const projectId = project._id;
      const milestone = findSub(project.milestones, milestoneId)!;
      if (milestone.invoiceId) return { invoiceId: String(milestone.invoiceId) };

      const { exSst, sst } = splitSstInclusive(milestone.amount, (await loadOrg()).sstBps);
      const now = new Date();
      const [invoice] = await InvoiceModel.create([{
        code: await nextCode("INV"), projectId, milestoneId, invoiceDate: now, dueDate: addDays(now, INVOICE_DUE_DAYS),
        amount: exSst, sstAmount: sst, status: "ISSUED",
      }]);
      milestone.set({ invoiceId: invoice._id, status: "AWAITING_PAYMENT" });
      await project.save();
      indexEntry({ kind: "invoice", refId: invoice._id, projectId, title: invoice.code, subtitle: project.name });
      await audit("invoice.generated", "invoice", invoice._id, { amount: milestone.amount }, projectId);
      // plan 07 adds: await enqueue("document.snapshot", { type: "invoice", id: String(invoice._id) });
      // plan 10 adds: e-invoice submission when the organization has it enabled
      changed({ kind: "project", projectId: String(projectId) });
      return { invoiceId: String(invoice._id) };
    });
  }

  async markPaid(invoiceId: Id) {
    await tx(async () => {
      const invoice = await InvoiceModel.findById(invoiceId);
      if (!invoice) throw notFound("Invoice");
      if (invoice.status === "PAID") throw rule("This invoice is already paid");
      invoice.status = "PAID";
      await invoice.save();
      const project = await loadProject(invoice.projectId);
      findSub(project.milestones, invoice.milestoneId)?.set({ status: "PAID" });
      await project.save();
      await audit("invoice.paid", "invoice", invoice._id, {}, invoice.projectId);
      changed({ kind: "project", projectId: String(invoice.projectId) });
    });
  }
}
```

- [ ] **Step 5: Write the two controllers**

Use `@Controller()` with the full paths from the Interfaces block. Body schemas: `voInput` for create, `scheduleInput` for the schedule, no body for the rest.

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter api test billing`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api
git commit -m "feat(api): variation orders and billing with once-only state changes"
```

---

### Task 6.9: Files and downloads

**Files:**
- Create: `apps/api/src/files/files.service.ts`, `apps/api/src/files/files.controller.ts`

**Interfaces:**
- Produces:
  - `FilesService.upload(projectId, input)`, `remove(fileId)`
  - `downloadFor(kind, id?): Promise<{ url }>`
  - routes:

    | Route | Permission |
    |---|---|
    | `POST /v1/projects/:id/files` | `file:write` |
    | `DELETE /v1/files/:id` | `file:write` |
    | `GET /v1/downloads/:kind/:id`, where `kind ∈ file \| photo \| quote \| quoterev \| invoice \| vo` | `project:read` |
    | `GET /v1/downloads/logo` | `@Can()` |

- [ ] **Step 1: Write `src/files/files.service.ts`**

```ts
import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";
import { ctx } from "../common/context";
import { notFound } from "../common/errors";
import { afterCommit, tx } from "../common/tx";
import { changed } from "../live/live";
import { claim, downloadUrl, removeObject } from "../storage/storage";
import { loadProject, ProjectModel } from "../projects/project.model";
import { RfqModel } from "../procurement/rfq.model";
import { PurchaseOrderModel } from "../procurement/purchase-order.model";
import { VariationOrderModel } from "../variations/variation-order.model";
import { loadOrg } from "../orgs/org.model";
import { FileModel } from "./file.model";

type Id = Types.ObjectId;
export type DownloadKind = "file" | "photo" | "quote" | "quoterev" | "invoice" | "vo";

@Injectable()
export class FilesService {
  async upload(projectId: Id, input: { files: { key: string; name: string }[] }) {
    await loadProject(projectId); // 404 outside scope
    // Checked one by one; the first bad file stops the whole upload.
    const claimed = [];
    for (const f of input.files) claimed.push(await claim(f, "files"));
    await FileModel.create(claimed.map((c) => ({ projectId, name: c.name, path: c.path, size: c.size, contentType: c.contentType, uploadedBy: ctx().userId })));
    changed({ kind: "project", projectId: String(projectId) });
  }

  async remove(fileId: Id) {
    await tx(async () => {
      const file = await FileModel.findById(fileId).lean();
      if (!file) throw notFound("File");
      await FileModel.deleteOne({ _id: fileId });
      afterCommit(() => removeObject(file.path));
      changed({ kind: "project", projectId: String(file.projectId) });
    });
  }

  /** A 5-minute link to a stored file. The owning record is read through the tenant plugin, so access follows project scope. */
  async download(kind: DownloadKind | "logo", id?: Id): Promise<{ url: string }> {
    const found = await this.locate(kind, id);
    if (!found?.key) throw notFound("File");
    return { url: await downloadUrl(found.key, found.name ?? "file") };
  }

  private async locate(kind: DownloadKind | "logo", id?: Id): Promise<{ key: string | null | undefined; name?: string | null } | null> {
    switch (kind) {
      case "logo": {
        const org = await loadOrg();
        return { key: org.logoPath, name: "logo" };
      }
      case "file": {
        const f = await FileModel.findById(id).lean();
        return f && { key: f.path, name: f.name };
      }
      case "photo": {
        const p = await ProjectModel.findById(id).select("photoPath").lean();
        return p && { key: p.photoPath, name: "photo" };
      }
      case "quote": {
        const r = await RfqModel.findOne({ "quotes._id": id }).lean();
        const q = r?.quotes.find((x) => x._id.equals(id!));
        return q ? { key: q.attachmentPath, name: q.attachmentName } : null;
      }
      case "quoterev": {
        const r = await RfqModel.findOne({ "quotes.revisions._id": id }).lean();
        const rev = r?.quotes.flatMap((q) => q.revisions).find((x) => x._id.equals(id!));
        return rev ? { key: rev.attachmentPath, name: rev.attachmentName } : null;
      }
      case "invoice": {
        const po = await PurchaseOrderModel.findOne({ "milestones._id": id }).lean();
        const m = po?.milestones.find((x) => x._id.equals(id!));
        return m ? { key: m.invoicePath, name: m.invoiceName } : null;
      }
      case "vo": {
        const vo = await VariationOrderModel.findById(id).lean();
        return vo && { key: vo.attachmentPath, name: vo.attachmentName };
      }
    }
  }
}
```

- [ ] **Step 2: Write `src/files/files.controller.ts`**

```ts
import { Controller, Delete, Get, Param, Post } from "@nestjs/common";
import { Types } from "mongoose";
import { projectFilesInput } from "@veenix/shared";
import { Can } from "../common/decorators";
import { notFound } from "../common/errors";
import { OidParam, oid } from "../common/oid";
import { ZBody } from "../common/zod";
import { FilesService, type DownloadKind } from "./files.service";

const KINDS: DownloadKind[] = ["file", "photo", "quote", "quoterev", "invoice", "vo"];

@Controller()
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Can("file:write") @Post("projects/:id/files") upload(@OidParam("id") id: Types.ObjectId, @ZBody(projectFilesInput) b: { files: { key: string; name: string }[] }) { return this.files.upload(id, b); }
  @Can("file:write") @Delete("files/:id") remove(@OidParam("id") id: Types.ObjectId) { return this.files.remove(id); }
  @Can() @Get("downloads/logo") logo() { return this.files.download("logo"); }
  @Can("project:read") @Get("downloads/:kind/:id")
  download(@Param("kind") kind: string, @Param("id") id: string) {
    if (!KINDS.includes(kind as DownloadKind)) throw notFound("File");
    return this.files.download(kind as DownloadKind, oid(id));
  }
}
```

- [ ] **Step 3: Type-check and commit**

Run: `pnpm --filter api typecheck`
Expected: no errors.

```bash
git add apps/api
git commit -m "feat(api): project files and scoped download links for every attachment"
```

---

### Task 6.10: Organization settings

**Files:**
- Create: `apps/api/src/orgs/settings.service.ts`, `apps/api/src/orgs/settings.controller.ts`

**Interfaces:**
- Produces:
  - `SettingsService.get(): OrgDto`, `letterhead(input)`, `bank(input)`, `pricing(input)`, `tax(input)`
  - routes:

    | Route | Permission |
    |---|---|
    | `GET /v1/org` | `@Can()` |
    | `PATCH /v1/org/letterhead` | `org:manage` |
    | `PATCH /v1/org/bank` | `org:manage` |
    | `PATCH /v1/org/pricing` | `org:manage` |
    | `PATCH /v1/org/tax` | `org:manage` |

- [ ] **Step 1: Write `src/orgs/settings.service.ts`** (ports `actions/settings.ts`)

```ts
import { Injectable } from "@nestjs/common";
import { ctx } from "../common/context";
import { afterCommit, tx } from "../common/tx";
import { audit } from "../audit/audit";
import { changed } from "../live/live";
import { claim, removeObject } from "../storage/storage";
import { OrgModel, loadOrg } from "./org.model";
import { toOrgDto } from "./orgs.service";

type Letterhead = { companyName: string; companyReg: string; companyAddress: string; companyPhone: string; logo: { key: string; name: string } | "remove" | null };

@Injectable()
export class SettingsService {
  async get() {
    return toOrgDto(await loadOrg());
  }

  async letterhead(input: Letterhead) {
    const { logo, ...fields } = input;
    const current = await loadOrg();
    const logoPath = logo === "remove" ? null : logo ? (await claim(logo, "logos")).path : current.logoPath;
    await OrgModel.updateOne({ _id: ctx().orgId }, { $set: { ...fields, logoPath } });
    if (current.logoPath && current.logoPath !== logoPath) await removeObject(current.logoPath);
    changed({ kind: "org" });
  }

  private async set(action: string, data: object) {
    await tx(async () => {
      await OrgModel.updateOne({ _id: ctx().orgId }, { $set: data });
      await audit(action, "organization", ctx().orgId, data);
      afterCommit(() => changed({ kind: "org" }));
    });
  }

  bank = (input: { bankName: string; bankAccountName: string; bankAccount: string; swiftCode: string | null }) => this.set("org.bank_changed", input);
  pricing = (input: { defaultMarkupPct: number; minMarkupPct: number }) => this.set("org.pricing_changed", input);
  tax = (input: { sstBps: number }) => this.set("org.tax_changed", input);
}
```

- [ ] **Step 2: Write the controller** with the routes from the Interfaces block. Body schemas: `letterheadInput`, `bankInput`, `pricingInput`, `taxInput`. Type-check, then commit.

```bash
git add apps/api
git commit -m "feat(api): organization settings"
```

---

### Task 6.11: Dashboard and reports

**Files:**
- Create: `apps/api/src/dashboard/dashboard.service.ts`, `dashboard/dashboard.controller.ts`
- Modify: `packages/shared/src/dto.ts` (add `ReportsDto`)

**Interfaces:**
- Consumes: `buildCores`, `quotationReadiness`, `getAttention`, `PRIORITY_ORDER`, `quotationTotals`, `mytStartOfDay`, `addDays`, `daysBetween`, `LEAD_SOURCES`, `LEAD_STATUSES`.
- Produces:
  - `DashboardService.dashboard(): DashboardDto`, `reports(): ReportsDto`
  - routes `GET /v1/dashboard` (`project:read`) and `GET /v1/reports` (`report:read`)

- [ ] **Step 1: Add `ReportsDto` to `packages/shared/src/dto.ts`**

```ts
export interface ReportsDto {
  leads: { total: number; converted: number; lost: number; convertedPct: number; winRatePct: number };
  deals: { signedCount: number; avgDeal: Sen; avgDaysToSign: number | null; daysToSignCount: number };
  sources: { source: string; count: number; won: number; pct: number }[];
  margins: { id: Id; name: string; cost: Sen; contract: Sen; profit: Sen; marginPct: number }[];
  vendorSpend: { id: Id; name: string; jobs: number; committed: Sen; paid: Sen }[];
}
```

- [ ] **Step 2: Write `src/dashboard/dashboard.service.ts`**

`dashboard()` ports the data half of `apps/web/app/(dashboard)/page.tsx`: everything above `const kpis = [`, plus the KPI numbers and tile counts. The changes:
- **Data source:** use `buildCores(activeProjects)` and `quotationReadiness(core.workItems, core.bomItems)` instead of `projectDetailInclude` and the per-project readiness calls.
- **Leads:** only for roles with `lead:read`; otherwise `[]`.
- **Today:** `today = mytStartOfDay(now)`, `week = addDays(now, -7)`, `month = addDays(now, -30)`.
- **Row targets:** each row gets `target` instead of `href`: `{ kind: "project", id, tab }` or `{ kind: "lead", id }`.
- **Signed amount:** `signedLast30d = Σ quotationTotals(q.lineItems, org.sstBps).total` over quotations accepted in the last 30 days.
- **Return:** `{ userName: currentUser().name, kpis: {…}, leadCounts, rows: rows.sort(PRIORITY_ORDER).slice(0, 8) }`.

```ts
// ponytail: reads every open lead and active project per request; fine up to a few hundred each. Move to counting aggregations when an organization outgrows that.
```

`reports()` ports `apps/web/app/(dashboard)/reports/page.tsx` lines 11–76 unchanged in logic:
- **Reads:** `LeadModel.find().select("status source createdAt").lean()`, `ProjectModel.find().select("name contractValue leadId").lean()`, the ACCEPTED quotations for those projects, the vendors, and `PurchaseOrderModel.find().select("vendorId amount status")`.
- **Totals:** `quotationTotals` gets `org.sstBps`.
- **Days to sign:** `daysToSign` uses each project's lead's `createdAt` (look up `leadId` among the leads already read).
- **Result:** return the numbers in `ReportsDto`. The page keeps building its cards and bars from them.

- [ ] **Step 3: Write the controller, then run everything**

Run: `pnpm --filter @veenix/shared build && pnpm --filter api test && pnpm --filter api typecheck`
Expected: every test passes and there are no type errors.

- [ ] **Step 4: Commit**

```bash
git add apps/api packages/shared
git commit -m "feat(api): dashboard and reports computed on the server"
```
