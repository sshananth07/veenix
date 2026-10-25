import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";
import { renderToBuffer } from "@react-pdf/renderer";
import { notFound } from "../common/errors";
import { findSub } from "../common/fields";
import { plain } from "../common/plain";
import { getObject } from "../storage/storage";
import { loadOrg } from "../orgs/org.model";
import { toInvoiceDto } from "../projects/core";
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
        // toInvoiceDto flattens einvoice.uuid into the eInvoiceUuid the template reads.
        const buffer = await renderToBuffer(<InvoicePdf company={company} invoice={P(toInvoiceDto(inv))} milestoneName={milestone?.name ?? ""} project={P(p)} sstBps={company.sstBps} />);
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
