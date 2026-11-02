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

export async function rfqWithQuote(quoteId: Id) {
  const rfq = await RfqModel.findOne({ "quotes._id": quoteId });
  if (!rfq) throw notFound("Quote");
  return { rfq, quote: findSub(rfq.quotes, quoteId)! };
}

async function assertNotAwarded(rfqId: Id, message = "This package has already been awarded") {
  if (await PurchaseOrderModel.exists({ rfqId })) throw rule(message);
}

/** acceptQuote's checks, also run by the assistant before it shows a card. */
export async function assertCanAccept(rfqId: Id, quote: { receivedAt?: Date | null; quotedPrice: number }) {
  if (!quote.receivedAt || quote.quotedPrice <= 0) throw rule("Mark the quote as received first");
  await assertNotAwarded(rfqId, "A quote has already been accepted for this package");
}

export async function poWithMilestone(milestoneId: Id) {
  const po = await PurchaseOrderModel.findOne({ "milestones._id": milestoneId });
  if (!po) throw notFound("Payment milestone");
  return { po, milestone: findSub(po.milestones, milestoneId)! };
}

/** setPoTerms's check, also run by the assistant before it shows a card. */
export function assertTermsEditable(po: { milestones: { status?: string | null }[] }) {
  if (po.milestones.some((m) => m.status !== "PENDING")) throw rule("Payment terms are locked once a vendor invoice has been attached");
}

/** recordPayment's checks, also run by the assistant before it shows a card. */
export function assertCanPay(milestone: { status?: string | null; amount: number }, paidAmount: number) {
  if (milestone.status === "PAID") throw rule("This milestone is already paid");
  if (milestone.status !== "INVOICED") throw rule("Attach the vendor's invoice before recording payment");
  if (paidAmount > milestone.amount) throw rule(`The amount paid can't be more than the milestone amount (${formatCurrency(milestone.amount)})`);
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

  /** Undoes a recorded first quote: back to invited. Refused once anything has moved on since. */
  async clearReceivedQuote(quoteId: Id, expected: { receivedAt: Date }) {
    const { rfq, quote } = await rfqWithQuote(quoteId);
    await assertNotAwarded(rfq._id);
    if (quote.revisions.length || quote.receivedAt?.getTime() !== expected.receivedAt.getTime()) throw rule("This has changed since. Open it in Veenix.");
    quote.set({ quotedPrice: 0, leadTimeDays: 0, warrantyMonths: 0, notes: null, receivedAt: null, attachmentPath: null, attachmentName: null });
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
      await assertCanAccept(rfq._id, quote);
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
      assertTermsEditable(po);
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
      assertCanPay(milestone, input.paidAmount);
      milestone.set({ status: "PAID", paidAmount: input.paidAmount, paidDate: input.paidDate ?? new Date(), method: input.method, bankRef: input.bankRef, paidFrom: input.paidFrom });
      po.status = po.milestones.every((m) => m.status === "PAID") ? "PAID" : "ISSUED";
      await po.save();
      await audit("po_milestone.paid", "purchase_order", po._id, { milestoneId: String(milestoneId), paidAmount: input.paidAmount }, po.projectId);
      touched(po.projectId);
    });
  }
}
