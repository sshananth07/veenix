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

    // Part payment, then the rest; never more than is owed, never dated ahead.
    const pay = (amount: number, receivedAt = new Date()) => run(() => billing.recordPayment(inv._id, { amount, receivedAt, method: "Bank transfer", reference: null }));
    const state = async () => {
      const i = (await run(() => InvoiceModel.findById(inv._id).lean()))!;
      const m = (await run(() => ProjectModel.findById(p._id).lean()))!.milestones[0];
      return [i.status, m.status, m.paidAmount];
    };
    await expect(pay(1_000, new Date(Date.now() + 2 * 86_400_000))).rejects.toThrow("can't be in the future");
    await pay(40_000);
    expect(await state()).toEqual(["PARTIALLY_PAID", "AWAITING_PAYMENT", 40_000]);
    await expect(pay(68_001)).rejects.toThrow("RM 680.00 still owed");
    await pay(68_000);
    expect(await state()).toEqual(["PAID", "PAID", 108_000]);
    await expect(pay(1)).rejects.toThrow("This invoice is already paid in full");

    // Reversing reopens the balance but keeps the row.
    const paid = (await run(() => InvoiceModel.findById(inv._id).lean()))!;
    await run(() => billing.reversePayment(inv._id, paid.payments[1]._id));
    await expect(run(() => billing.reversePayment(inv._id, paid.payments[1]._id))).rejects.toThrow("already reversed");
    expect(await state()).toEqual(["PARTIALLY_PAID", "AWAITING_PAYMENT", 40_000]);
    expect((await run(() => InvoiceModel.findById(inv._id).lean()))!.payments).toHaveLength(2);
  });

  it("invoices a milestone before it falls due, but not one on hold", async () => {
    const [p] = await run(() => ProjectModel.create([{ code: "PRJ-2026-0002", name: "Terrace", clientName: "B", siteAddress: "y", contractValue: 200_000, milestones: [
      { seq: 1, name: "Week 1", amount: 100_000, status: "NOT_YET_DUE" },
      { seq: 2, name: "Retention", amount: 100_000, status: "HELD" },
    ] }]));
    const { invoiceId } = await run(() => billing.generateInvoice(p.milestones[0]._id));
    expect((await run(() => ProjectModel.findById(p._id).lean()))!.milestones[0]).toMatchObject({ status: "AWAITING_PAYMENT", invoiceId: expect.anything() });
    expect(invoiceId).toBeTruthy();
    await expect(run(() => billing.generateInvoice(p.milestones[1]._id))).rejects.toThrow("on hold");
  });
});
