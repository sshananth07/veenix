import { describe, expect, it } from "vitest";
import { Types } from "mongoose";
import "./tools.project";
import "./tools.procurement";
import { approve, type Card } from "./pending";
import { executeTool } from "./tools";
import { PendingActionModel } from "./models";
import { ProjectModel } from "../projects/project.model";
import { RfqModel } from "../procurement/rfq.model";
import { PurchaseOrderModel } from "../procurement/purchase-order.model";
import { VendorModel } from "../vendors/vendor.model";
import { OrgModel } from "../orgs/org.model";
import type { RequestContext } from "../common/context";
import { asOrg, newId } from "../../test/ctx";

const org = newId(), user = newId();
const as = <T>(fn: () => Promise<T>, over: Partial<RequestContext> = {}) => asOrg(org, fn, { userId: user, ...over });
const tc = () => ({ conversationId: newId(), messageId: newId(), attachments: [] });
const fifty = [{ label: "Deposit", pct: 50 }, { label: "Completion", pct: 50 }];

/** A package with Ali's received quote of RM5,000. */
async function seedQuote() {
  if (!(await OrgModel.exists({ _id: org }))) await OrgModel.create([{ _id: org, companyName: "T", createdBy: newId() }]);
  return as(async () => {
    const workItemId = newId(), bomItemId = newId();
    const [project] = await ProjectModel.create([{
      code: `P-${newId()}`, name: "Taman Desa", clientName: "A", workItems: [{ _id: workItemId, seq: 1, name: "Flooring" }],
      bomItems: [{ _id: bomItemId, workItemId, seq: 1, workPackage: "Tiling", qty: 400, unit: "sq ft", unitCost: 1500, estTotal: 600_000 }],
    }]);
    const [vendor] = await VendorModel.create([{ name: `Ali ${newId()}` }]);
    const [rfq] = await RfqModel.create([{
      code: `RFQ-${newId()}`, projectId: project._id, bomItemId, quantity: "400 sq ft",
      quotes: [{ vendorId: vendor._id, quotedPrice: 500_000, receivedAt: new Date() }],
    }]);
    return { project: project._id, rfqId: rfq._id, quoteId: rfq.quotes[0]._id, vendorId: vendor._id };
  });
}

/** A PO with one invoiced milestone and one still pending. */
async function seedPo() {
  const { project, rfqId, vendorId } = await seedQuote();
  const [po] = await as(() => PurchaseOrderModel.create([{
    code: `PO-${newId()}`, projectId: project, rfqId, vendorId, description: "Tiling", qty: "400 sq ft", amount: 500_000,
    milestones: [
      { seq: 1, label: "Deposit", pct: 50, amount: 250_000, status: "INVOICED", invoiceNo: "INV-1" },
      { seq: 2, label: "Completion", pct: 50, amount: 250_000 },
    ],
  }]));
  return { invoiced: po.milestones[0]._id, pending: po.milestones[1]._id, poId: po._id };
}

async function run(name: string, input: object, over: Partial<RequestContext> = {}) {
  const r = await as(() => executeTool(tc(), { id: String(newId()), name, input }), over);
  const action = r.isError ? null : await as(() => PendingActionModel.findOne().sort({ _id: -1 }).lean());
  return { r, id: action?._id as Types.ObjectId, card: action?.card as Card };
}

const accept = (quoteId: Types.ObjectId, terms: object[] | null) => run("propose_accept_quote", { quoteId: String(quoteId), terms, deliveryBy: null, remarks: null });
const pay = (milestoneId: Types.ObjectId, paidAmountSen: number, over: Partial<RequestContext> = { role: "finance" }) =>
  run("propose_vendor_payment", { milestoneId: String(milestoneId), paidAmountSen, paidDate: null, method: null, bankRef: null }, over);
const pos = (rfqId: Types.ObjectId) => as(() => PurchaseOrderModel.countDocuments({ rfqId }));

describe("propose_accept_quote and propose_vendor_payment", () => {
  it("no PO exists until approval", async () => {
    const { quoteId, rfqId } = await seedQuote();
    const { card } = await accept(quoteId, fifty);
    expect(card.lines).toEqual(expect.arrayContaining([expect.objectContaining({ label: "Amount", value: "RM 5,000.00" })]));
    expect(await pos(rfqId)).toBe(0);
  });

  it("approval creates exactly one PO, even when approved twice", async () => {
    const { quoteId, rfqId } = await seedQuote();
    const { id } = await accept(quoteId, fifty);
    await as(() => approve(id));
    await expect(as(() => approve(id))).rejects.toThrow("already handled");
    expect(await pos(rfqId)).toBe(1);
  });

  it("missing terms block approval until they're filled in on the card", async () => {
    const { quoteId, rfqId } = await seedQuote();
    const { id, card } = await accept(quoteId, null);
    expect(card.missing).toEqual(["Payment terms"]);
    expect(card.inputs).toEqual([{ key: "terms", label: "Payment terms", kind: "terms" }]);
    await expect(as(() => approve(id))).rejects.toThrow("Fill in: Payment terms");
    await as(() => approve(id, { terms: fifty }));
    expect((await as(() => PurchaseOrderModel.findOne({ rfqId }).lean()))!.milestones.map((m) => m.amount)).toEqual([250_000, 250_000]);
  });

  it("terms not totalling 100% are refused with the existing message", async () => {
    const { quoteId } = await seedQuote();
    const short = [{ label: "Deposit", pct: 50 }, { label: "Completion", pct: 40 }];
    expect((await accept(quoteId, short)).r).toMatchObject({ isError: true, content: "Payment terms add up to 90%. They must total 100%." });
    const { id } = await accept(quoteId, null);
    await expect(as(() => approve(id, { terms: short }))).rejects.toThrow("They must total 100%");
  });

  it("an awarded package can't be proposed again", async () => {
    const { quoteId } = await seedQuote();
    await as(async () => approve((await accept(quoteId, fifty)).id));
    expect((await accept(quoteId, fifty)).r).toMatchObject({ isError: true, content: "A quote has already been accepted for this package" });
  });

  it("a payment on an uninvoiced milestone is refused before a card is shown", async () => {
    const { pending } = await seedPo();
    const before = await as(() => PendingActionModel.countDocuments());
    expect((await pay(pending, 250_000)).r).toMatchObject({ isError: true, content: "Attach the vendor's invoice before recording payment" });
    expect((await as(() => PendingActionModel.countDocuments()))).toBe(before);
  });

  it("a payment above the milestone is refused before a card is shown", async () => {
    const { invoiced } = await seedPo();
    expect((await pay(invoiced, 260_000)).r).toMatchObject({ isError: true, content: expect.stringContaining("can't be more than the milestone amount") });
  });

  it("an approved payment marks the milestone paid", async () => {
    const { invoiced, poId } = await seedPo();
    const { id, card } = await pay(invoiced, 250_000);
    expect(card.lines).toEqual(expect.arrayContaining([expect.objectContaining({ label: "Paying", value: "RM 2,500.00" })]));
    await as(() => approve(id), { role: "finance" });
    const m = (await as(() => PurchaseOrderModel.findById(poId).lean()))!.milestones[0];
    expect(m).toMatchObject({ status: "PAID", paidAmount: 250_000, method: "Bank Transfer" });
  });

  it("procurement staff can't propose a payment", async () => {
    const { invoiced } = await seedPo();
    expect((await pay(invoiced, 250_000, { role: "procurement" })).r).toEqual({ content: "You don't have permission to do that.", isError: true });
  });

  it("the approver's permission is checked again at approval", async () => {
    const { invoiced } = await seedPo();
    const { id } = await pay(invoiced, 250_000);
    await expect(as(() => approve(id), { role: "procurement" })).rejects.toThrow("Your role cannot do this");
  });
});
