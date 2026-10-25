import { describe, expect, it } from "vitest";
import { ProcurementService } from "./procurement.service";
import { PurchaseOrderModel } from "./purchase-order.model";
import { RfqModel } from "./rfq.model";
import { ProjectModel } from "../projects/project.model";
import { VendorModel } from "../vendors/vendor.model";
import { OrgModel } from "../orgs/org.model";
import { asOrg, newId } from "../../test/ctx";

const svc = new ProcurementService();
const org = newId();
const run = <T>(fn: () => Promise<T>) => asOrg(org, fn);
const terms = { terms: [{ label: "Deposit", pct: 50 }, { label: "Balance", pct: 50 }], deliveryBy: null, remarks: null };
const received = { quotedPrice: 500_001, leadTimeDays: 14, warrantyMonths: 12, notes: null, file: null };

describe("procurement", () => {
  it("awards one package once, even under a race, and pays within the milestone", async () => {
    await OrgModel.create([{ _id: org, companyName: "T", createdBy: newId() }]);
    const [v1, v2] = await run(() => VendorModel.create([{ name: "KH Carpentry" }, { name: "Elite Woodwork" }]));
    const [p] = await run(() => ProjectModel.create([{ code: "PRJ-2026-0001", name: "Condo", clientName: "A", siteAddress: "x", bomItems: [{ seq: 1, workPackage: "Cabinets", estTotal: 600_000 }] }]));
    const bomId = p.bomItems[0]._id;

    await run(() => svc.requestQuotes(bomId, { vendorIds: [String(v1._id), String(v2._id)], respondBy: null, note: null }));
    const rfq = (await run(() => RfqModel.findOne({ bomItemId: bomId }).lean()))!;
    const [q1, q2] = rfq.quotes;
    await run(() => svc.quoteReceived(q1._id, received));
    await run(() => svc.quoteReceived(q2._id, { ...received, quotedPrice: 480_000 }));

    const results = await Promise.allSettled([run(() => svc.acceptQuote(q1._id, terms)), run(() => svc.acceptQuote(q2._id, terms))]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const po = (await run(() => PurchaseOrderModel.findOne({ rfqId: rfq._id }).lean()))!;
    expect(po.milestones.map((m) => m.amount).reduce((a, b) => a + b)).toBe(po.amount);
    const awarded = (await run(() => ProjectModel.findById(p._id).lean()))!.bomItems[0].awarded;
    expect(awarded!.amount).toBe(po.amount);

    const m = po.milestones[0];
    await expect(run(() => svc.recordPayment(m._id, { paidAmount: m.amount, paidDate: null, method: "Bank Transfer", bankRef: null, paidFrom: null }))).rejects.toThrow("Attach the vendor's invoice before recording payment");
    await run(() => PurchaseOrderModel.updateOne({ _id: po._id, "milestones._id": m._id }, { $set: { "milestones.$.status": "INVOICED" } }));
    await expect(run(() => svc.recordPayment(m._id, { paidAmount: m.amount + 1, paidDate: null, method: "Bank Transfer", bankRef: null, paidFrom: null }))).rejects.toThrow("can't be more than the milestone amount");
  });
});
