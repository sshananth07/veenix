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
