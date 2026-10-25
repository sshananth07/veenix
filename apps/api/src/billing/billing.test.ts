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
