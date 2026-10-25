import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";
import { addDays, quotationTotals, splitSstInclusive } from "@veenix/shared";
import { findSub } from "../common/fields";
import { notFound, rule } from "../common/errors";
import { tx } from "../common/tx";
import { enqueue } from "../jobs/jobs";
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
      await enqueue("document.snapshot", { type: "invoice", id: String(invoice._id) });
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
