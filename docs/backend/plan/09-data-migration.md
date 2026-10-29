# 09: Data migration

> For whoever implements this (you or Claude): work task by task and tick each one off in [../README.md](../README.md).
>
> **When:** any time after plan 06 is done. Running it **before** plan 08 gives the web app real data to check against while you switch it over.

**Goal:** copy everything in `apps/web/prisma/dev.db` and `apps/web/uploads/` into one organization in Mongo and object storage. The script can be re-run (`--reset`), and it reports anything it couldn't carry over.

**Architecture:**
- One script, `apps/api/scripts/migrate-from-sqlite.ts`.
- It reads SQLite with Node's built-in `node:sqlite` (no new dependency), maps old ids to new ObjectIds, multiplies money by 100 (ringgit → sen), and nests child rows into their parent documents.
- It writes through the normal models inside `systemCtx(orgId)`, so validation and the tenant plugin still apply.

**Tech stack:** `node:sqlite` (Node 24), Mongoose models from plan 06, storage from plan 05.

**Spec:** [../spec.md](../spec.md) §5, §8.

## Global constraints
- **Money:** every Prisma `Int` money field ×100; `Float` `unitCost` fields `Math.round(v × 100)`. The fields: `budgetMin`, `budgetMax`, `contractValue`, `unitCost`, `estTotal`, material `total`, `quotedPrice`, PO `amount`, PO milestone `amount` and `paidAmount`, `bomCost`, `clientPrice`, VO `amount`, payment milestone `amount`, invoice `amount` and `sstAmount`.
- **Dates:** Prisma's SQLite stores either epoch milliseconds or ISO text. `toDate()` accepts both.
- **Codes:** kept as they are. Counters are raised so new codes continue from the highest existing number.
- **Old invoices' simulated e-invoice UUIDs are dropped:** `einvoice.status = NOT_SUBMITTED`, because nothing was ever sent to LHDN.
- **Owner:** must have signed up and set up MFA in the web app first. The script looks the email up in Better Auth's `user` collection.

## Review focus
- **A file referenced in the database but missing from `uploads/`:** the record is kept, the field becomes `null`, and the path is listed in the report. Today only 3 invoice PDFs exist on disk.
- **A BOM line whose stored total doesn't match qty × cost + materials:** listed in the report. The stored value is kept; nothing is silently "fixed".
- **Running the script twice:** without `--reset` it stops ("already migrated"). With `--reset` it deletes that organization's data and runs again.
- **Totals:** the sum of contract values, PO amounts and invoice amounts must equal the old sums × 100. Printed in the report.

---

### Task 9.1: The migration script

**Files:**
- Create: `apps/api/scripts/migrate-from-sqlite.ts`, `apps/api/scripts/search-rebuild.ts`
- Modify: `apps/api/package.json` (scripts `migrate:sqlite`, `search:rebuild`)

**Interfaces:**
- Consumes: every model, `raiseCounter`, `newKey` and `putObject`, `indexEntry`, `runWithCtx` and `systemCtx`, `connectDb`.
- Produces:
  - `pnpm --filter api migrate:sqlite -- --owner you@example.com [--reset] [--db ../web/prisma/dev.db] [--uploads ../web/uploads]`
  - `pnpm --filter api search:rebuild -- --org <orgId>`

- [x] **Step 1: Write `scripts/migrate-from-sqlite.ts`**

```ts
import { existsSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { DatabaseSync } from "node:sqlite";
import mongoose, { Types } from "mongoose";
import { CONTENT_TYPES, calcBomTotal, mytYear, type UploadPurpose } from "@veenix/shared";
import "../src/models";
import { connectDb } from "../src/common/db";
import { runWithCtx, systemCtx } from "../src/common/context";
import { raiseCounter, type CodeKind } from "../src/counters/counters";
import { newKey, putObject } from "../src/storage/storage";
import { UserModel } from "../src/users/user.model";
import { OrgModel } from "../src/orgs/org.model";
import { MembershipModel } from "../src/orgs/membership.model";
import { LeadModel } from "../src/leads/lead.model";
import { VendorModel } from "../src/vendors/vendor.model";
import { ProjectModel } from "../src/projects/project.model";
import { RfqModel } from "../src/procurement/rfq.model";
import { PurchaseOrderModel } from "../src/procurement/purchase-order.model";
import { QuotationModel } from "../src/quotations/quotation.model";
import { VariationOrderModel } from "../src/variations/variation-order.model";
import { InvoiceModel } from "../src/billing/invoice.model";
import { FileModel } from "../src/files/file.model";

const { values: args } = parseArgs({
  options: {
    owner: { type: "string" },
    reset: { type: "boolean", default: false },
    db: { type: "string", default: "../web/prisma/dev.db" },
    uploads: { type: "string", default: "../web/uploads" },
  },
});
if (!args.owner) throw new Error("Pass --owner <email of an account that has signed up and set up MFA>");

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const sqlite = new DatabaseSync(resolve(args.db!), { readOnly: true });
const all = (table: string): Row[] => sqlite.prepare(`SELECT * FROM "${table}"`).all() as Row[];
const toDate = (v: unknown) => (v == null ? null : new Date(typeof v === "number" || /^\d+$/.test(String(v)) ? Number(v) : String(v)));
const sen = (v: unknown) => (v == null ? null : Math.round(Number(v) * 100));
const bool = (v: unknown) => v === 1 || v === true || v === "1";
const report: string[] = [];

const ids = new Map<string, Types.ObjectId>();
const idOf = (old: string | null | undefined) => {
  if (!old) return null;
  if (!ids.has(old)) ids.set(old, new Types.ObjectId());
  return ids.get(old)!;
};

const FOLDER_PURPOSE: Record<string, UploadPurpose> = { quotes: "quotes", invoices: "invoices", photos: "photos", vo: "vo", files: "files", logos: "logos" };
async function moveFile(oldPath: string | null): Promise<string | null> {
  if (!oldPath) return null;
  const abs = join(resolve(args.uploads!), oldPath);
  const purpose = FOLDER_PURPOSE[oldPath.split("/")[0]];
  if (!purpose || !existsSync(abs)) {
    report.push(`missing file: ${oldPath}`);
    return null;
  }
  const ext = extname(oldPath).toLowerCase();
  const key = newKey(purpose, ext);
  await putObject(key, readFileSync(abs), CONTENT_TYPES[ext] ?? "application/octet-stream");
  return key;
}

const ADDRESS = (r: Row) => ({ addressLine1: r.addressLine1, addressLine2: r.addressLine2, addressLine3: r.addressLine3, postcode: r.postcode, city: r.city, state: r.state });
const NO_TS = { timestamps: false } as const;

async function main() {
  await connectDb();
  const authUser = await mongoose.connection.collection("user").findOne({ email: args.owner!.toLowerCase() });
  if (!authUser) throw new Error(`No account for ${args.owner}. Sign up in the web app first.`);
  const owner = await UserModel.findOneAndUpdate(
    { authSubject: String(authUser._id) },
    { $set: { email: authUser.email, name: authUser.name ?? "" } },
    { upsert: true, new: true },
  );

  const settings = all("Settings")[0] ?? {};
  const companyName = settings.companyName ?? "Migrated organization";
  const existing = await MembershipModel.find({ userId: owner._id, role: "owner" }).lean();
  const previous = await OrgModel.findOne({ _id: { $in: existing.map((m) => m.orgId) }, companyName }).lean();
  if (previous && !args.reset) throw new Error(`"${companyName}" is already migrated for this owner. Re-run with --reset to replace it.`);
  if (previous) {
    for (const name of mongoose.modelNames()) {
      const coll = mongoose.model(name).collection;
      if (["app_users", "counters"].includes(coll.collectionName)) continue;
      await coll.deleteMany({ $or: [{ orgId: previous._id }, { _id: previous._id }] });
    }
    await mongoose.connection.collection("counters").deleteMany({ _id: { $regex: `^${previous._id}:` } } as never);
    report.push(`reset: removed the previous "${companyName}"`);
  }

  const orgId = new Types.ObjectId();
  await runWithCtx(systemCtx(orgId), async () => {
    await OrgModel.create([{
      _id: orgId, companyName, companyReg: settings.companyReg ?? "", companyAddress: settings.companyAddress ?? "", companyPhone: settings.companyPhone ?? "",
      logoPath: await moveFile(settings.logoPath), bankName: settings.bankName ?? "", bankAccountName: settings.bankAccountName ?? "",
      bankAccount: settings.bankAccount ?? "", swiftCode: settings.swiftCode ?? null,
      defaultMarkupPct: settings.defaultMarkupPct ?? 40, minMarkupPct: settings.minMarkupPct ?? 20, sstBps: 800, createdBy: owner._id,
    }]);
    await MembershipModel.create([{ orgId, userId: owner._id, role: "owner" }]);

    // ---- Vendors and leads --------------------------------------------------
    await VendorModel.create(all("Vendor").map((v) => ({
      _id: idOf(v.id), name: v.name, type: v.type, registrationNo: v.registrationNo, contactPerson: v.contactPerson, phone: v.phone,
      email: v.email, location: v.location, experienceYears: v.experienceYears, active: bool(v.active), jobsCount: v.jobsCount ?? 0, notes: v.notes,
    })));

    const activities = all("LeadActivity");
    await LeadModel.create(all("Lead").map((l) => ({
      _id: idOf(l.id), code: l.code, name: l.name, phone: l.phone, email: l.email, source: l.source, campaign: l.campaign,
      propertyType: l.propertyType, builtUpArea: l.builtUpArea, budgetMin: sen(l.budgetMin), budgetMax: sen(l.budgetMax), ...ADDRESS(l),
      siteAddress: l.siteAddress, targetStart: l.targetStart, assignedTo: l.assignedTo, status: l.status, surveyAt: toDate(l.surveyAt),
      createdAt: toDate(l.createdAt), updatedAt: toDate(l.createdAt),
      activities: activities.filter((a) => a.leadId === l.id).map((a) => ({ _id: idOf(a.id), note: a.note, author: a.author, createdAt: toDate(a.createdAt) })),
    })), NO_TS);

    // ---- Projects with their work items, BOM lines and client milestones -----
    const rfqs = all("Rfq");
    const pos = all("PurchaseOrder");
    const invoices = all("Invoice");
    const poByBom = new Map(pos.filter((p) => p.rfqId).map((p) => [rfqs.find((r) => r.id === p.rfqId)?.bomItemId, p]));
    const materials = all("BomMaterial");
    const workItems = all("WorkItem");
    const bomItems = all("BomItem");
    const milestones = all("PaymentMilestone");

    for (const p of all("Project")) {
      const lines = bomItems.filter((b) => b.projectId === p.id).map((b) => {
        const mats = materials.filter((m) => m.bomItemId === b.id).map((m) => ({ _id: idOf(m.id), name: m.name, qty: m.qty, unit: m.unit, unitCost: sen(m.unitCost)!, total: sen(m.total)! }));
        const line = {
          _id: idOf(b.id), workItemId: idOf(b.workItemId), seq: b.seq, workPackage: b.workPackage, description: b.description, qty: b.qty, unit: b.unit,
          unitCost: sen(b.unitCost)!, estTotal: sen(b.estTotal)!, performedBy: b.performedBy, materials: mats,
          awarded: poByBom.get(b.id) ? { poId: idOf(poByBom.get(b.id)!.id)!, amount: sen(poByBom.get(b.id)!.amount)! } : null,
        };
        const recomputed = calcBomTotal({ qty: line.qty, unitCost: line.unitCost, materials: mats }).total;
        if (recomputed !== line.estTotal) report.push(`BOM total differs: ${p.code} "${b.workPackage}" stored ${line.estTotal} vs computed ${recomputed} sen`);
        return line;
      });
      await ProjectModel.create([{
        _id: idOf(p.id), code: p.code, name: p.name, clientName: p.clientName, clientPhone: p.clientPhone, clientEmail: p.clientEmail, ...ADDRESS(p),
        siteAddress: p.siteAddress, propertyType: p.propertyType, builtUpArea: p.builtUpArea, budgetMin: sen(p.budgetMin), budgetMax: sen(p.budgetMax),
        campaign: p.campaign, surveyAt: toDate(p.surveyAt), photoPath: await moveFile(p.photoPath), contractValue: sen(p.contractValue)!,
        targetStart: toDate(p.targetStart), targetHandover: toDate(p.targetHandover), pmName: p.pmName, siteName: p.siteName, stage: p.stage,
        stageEnteredAt: toDate(p.stageEnteredAt), cancelReason: p.cancelReason, leadId: idOf(p.leadId),
        createdAt: toDate(p.createdAt), updatedAt: toDate(p.createdAt),
        workItems: workItems.filter((w) => w.projectId === p.id).map((w) => ({ _id: idOf(w.id), seq: w.seq, name: w.name, description: w.description })),
        bomItems: lines,
        milestones: milestones.filter((m) => m.projectId === p.id).map((m) => ({
          _id: idOf(m.id), seq: m.seq, name: m.name, trigger: m.trigger, pct: m.pct, amount: sen(m.amount)!, status: m.status,
          invoiceId: idOf(invoices.find((i) => i.milestoneId === m.id)?.id),
        })),
      }], NO_TS);
    }

    // ---- Procurement ----------------------------------------------------------
    const quotes = all("RfqVendorQuote");
    const revisions = all("RfqQuoteRevision");
    const quoteFields = async (q: Row) => ({
      quotedPrice: sen(q.quotedPrice)!, leadTimeDays: q.leadTimeDays, warrantyMonths: q.warrantyMonths, notes: q.notes,
      attachmentPath: await moveFile(q.attachmentPath), attachmentName: q.attachmentName,
    });
    for (const r of rfqs) {
      const qs = [];
      for (const q of quotes.filter((x) => x.rfqId === r.id)) {
        const revs = [];
        for (const v of revisions.filter((x) => x.quoteId === q.id)) revs.push({ _id: idOf(v.id), round: v.round, ...(await quoteFields(v)), receivedAt: toDate(v.receivedAt), createdAt: toDate(v.createdAt) });
        qs.push({ _id: idOf(q.id), vendorId: idOf(q.vendorId), requestedAt: toDate(q.requestedAt), receivedAt: toDate(q.receivedAt), ...(await quoteFields(q)), selected: bool(q.selected), revisions: revs });
      }
      await RfqModel.create([{ _id: idOf(r.id), code: r.code, projectId: idOf(r.projectId), bomItemId: idOf(r.bomItemId), quantity: r.quantity, respondBy: toDate(r.respondBy), note: r.note, quotes: qs, createdAt: toDate(r.createdAt), updatedAt: toDate(r.createdAt) }], NO_TS);
    }

    const poMilestones = all("PoMilestone");
    for (const po of pos) {
      const ms = [];
      for (const m of poMilestones.filter((x) => x.poId === po.id)) {
        ms.push({
          _id: idOf(m.id), seq: m.seq, label: m.label, pct: m.pct, amount: sen(m.amount)!, status: m.status, invoiceNo: m.invoiceNo, invoiceDate: toDate(m.invoiceDate),
          invoicePath: await moveFile(m.invoicePath), invoiceName: m.invoiceName, paidAmount: sen(m.paidAmount), paidDate: toDate(m.paidDate),
          method: m.method, bankRef: m.bankRef, paidFrom: m.paidFrom,
        });
      }
      await PurchaseOrderModel.create([{
        _id: idOf(po.id), code: po.code, projectId: idOf(po.projectId), rfqId: idOf(po.rfqId), vendorId: idOf(po.vendorId), description: po.description,
        qty: po.qty, amount: sen(po.amount)!, issueDate: toDate(po.issueDate), deliveryBy: toDate(po.deliveryBy), remarks: po.remarks, status: po.status, milestones: ms,
      }]);
    }

    // ---- Quotations, VOs, invoices, files -------------------------------------
    const lines = all("QuotationLineItem");
    const terms = all("QuotationTerm");
    const events = all("QuotationEvent");
    await QuotationModel.create(all("Quotation").map((q) => ({
      _id: idOf(q.id), code: q.code, revision: q.revision, projectId: idOf(q.projectId), status: q.status, sentAt: toDate(q.sentAt), viewedAt: toDate(q.viewedAt),
      acceptedAt: toDate(q.acceptedAt), signedBy: q.signedBy, createdAt: toDate(q.createdAt), updatedAt: toDate(q.createdAt),
      lineItems: lines.filter((l) => l.quotationId === q.id).map((l) => ({ _id: idOf(l.id), bomItemId: idOf(l.bomItemId), workItemName: l.workItemName, workPackage: l.workPackage, qty: l.qty, unit: l.unit, bomCost: sen(l.bomCost)!, markupPct: l.markupPct, clientPrice: sen(l.clientPrice)!, seq: l.seq })),
      terms: terms.filter((t) => t.quotationId === q.id).map((t) => ({ _id: idOf(t.id), seq: t.seq, name: t.name, trigger: t.trigger, pct: t.pct })),
      events: events.filter((e) => e.quotationId === q.id).map((e) => ({ _id: idOf(e.id), type: e.type, note: e.note, createdAt: toDate(e.createdAt) })),
    })), NO_TS);

    for (const v of all("VariationOrder")) {
      await VariationOrderModel.create([{
        _id: idOf(v.id), code: v.code, projectId: idOf(v.projectId), title: v.title, description: v.description, reason: v.reason, raisedBy: v.raisedBy,
        amount: sen(v.amount)!, status: v.status, raisedAt: toDate(v.raisedAt), bomItemId: idOf(v.bomItemId), programmeImpact: v.programmeImpact,
        attachmentPath: await moveFile(v.attachmentPath), attachmentName: v.attachmentName,
      }]);
    }

    await InvoiceModel.create(invoices.map((i) => ({
      _id: idOf(i.id), code: i.code, projectId: idOf(milestones.find((m) => m.id === i.milestoneId)?.projectId), milestoneId: idOf(i.milestoneId),
      invoiceDate: toDate(i.invoiceDate), dueDate: toDate(i.dueDate), amount: sen(i.amount)!, sstAmount: sen(i.sstAmount)!, status: i.status,
      einvoice: { status: "NOT_SUBMITTED" },
    })));

    for (const f of all("ProjectFile")) {
      const key = await moveFile(f.path);
      if (key) await FileModel.create([{ _id: idOf(f.id), projectId: idOf(f.projectId), name: f.name, path: key, size: f.size, contentType: f.contentType, createdAt: toDate(f.createdAt), updatedAt: toDate(f.createdAt) }], NO_TS);
    }

    // ---- Counters continue after the highest existing code ----------------------
    const codes: [CodeKind, string[]][] = [
      ["L", all("Lead").map((x) => x.code)], ["PRJ", all("Project").map((x) => x.code)], ["QT", all("Quotation").map((x) => x.code)],
      ["INV", invoices.map((x) => x.code)], ["RFQ", rfqs.map((x) => x.code)], ["PO", pos.map((x) => x.code)], ["VO", all("VariationOrder").map((x) => x.code)],
    ];
    for (const [kind, list] of codes) {
      const max = new Map<number, number>();
      for (const code of list) {
        const m = /^[A-Z]+-(?:(\d{4})-)?(\d+)$/.exec(code);
        if (!m) continue;
        const year = m[1] ? Number(m[1]) : mytYear();
        max.set(year, Math.max(max.get(year) ?? 0, Number(m[2])));
      }
      for (const [year, seq] of max) await raiseCounter(orgId, kind, year, seq);
    }

    // ---- Report ----------------------------------------------------------------
    const oldSum = (table: string, field: string) => all(table).reduce((s, r) => s + Math.round(Number(r[field] ?? 0) * 100), 0);
    const newSum = async (Model: mongoose.Model<any>, field: string) => (await Model.find().select(field).lean()).reduce((s, r: Row) => s + (r[field] ?? 0), 0); // eslint-disable-line @typescript-eslint/no-explicit-any
    for (const [label, table, Model, field] of [
      ["contract value", "Project", ProjectModel, "contractValue"],
      ["PO amounts", "PurchaseOrder", PurchaseOrderModel, "amount"],
      ["invoice amounts", "Invoice", InvoiceModel, "amount"],
    ] as const) {
      const a = oldSum(table, field);
      const b = await newSum(Model as never, field);
      report.push(`${a === b ? "ok" : "MISMATCH"} ${label}: old ${a} sen, new ${b} sen`);
    }
  });

  console.log(`\nMigrated "${companyName}" as organization ${orgId}`);
  console.log(report.map((l) => `  - ${l}`).join("\n"));
  console.log(`\nNext: pnpm --filter api search:rebuild -- --org ${orgId}`);
  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
```

⚠ Verify: the table names in your `dev.db` match the Prisma model names (`sqlite3 apps/web/prisma/dev.db ".tables"`, or run `SELECT name FROM sqlite_master` through `node:sqlite`).

- [x] **Step 2: Write `scripts/search-rebuild.ts`**

```ts
import { parseArgs } from "node:util";
import mongoose, { Types } from "mongoose";
import "../src/models";
import { connectDb } from "../src/common/db";
import { runWithCtx, systemCtx } from "../src/common/context";
import { indexEntry } from "../src/search/search";
import { LeadModel } from "../src/leads/lead.model";
import { ProjectModel } from "../src/projects/project.model";
import { VendorModel } from "../src/vendors/vendor.model";
import { QuotationModel } from "../src/quotations/quotation.model";
import { PurchaseOrderModel } from "../src/procurement/purchase-order.model";
import { InvoiceModel } from "../src/billing/invoice.model";

const { values } = parseArgs({ options: { org: { type: "string" } } });

async function main() {
  await connectDb();
  const orgId = new Types.ObjectId(values.org!);
  await runWithCtx(systemCtx(orgId), async () => {
    const projects = await ProjectModel.find().select("name code clientName city").lean();
    const vendors = await VendorModel.find().select("name type location").lean();
    const projectName = new Map(projects.map((p) => [String(p._id), p.name]));
    const vendorName = new Map(vendors.map((v) => [String(v._id), v.name]));
    for (const l of await LeadModel.find().select("name code phone city").lean()) indexEntry({ kind: "lead", refId: l._id, projectId: null, title: l.name, subtitle: [l.code, l.city].filter(Boolean).join(" · "), keywords: l.phone });
    for (const p of projects) indexEntry({ kind: "project", refId: p._id, projectId: p._id, title: p.name, subtitle: [p.code, p.clientName, p.city].filter(Boolean).join(" · ") });
    for (const v of vendors) indexEntry({ kind: "vendor", refId: v._id, projectId: null, title: v.name, subtitle: [v.type, v.location].filter(Boolean).join(" · ") });
    for (const q of await QuotationModel.find().select("code projectId").lean()) indexEntry({ kind: "quotation", refId: q._id, projectId: q.projectId, title: q.code, subtitle: projectName.get(String(q.projectId)) ?? "" });
    for (const po of await PurchaseOrderModel.find().select("code projectId vendorId").lean()) indexEntry({ kind: "po", refId: po._id, projectId: po.projectId, title: po.code, subtitle: [vendorName.get(String(po.vendorId)), projectName.get(String(po.projectId))].filter(Boolean).join(" · ") });
    for (const i of await InvoiceModel.find().select("code projectId").lean()) indexEntry({ kind: "invoice", refId: i._id, projectId: i.projectId, title: i.code, subtitle: projectName.get(String(i.projectId)) ?? "" });
  });
  await new Promise((r) => setTimeout(r, 2000)); // after-commit hooks run outside a transaction, in the background
  console.log("search entries rebuilt");
  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
```

The subtitle formats must match the ones the services use (Tasks 6.1, 6.3, 6.6, 6.7, 6.8). If you change one, change it in both places.

Add to `apps/api/package.json`:
```json
"migrate:sqlite": "tsx scripts/migrate-from-sqlite.ts",
"search:rebuild": "tsx scripts/search-rebuild.ts"
```

- [x] **Step 3: Commit**

```bash
git add apps/api
git commit -m "feat(api): one-off SQLite and uploads migration with a verification report"
```

---

### Task 9.2: Run it and verify

- [x] **Step 1: Run the migration**

Prerequisites: the services are up, the bucket and indexes exist (plans 05 and 06), and you have signed up and set up MFA in the web app with the owner email.

```bash
pnpm --filter api migrate:sqlite -- --owner you@example.com
```
Expected:
- `Migrated "Wawasan Interior Sdn Bhd" as organization <id>`
- `missing file: …` lines for files that don't exist on disk
- three `ok …` lines for the sums

A `MISMATCH` line means stop and investigate before going on.

- [x] **Step 2: Rebuild search**

Run: `pnpm --filter api search:rebuild -- --org <id from step 1>`
Expected: `search entries rebuilt`.

- [x] **Step 3: Compare with the old app**

Run the old app from the baseline commit in a second folder, alongside the new one:
```bash
git worktree add ../veenix-old 6e2cbeb
cp apps/web/prisma/dev.db ../veenix-old/prisma/dev.db      # git-ignored, so the worktree doesn't have it
echo 'DATABASE_URL="file:./dev.db"' > ../veenix-old/.env
cd ../veenix-old && npm install && npx prisma generate && npx next dev -p 3200
```
The old app runs on http://localhost:3200 and the new one on :3100.
Pick three projects in different stages. For each one, check that these match on both apps: the Work & BOM totals, the quotation totals with SST, the vendor PO amounts and paid status, and the payment schedule.

When you're done:
```bash
cd ../Veenix && git worktree remove ../veenix-old --force
```

- [x] **Step 4: Retire the old data**

Only after Step 3 matches, move the old files out of the app:
```bash
mkdir -p backups && mv apps/web/prisma/dev.db backups/dev.db.$(date +%Y%m%d) && mv apps/web/uploads backups/uploads.$(date +%Y%m%d)
rmdir apps/web/prisma 2>/dev/null || true
```
`backups/` is already git-ignored.

- [x] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: migrate legacy data; retire SQLite and the uploads folder"
```
