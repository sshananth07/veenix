import { describe, expect, it } from "vitest";
import { Types } from "mongoose";
import "./tools.project";
import "./tools.query";
import "./tools.procurement";
import { approve, type Card } from "./pending";
import { executeTool } from "./tools";
import { PendingActionModel } from "./models";
import { ProjectModel } from "../projects/project.model";
import { PurchaseOrderModel } from "../procurement/purchase-order.model";
import { RfqModel } from "../procurement/rfq.model";
import { VendorModel } from "../vendors/vendor.model";
import { OrgModel } from "../orgs/org.model";
import type { RequestContext } from "../common/context";
import { asOrg, newId } from "../../test/ctx";

const org = newId(), user = newId();
const as = <T>(fn: () => Promise<T>, over: Partial<RequestContext> = {}) => asOrg(org, fn, { userId: user, ...over });
const tc = () => ({ conversationId: newId(), messageId: newId(), attachments: [] });
const call = (name: string, input: object, over: Partial<RequestContext> = {}) => as(() => executeTool(tc(), { id: String(newId()), name, input }), over);
const query = (input: object, over: Partial<RequestContext> = {}) =>
  call("query_records", { filters: [], groupBy: null, metric: { type: "rows", field: null }, sort: null, limit: null, ...input }, over);

let p1: Types.ObjectId, p2: Types.ObjectId, vendor: Types.ObjectId, po1: Types.ObjectId;
const paid = (amount: number, paidDate: string) => ({ seq: 1, label: "Deposit", pct: 50, amount, status: "PAID", paidAmount: amount, paidDate: new Date(paidDate) });

describe("financial questions and the procurement catalogue", () => {
  it("sums vendor payments for a month, calculated by the server", async () => {
    await OrgModel.create([{ _id: org, companyName: "T", createdBy: newId() }]);
    await as(async () => {
      [p1, p2] = (await ProjectModel.create([{ code: "F-1", name: "Mine", clientName: "A", contractValue: 1_000_000 }, { code: "F-2", name: "Other", clientName: "B" }])).map((p) => p._id);
      vendor = (await VendorModel.create([{ name: "Ali Tiling" }]))[0]._id;
      po1 = (await PurchaseOrderModel.create([
        { code: "PO-1", projectId: p1, vendorId: vendor, description: "Tiling", qty: "1", amount: 500_000, milestones: [paid(250_001, "2026-10-03"), { seq: 2, label: "Completion", pct: 50, amount: 249_999 }] },
        { code: "PO-2", projectId: p2, vendorId: vendor, description: "Paint", qty: "1", amount: 300_000, milestones: [paid(120_050, "2026-10-28"), { ...paid(179_950, "2026-11-02"), seq: 2 }] },
      ]))[0]._id;
    });
    const r = await query({
      entity: "po_milestones",
      filters: [{ field: "milestones.paidDate", op: "gte", value: "2026-10-01" }, { field: "milestones.paidDate", op: "lt", value: "2026-11-01" }],
      metric: { type: "sum", field: "milestones.paidAmount" },
    });
    expect(r.isError).toBe(false);
    expect(JSON.parse(r.content)).toMatchObject({ rows: [{ value: 370_051 }], formatted: ["RM 3,700.51"] });
  });

  it("a role without report:read can't sum money", async () => {
    const r = await query({ entity: "po_milestones", metric: { type: "sum", field: "milestones.paidAmount" } }, { role: "site_staff", projectScope: [p1] });
    expect(r).toMatchObject({ isError: true, content: expect.stringContaining("reports permission") });
  });

  it("a project manager's record query stays inside assigned projects", async () => {
    const r = await query({ entity: "purchase_orders" }, { role: "project_manager", projectScope: [p1] });
    expect(JSON.parse(r.content).rows.map((row: { code: string }) => row.code)).toEqual(["PO-1"]);
  });

  it("lineItems isn't queryable on quotations", async () => {
    const r = await query({ entity: "quotations", filters: [{ field: "lineItems.clientPrice", op: "gt", value: 0 }] });
    expect(r).toMatchObject({ isError: true, content: expect.stringContaining("Allowed fields: _id, code") });
    expect(r.content).not.toContain("lineItems,");
  });

  it("a query on vendors needs vendor:read", async () => {
    expect(await query({ entity: "vendors" }, { role: "site_staff", projectScope: [p1] })).toMatchObject({ isError: true });
    expect(JSON.parse((await query({ entity: "vendors" }, { role: "procurement" })).content).rows[0]).toMatchObject({ name: "Ali Tiling" });
  });

  it("client milestones and project money follow project:read", async () => {
    await as(() => ProjectModel.updateOne({ _id: p1 }, { $set: { milestones: [{ seq: 1, name: "Deposit", amount: 300_000, status: "INVOICED" }] } }));
    const r = await query({ entity: "client_milestones", filters: [{ field: "milestones.status", op: "eq", value: "INVOICED" }] }, { role: "site_staff", projectScope: [p1] });
    expect(JSON.parse(r.content).rows).toEqual([expect.objectContaining({ code: "F-1", "milestones.amount": 300_000 })]);
    const money = await query({ entity: "projects", filters: [{ field: "code", op: "eq", value: "F-1" }] }, { role: "site_staff", projectScope: [p1] });
    expect(JSON.parse(money.content).rows[0]).toMatchObject({ contractValue: 1_000_000 });
  });

  it("get_business_report is refused without report:read", async () => {
    expect(await call("get_business_report", {}, { role: "procurement" })).toEqual({ content: "You don't have permission to do that.", isError: true });
    const r = await call("get_business_report", {}, { role: "finance" });
    expect(JSON.parse(r.content).vendorSpend).toEqual([expect.objectContaining({ name: "Ali Tiling", committed: 800_000 })]);
  });

  it("propose_set_po_terms shows current and new terms and changes nothing before approval", async () => {
    const r = await call("propose_set_po_terms", { poId: String(po1), terms: [{ label: "Deposit", pct: 30 }, { label: "Completion", pct: 70 }] });
    expect(r.isError).toBe(true); // a paid milestone locks the terms
    expect(r.content).toBe("Payment terms are locked once a vendor invoice has been attached");

    const [fresh] = await as(() => PurchaseOrderModel.create([{ code: "PO-3", projectId: p1, vendorId: vendor, description: "Ceiling", qty: "1", amount: 100_000, milestones: [{ seq: 1, label: "Full", pct: 100, amount: 100_000 }] }]));
    await call("propose_set_po_terms", { poId: String(fresh._id), terms: [{ label: "Deposit", pct: 50 }, { label: "Completion", pct: 50 }] });
    const action = (await as(() => PendingActionModel.findOne({ toolName: "set_po_terms" }).lean()))!;
    expect((action.card as Card).changes).toEqual([{ label: "Payment terms", before: "Full 100% (RM 1,000.00)", after: "Deposit 50% (RM 500.00), Completion 50% (RM 500.00)" }]);
    expect((await as(() => PurchaseOrderModel.findById(fresh._id).lean()))!.milestones).toHaveLength(1);
  });

  it("approved PO terms go through setPoTerms, including its total-of-100% rule", async () => {
    const po = (await as(() => PurchaseOrderModel.findOne({ code: "PO-3" }).lean()))!;
    const short = await call("propose_set_po_terms", { poId: String(po._id), terms: [{ label: "Deposit", pct: 50 }, { label: "Completion", pct: 40 }] });
    expect(short).toMatchObject({ isError: true, content: "Payment terms add up to 90%. They must total 100%." });
    const action = (await as(() => PendingActionModel.findOne({ toolName: "set_po_terms" }).lean()))!;
    await as(() => approve(action._id));
    expect((await as(() => PurchaseOrderModel.findById(po._id).lean()))!.milestones.map((m) => m.amount)).toEqual([50_000, 50_000]);
  });

  it("propose_request_quotes invites vendors only after approval", async () => {
    const bomItemId = newId(), workItemId = newId();
    await as(() => ProjectModel.updateOne({ _id: p1 }, { $set: { workItems: [{ _id: workItemId, seq: 1, name: "Wet works" }], bomItems: [{ _id: bomItemId, workItemId, seq: 1, workPackage: "Waterproofing", qty: 1, unit: "lot" }] } }));
    const r = await call("propose_request_quotes", { bomItemId: String(bomItemId), vendorIds: [String(vendor)], respondBy: null, note: null });
    expect(r.isError).toBe(false);
    const action = (await as(() => PendingActionModel.findOne({ toolName: "request_quotes" }).lean()))!;
    expect((action.card as Card).changes).toEqual([{ label: "Invited", before: "Nobody", after: "Ali Tiling" }]);
    expect(await as(() => RfqModel.countDocuments({ bomItemId }))).toBe(0);
    await as(() => approve(action._id));
    expect((await as(() => RfqModel.findOne({ bomItemId }).lean()))!.quotes).toHaveLength(1);
  });
});
