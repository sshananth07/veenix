# 07: Documents and sending

> For whoever implements this (you or Claude): work task by task and tick each one off in [../README.md](../README.md).

**Goal:** PDFs are rendered by the API. A sent quotation and a generated invoice are stored once, so later changes (a new letterhead, say) can't alter what the client received. Any document can be emailed with the PDF attached, or shared on WhatsApp through a link.

**Architecture:**
- The existing `@react-pdf/renderer` templates move into the API unchanged, apart from imports and the SST rate.
- `DocumentsService.render()` builds each template's props from Mongo, the same props the old Next.js routes passed.
- Storing goes through the job queue (`document.snapshot`), and so does email (`mail.send`, from plan 05).
- WhatsApp is a `wa.me` link holding a 7-day download link. There's no WhatsApp API.

**Tech stack:** `@react-pdf/renderer` 4, React 18 (server-side only), `node:crypto` for SHA-256.

**Spec:** [../spec.md](../spec.md) §15.

## Global constraints
- PDF types: `quotation | invoice | po | rfq | rfq-bundle`. For `rfq-bundle` the id is the project id.
- Stored PDFs live at `orgs/<orgId>/documents/<uuid>.pdf`, with a `documents` record holding `sha256`.
- Only quotations that aren't drafts, and invoices, use stored snapshots. Drafts, POs and RFQs render fresh every time.
- Malaysian phone numbers for WhatsApp: drop everything but digits; a leading `0` becomes `60`.

## Review focus
- **The letterhead changes after a quotation was sent:** downloading the sent revision still shows the old letterhead. Tested in Task 7.2.
- **A snapshot job hasn't run yet when someone downloads:** the download renders fresh rather than failing. Covered by the fallback in `pdf()`.
- **Emailing a draft quotation:** allowed, rendered fresh, and recorded in `sends`.
- **A phone number written `012-345 6789`:** becomes `60123456789` in the `wa.me` link. Tested in Task 7.3.
- **Downloads by a project manager for an unassigned project:** 404, because the lookups go through the tenant plugin.

---

### Task 7.1: Templates and rendering in the API

**Files:**
- Move: `apps/web/lib/pdf/*` → `apps/api/src/documents/templates/`
- Create: `apps/api/src/documents/documents.service.ts`, `apps/api/src/documents/documents.controller.ts`
- Test: `apps/api/src/documents/documents.test.ts`

**Interfaces:**
- Produces:
  - `type DocType = 'quotation' | 'invoice' | 'po' | 'rfq' | 'rfq-bundle'`
  - `DocumentsService.render(type, id, opts?: { vendorId?: string }): Promise<{ buffer: Buffer; filename: string; projectId: Types.ObjectId }>`
  - `DocumentsService.pdf(type, id, opts?)`: the snapshot when there is one, otherwise `render`
  - the route `GET /v1/documents/:type/:id/pdf?vendorId=&download=1` (`project:read`, `@RateLimit(30)`)

- [x] **Step 1: Move the templates and install**

```bash
mkdir -p apps/api/src/documents/templates
git mv apps/web/lib/pdf/* apps/api/src/documents/templates/
pnpm --filter api add @react-pdf/renderer@^4 react@^18
pnpm --filter api add -D @types/react@^18
```

- [x] **Step 2: Fix the template imports**

In every file under `apps/api/src/documents/templates/`:
- `@/lib/utils` → `@veenix/shared` (`formatCurrency`, `formatDate`, `formatMoney2` and `formatNumber` now take sen and format in Malaysian time)
- `@/lib/quotation` → `@veenix/shared`
- `@/lib/paymentTerms` → `@veenix/shared`

In `QuotationPdf.tsx`:
- Add `sstBps: number` to its props, and call `quotationTotals(lineItems, sstBps)`.
- Replace any hard-coded "8%" label: run `grep -n "8%" apps/api/src/documents/templates` and use `` `${sstBps / 100}%` ``.

The money values these templates receive are already sen, so nothing else changes.

- [x] **Step 3: Write `src/documents/documents.service.ts`**

```tsx
import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";
import { renderToBuffer } from "@react-pdf/renderer";
import { notFound } from "../common/errors";
import { findSub } from "../common/fields";
import { plain } from "../common/plain";
import { getObject } from "../storage/storage";
import { loadOrg } from "../orgs/org.model";
import { ProjectModel } from "../projects/project.model";
import { QuotationModel } from "../quotations/quotation.model";
import { InvoiceModel } from "../billing/invoice.model";
import { PurchaseOrderModel } from "../procurement/purchase-order.model";
import { RfqModel } from "../procurement/rfq.model";
import { VendorModel } from "../vendors/vendor.model";
import { QuotationPdf } from "./templates/QuotationPdf";
import { InvoicePdf } from "./templates/InvoicePdf";
import { PoPdf } from "./templates/PoPdf";
import { RfqBundlePdf, RfqPdf } from "./templates/RfqPdf";

export type DocType = "quotation" | "invoice" | "po" | "rfq" | "rfq-bundle";
export const DOC_TYPES: DocType[] = ["quotation", "invoice", "po", "rfq", "rfq-bundle"];

type Rendered = { buffer: Buffer; filename: string; projectId: Types.ObjectId };
const P = <T,>(v: unknown) => plain<T>(v) as never;

async function project(id: Types.ObjectId) {
  const p = await ProjectModel.findById(id).lean();
  if (!p) throw notFound("Project");
  return p;
}

@Injectable()
export class DocumentsService {
  /** Builds the same props the old apps/web/app/api/documents/* routes passed, from Mongo. */
  async render(type: DocType, id: Types.ObjectId, opts: { vendorId?: string } = {}): Promise<Rendered> {
    const company = await loadOrg();
    switch (type) {
      case "quotation": {
        const q = await QuotationModel.findById(id).lean();
        if (!q) throw notFound("Quotation");
        const lines = [...q.lineItems].sort((a, b) => a.seq - b.seq);
        const terms = [...q.terms].sort((a, b) => a.seq - b.seq);
        const buffer = await renderToBuffer(<QuotationPdf company={company} quotation={P(q)} project={P(await project(q.projectId))} lineItems={P(lines)} terms={P(terms)} sstBps={company.sstBps} />);
        return { buffer, filename: `${q.code}.pdf`, projectId: q.projectId };
      }
      case "invoice": {
        const inv = await InvoiceModel.findById(id).lean();
        if (!inv) throw notFound("Invoice");
        const p = await project(inv.projectId);
        const milestone = findSub(p.milestones, inv.milestoneId);
        const buffer = await renderToBuffer(<InvoicePdf company={company} invoice={P(inv)} milestoneName={milestone?.name ?? ""} project={P(p)} />);
        return { buffer, filename: `${inv.code}.pdf`, projectId: inv.projectId };
      }
      case "po": {
        const po = await PurchaseOrderModel.findById(id).lean();
        if (!po) throw notFound("Purchase order");
        const [vendor, rfq] = await Promise.all([VendorModel.findById(po.vendorId).lean(), po.rfqId ? RfqModel.findById(po.rfqId).select("code").lean() : null]);
        const milestones = [...po.milestones].sort((a, b) => a.seq - b.seq);
        const buffer = await renderToBuffer(<PoPdf company={company} po={P(po)} milestones={P(milestones)} vendorName={vendor?.name ?? ""} project={P(await project(po.projectId))} rfqCode={rfq?.code ?? null} />);
        return { buffer, filename: `${po.code}.pdf`, projectId: po.projectId };
      }
      case "rfq":
      case "rfq-bundle": {
        const rfqs = type === "rfq" ? await RfqModel.find({ _id: id }).lean() : await RfqModel.find({ projectId: id }).sort({ createdAt: 1 }).lean();
        if (rfqs.length === 0) throw notFound("RFQ");
        const p = await project(rfqs[0].projectId);
        const awarded = new Set((await PurchaseOrderModel.find({ rfqId: { $in: rfqs.map((r) => r._id) } }).select("rfqId").lean()).map((x) => String(x.rfqId)));
        const vendors = new Map((await VendorModel.find({ _id: { $in: rfqs.flatMap((r) => r.quotes.map((q) => q.vendorId)) } }).lean()).map((v) => [String(v._id), v.name]));
        const page = (r: (typeof rfqs)[number], vendorName: string) => {
          const bomItem = findSub(p.bomItems, r.bomItemId)!;
          return { company, rfq: P(r), bomItem: P(bomItem), workItemName: findSub(p.workItems, bomItem.workItemId ?? "")?.name ?? null, project: P(p), vendorName };
        };
        if (type === "rfq") {
          const r = rfqs[0];
          // ?vendorId= addresses the RFQ to one invited vendor.
          const target = opts.vendorId ? vendors.get(opts.vendorId) : undefined;
          const vendorName = target ?? (r.quotes.map((q) => vendors.get(String(q.vendorId))).filter(Boolean).join(", ") || "Invited vendors");
          const slug = target ? `-${target.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")}` : "";
          return { buffer: await renderToBuffer(<RfqPdf {...page(r, vendorName)} />), filename: `${r.code}${slug}.pdf`, projectId: r.projectId };
        }
        // Every RFQ still waiting on a quote, one page per invited vendor.
        const pages = rfqs.filter((r) => !awarded.has(String(r._id))).flatMap((r) => r.quotes.map((q) => page(r, vendors.get(String(q.vendorId)) ?? "")));
        if (pages.length === 0) throw notFound("Open RFQ");
        return { buffer: await renderToBuffer(<RfqBundlePdf pages={pages} />), filename: `${p.code}-RFQs.pdf`, projectId: p._id };
      }
    }
  }

  /** The stored snapshot for sent quotations and invoices; a fresh render for everything else. */
  async pdf(type: DocType, id: Types.ObjectId, opts: { vendorId?: string } = {}): Promise<Rendered> {
    if (type === "quotation" || type === "invoice") {
      const doc = type === "quotation" ? await QuotationModel.findById(id).select("code projectId status snapshot").lean() : await InvoiceModel.findById(id).select("code projectId snapshot").lean();
      if (doc?.snapshot?.key && !(type === "quotation" && (doc as { status?: string }).status === "DRAFT")) {
        return { buffer: await getObject(doc.snapshot.key), filename: `${doc.code}.pdf`, projectId: doc.projectId };
      }
    }
    return this.render(type, id, opts);
  }
}
```

`P()` silences the template prop types. The templates declare their own prop shapes, and these Mongo objects have the same field names. If a template reads a relation the old Prisma include supplied, the type checker shows it here. Add that field to the object you pass.

- [x] **Step 4: Write `src/documents/documents.controller.ts`**

```ts
import { Controller, Get, Param, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { Can, RateLimit } from "../common/decorators";
import { notFound } from "../common/errors";
import { oid } from "../common/oid";
import { DOC_TYPES, DocumentsService, type DocType } from "./documents.service";

export function docType(t: string): DocType {
  if (!DOC_TYPES.includes(t as DocType)) throw notFound("Document");
  return t as DocType;
}

@Controller("documents")
export class DocumentsController {
  constructor(private readonly docs: DocumentsService) {}

  @Can("project:read") @RateLimit(30) @Get(":type/:id/pdf")
  async pdf(@Param("type") type: string, @Param("id") id: string, @Query("vendorId") vendorId: string | undefined, @Query("download") download: string | undefined, @Res() res: Response) {
    const { buffer, filename } = await this.docs.pdf(docType(type), oid(id), { vendorId });
    res.set({ "Content-Type": "application/pdf", "Content-Disposition": `${download === "1" ? "attachment" : "inline"}; filename="${filename}"` }).send(buffer);
  }
}
```

Register both.

- [x] **Step 5: Write the test** `src/documents/documents.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { DocumentsService } from "./documents.service";
import { OrgModel } from "../orgs/org.model";
import { ProjectModel } from "../projects/project.model";
import { QuotationModel } from "../quotations/quotation.model";
import { asOrg, newId } from "../../test/ctx";

const docs = new DocumentsService();
const org = newId();

describe("documents", () => {
  it("renders a quotation PDF from Mongo data", async () => {
    await OrgModel.create([{ _id: org, companyName: "Wawasan Interior", createdBy: newId() }]);
    const [p] = await asOrg(org, () => ProjectModel.create([{ code: "PRJ-2026-0001", name: "Condo", clientName: "Aisyah", siteAddress: "Petaling Jaya" }]));
    const [q] = await asOrg(org, () => QuotationModel.create([{ code: "QT-2026-0001", revision: 1, projectId: p._id, lineItems: [{ workItemName: "Kitchen", workPackage: "Cabinets", bomCost: 100_000, markupPct: 40, clientPrice: 140_000 }], terms: [{ seq: 1, name: "Deposit", trigger: "-", pct: 100 }] }]));
    const r = await asOrg(org, () => docs.pdf("quotation", q._id));
    expect(r.filename).toBe("QT-2026-0001.pdf");
    expect(r.buffer.subarray(0, 4).toString()).toBe("%PDF");
  });
});
```

- [x] **Step 6: Run the tests**

Run: `pnpm --filter api test documents`
Expected: PASS. `ERR_REQUIRE_ESM` means Node is older than 22.12.

- [x] **Step 7: Commit**

```bash
git add apps/api apps/web pnpm-lock.yaml
git commit -m "feat(api): render PDFs in the API from Mongo data"
```

---

### Task 7.2: Snapshots for sent quotations and invoices

**Files:**
- Create: `apps/api/src/documents/document.model.ts`, `apps/api/src/documents/stored.ts`
- Modify: `apps/api/src/quotations/quotations.service.ts` (send), `apps/api/src/billing/billing.service.ts` (generateInvoice), `apps/api/src/models.ts`, `apps/api/src/app.module.ts` (import `./documents/stored` so its job handler registers)
- Test: `apps/api/src/documents/stored.test.ts`

**Interfaces:**
- Produces:
  - `DocumentModel` (collection `documents`)
  - `storeDocument(type, id, opts?): Promise<{ documentId; key; filename; projectId }>`: renders, stores, records
  - `storedFor(type, id)`: the snapshot document for a sent quotation or an invoice, otherwise a new stored render
  - the job handler `document.snapshot` (payload `{ type, id }`)

- [x] **Step 1: Write the model and `stored.ts`**

```ts
// document.model.ts
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
```

```ts
// stored.ts
import { createHash } from "node:crypto";
import { Types } from "mongoose";
import { registerJob } from "../jobs/jobs";
import { newKey, putObject } from "../storage/storage";
import { QuotationModel } from "../quotations/quotation.model";
import { InvoiceModel } from "../billing/invoice.model";
import { DocumentModel } from "./document.model";
import { DocumentsService, type DocType } from "./documents.service";

const docs = new DocumentsService();

/** Renders a document, stores the PDF and records it with its SHA-256. */
export async function storeDocument(type: DocType, id: Types.ObjectId, opts: { vendorId?: string } = {}) {
  const { buffer, filename, projectId } = await docs.render(type, id, opts);
  const key = newKey("documents", ".pdf");
  await putObject(key, buffer, "application/pdf");
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const [doc] = await DocumentModel.create([{ type, refId: id, projectId, filename, key, sha256 }]);
  return { documentId: doc._id, key, filename, projectId };
}

/** The frozen copy for sent quotations and invoices (made now if the snapshot job hasn't run yet); a new stored render otherwise. */
export async function storedFor(type: DocType, id: Types.ObjectId, opts: { vendorId?: string } = {}) {
  if (type === "quotation" || type === "invoice") {
    const existing = await DocumentModel.findOne({ type, refId: id }).sort({ createdAt: 1 }).lean();
    const isDraft = type === "quotation" && (await QuotationModel.exists({ _id: id, status: "DRAFT" }));
    if (existing && !isDraft) return { documentId: existing._id, key: existing.key, filename: existing.filename, projectId: existing.projectId };
  }
  return storeDocument(type, id, opts);
}

registerJob<{ type: "quotation" | "invoice"; id: string }>("document.snapshot", async ({ type, id }) => {
  const refId = new Types.ObjectId(id);
  const Model = type === "quotation" ? QuotationModel : InvoiceModel;
  const current = await (Model as typeof InvoiceModel).findById(refId).select("snapshot").lean();
  if (current?.snapshot?.key) return; // already done (the job may run twice)
  const { key } = await storeDocument(type, refId);
  const stored = await DocumentModel.findOne({ key }).lean();
  await (Model as typeof InvoiceModel).updateOne({ _id: refId }, { $set: { snapshot: { key, sha256: stored!.sha256 } } });
});
```

- [x] **Step 2: Enqueue the snapshots**

- In `QuotationsService.send`, replace the `// plan 07 adds:` comment with `await enqueue("document.snapshot", { type: "quotation", id: String(q._id) });`
- In `BillingService.generateInvoice`, do the same with `type: "invoice"`.

Import `enqueue` from `../jobs/jobs` in both.

- [x] **Step 3: Write the test** `src/documents/stored.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { DocumentsService } from "./documents.service";
import { runDue } from "../jobs/jobs";
import { enqueue } from "../jobs/jobs";
import "./stored";
import { tx } from "../common/tx";
import { OrgModel } from "../orgs/org.model";
import { ProjectModel } from "../projects/project.model";
import { QuotationModel } from "../quotations/quotation.model";
import { asOrg, newId } from "../../test/ctx";

const docs = new DocumentsService();
const org = newId();

describe("snapshots", () => {
  it("keeps the PDF the client received after the letterhead changes", async () => {
    await OrgModel.create([{ _id: org, companyName: "Old Name Sdn Bhd", createdBy: newId() }]);
    const [p] = await asOrg(org, () => ProjectModel.create([{ code: "PRJ-2026-0001", name: "Condo", clientName: "A", siteAddress: "x" }]));
    const [q] = await asOrg(org, () => QuotationModel.create([{ code: "QT-2026-0001", revision: 1, projectId: p._id, status: "SENT", terms: [{ seq: 1, name: "All", trigger: "-", pct: 100 }] }]));
    await asOrg(org, () => tx(() => enqueue("document.snapshot", { type: "quotation", id: String(q._id) })));
    await runDue();

    const sent = await asOrg(org, () => docs.pdf("quotation", q._id));
    await OrgModel.updateOne({ _id: org }, { companyName: "New Name Sdn Bhd" });
    const later = await asOrg(org, () => docs.pdf("quotation", q._id));
    expect(later.buffer.equals(sent.buffer)).toBe(true);
  });
});
```

- [x] **Step 4: Run the tests**

Run: `pnpm --filter api test stored`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): frozen PDF snapshots for sent quotations and invoices"
```

---

### Task 7.3: Send by email; WhatsApp share link

**Files:**
- Modify: `apps/api/src/documents/documents.controller.ts`, `apps/api/src/mail/mail.ts` (record the send)
- Create: `apps/api/src/documents/whatsapp.ts`
- Test: `apps/api/src/documents/whatsapp.test.ts`

**Interfaces:**
- Produces:
  - `waNumber(phone: string | null): string`
  - `whatsappLink(phone, text): string`
  - routes, both `document:send` and `@RateLimit(30)`:
    - `POST /v1/documents/:type/:id/email` with body `{ to, message? }` → `{ queued: true }`
    - `POST /v1/documents/:type/:id/share` with body `{ phone? }` → `{ url, whatsappUrl }`

- [x] **Step 1: Write the failing test** `src/documents/whatsapp.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { waNumber, whatsappLink } from "./whatsapp";

describe("whatsapp", () => {
  it("turns Malaysian numbers into international format", () => {
    expect(waNumber("012-345 6789")).toBe("60123456789");
    expect(waNumber("+60 12 345 6789")).toBe("60123456789");
    expect(waNumber(null)).toBe("");
  });
  it("builds a wa.me link with the message", () => {
    expect(whatsappLink("0123456789", "Hi https://x")).toBe("https://wa.me/60123456789?text=Hi%20https%3A%2F%2Fx");
  });
});
```

- [x] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter api test whatsapp`
Expected: FAIL (module missing).

- [x] **Step 3: Write `src/documents/whatsapp.ts`**

```ts
/** Digits only; a leading 0 becomes Malaysia's 60. */
export function waNumber(phone: string | null): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.startsWith("0") ? `60${digits.slice(1)}` : digits;
}

export function whatsappLink(phone: string | null, text: string): string {
  return `https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(text)}`;
}
```

- [x] **Step 4: Add the send routes to `documents.controller.ts`**

```ts
// additional imports
import { Body, Post } from "@nestjs/common";
import { documentEmailInput, documentShareInput } from "@veenix/shared";
import { ZBody } from "../common/zod";
import { ctx } from "../common/context";
import { tx } from "../common/tx";
import { loadOrg } from "../orgs/org.model";
import { queueMail } from "../mail/mail";
import { shareUrl } from "../storage/storage";
import { DocumentModel } from "./document.model";
import { storedFor } from "./stored";
import { whatsappLink } from "./whatsapp";

// inside DocumentsController
  @Can("document:send") @RateLimit(30) @Post(":type/:id/email")
  async email(@Param("type") type: string, @Param("id") id: string, @ZBody(documentEmailInput) body: { to: string; message: string | null }) {
    const stored = await storedFor(docType(type), oid(id));
    const org = await loadOrg();
    await tx(() => queueMail({
      to: body.to,
      subject: `${stored.filename.replace(/\.pdf$/, "")} from ${org.companyName}`,
      text: `${body.message ?? "Please find the document attached."}\n\n${org.companyName}\n${org.companyPhone}`,
      attachments: [{ filename: stored.filename, key: stored.key, contentType: "application/pdf" }],
      documentId: String(stored.documentId),
    }));
    return { queued: true };
  }

  @Can("document:send") @RateLimit(30) @Post(":type/:id/share")
  async share(@Param("type") type: string, @Param("id") id: string, @ZBody(documentShareInput) body: { phone: string | null }) {
    const stored = await storedFor(docType(type), oid(id));
    const url = await shareUrl(stored.key, stored.filename);
    const org = await loadOrg();
    await DocumentModel.updateOne({ _id: stored.documentId }, { $push: { sends: { channel: "whatsapp", to: body.phone, by: ctx().userId } } });
    return { url, whatsappUrl: whatsappLink(body.phone, `${stored.filename.replace(/\.pdf$/, "")} from ${org.companyName}: ${url}`) };
  }
```

- [x] **Step 5: Record email sends**

In `mail.ts`, after `transport.sendMail(...)` succeeds:

```ts
if (job.documentId) {
  await DocumentModel.updateOne({ _id: job.documentId }, { $push: { sends: { channel: "email", to: job.to } } });
}
```
(import `DocumentModel` from `../documents/document.model`). The handler runs inside the job's organization, so the tenant plugin allows the update.

- [x] **Step 6: Run the tests and check by hand**

Run: `pnpm --filter api test`
Expected: PASS.

By hand (once plan 08 adds the buttons): email a quotation to yourself. The PDF arrives in Mailpit, and the quotation's `documents` record has one `sends` entry.

- [x] **Step 7: Commit**

```bash
git add apps/api
git commit -m "feat(api): email documents as attachments and WhatsApp share links"
```
