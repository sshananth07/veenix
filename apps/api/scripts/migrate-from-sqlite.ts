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

// pnpm 10 forwards a literal "--", so drop it.
const { values: args } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
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
