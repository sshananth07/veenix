import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";
import { addDays, formatMoney2, invoicePaid, quotationTotals, splitSstInclusive, toDateInput, type ClientPaymentMethod } from "@veenix/shared";
import { ctx } from "../common/context";
import { findSub } from "../common/fields";
import { notFound, rule } from "../common/errors";
import { tx } from "../common/tx";
import { enqueue } from "../jobs/jobs";
import { requestSubmission } from "../einvoice/einvoice.jobs";
import { audit } from "../audit/audit";
import { nextCode } from "../counters/counters";
import { changed } from "../live/live";
import { indexEntry } from "../search/search";
import { loadOrg } from "../orgs/org.model";
import { loadProject, loadProjectBy } from "../projects/project.model";
import { QuotationModel } from "../quotations/quotation.model";
import { UserModel } from "../users/user.model";
import { InvoiceModel } from "./invoice.model";
import { applySchedule } from "./schedule";

type Id = Types.ObjectId;
const INVOICE_DUE_DAYS = 7;
type Invoice = NonNullable<Awaited<ReturnType<typeof loadInvoice>>>;

async function loadInvoice(id: Id) {
  const invoice = await InvoiceModel.findById(id);
  if (!invoice) throw notFound("Invoice");
  return invoice;
}

/** Brings the invoice status and its milestone in line with the payments recorded. */
async function settle(invoice: Invoice) {
  const total = invoice.amount + invoice.sstAmount;
  const paid = invoicePaid(invoice);
  invoice.status = paid >= total ? "PAID" : paid > 0 ? "PARTIALLY_PAID" : "ISSUED";
  await invoice.save();
  const project = await loadProject(invoice.projectId);
  findSub(project.milestones, invoice.milestoneId)?.set({ status: paid >= total ? "PAID" : "AWAITING_PAYMENT", paidAmount: paid });
  await project.save();
  changed({ kind: "project", projectId: String(invoice.projectId) });
}

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
      if (milestone.status === "HELD") throw rule("This milestone is on hold, so it can't be invoiced yet");

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
      await enqueue("document.snapshot", { type: "invoice", id: String(invoice._id) });
      await requestSubmission(invoice._id);
      changed({ kind: "project", projectId: String(projectId) });
      return { invoiceId: String(invoice._id) };
    });
  }

  /** Records money received against an invoice: the whole balance or part of it. */
  async recordPayment(invoiceId: Id, input: { amount: number; receivedAt: Date; method: ClientPaymentMethod; reference: string | null }) {
    await tx(async () => {
      const invoice = await loadInvoice(invoiceId);
      const balance = invoice.amount + invoice.sstAmount - invoicePaid(invoice);
      if (balance <= 0) throw rule("This invoice is already paid in full");
      if (input.amount > balance) throw rule(`That's more than the ${formatMoney2(balance)} still owed on this invoice`);
      if (toDateInput(input.receivedAt) > toDateInput(new Date())) throw rule("The payment date can't be in the future");
      const { userId } = ctx();
      const recordedByName = userId ? ((await UserModel.findById(userId).select("name").lean())?.name ?? null) : null;
      invoice.payments.push({ ...input, recordedBy: userId, recordedByName });
      await settle(invoice);
      await audit("invoice.payment_recorded", "invoice", invoice._id, { amount: input.amount, method: input.method, reference: input.reference }, invoice.projectId);
    });
  }

  /** Undoes a payment recorded by mistake (or one that bounced). The row stays, marked reversed. */
  async reversePayment(invoiceId: Id, paymentId: Id) {
    await tx(async () => {
      const invoice = await loadInvoice(invoiceId);
      const payment = findSub(invoice.payments, paymentId);
      if (!payment) throw notFound("Payment");
      if (payment.reversedAt) throw rule("This payment is already reversed");
      payment.set({ reversedAt: new Date(), reversedBy: ctx().userId });
      await settle(invoice);
      await audit("invoice.payment_reversed", "invoice", invoice._id, { paymentId: String(paymentId), amount: payment.amount }, invoice.projectId);
    });
  }
}
