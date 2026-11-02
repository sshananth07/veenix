import { describe, expect, it } from "vitest";
import { Types } from "mongoose";
import "./tools.project";
import "./tools.procurement";
import { undoToolCall } from "./pending";
import { executeTool } from "./tools";
import { AssistantToolCallModel } from "./models";
import { ProjectModel } from "../projects/project.model";
import { RfqModel } from "../procurement/rfq.model";
import { PurchaseOrderModel } from "../procurement/purchase-order.model";
import { ProcurementService } from "../procurement/procurement.service";
import { VendorModel } from "../vendors/vendor.model";
import { OrgModel } from "../orgs/org.model";
import { asOrg, newId } from "../../test/ctx";

const org = newId(), owner = newId();
const asOwner = <T>(fn: () => Promise<T>) => asOrg(org, fn, { userId: owner });
const tc = () => ({ conversationId: newId(), messageId: newId(), attachments: [] });
const quote = (quoteId: Types.ObjectId, quotedPriceSen: number) => ({
  id: String(newId()), name: "record_vendor_quote",
  input: { quoteId: String(quoteId), quotedPriceSen, leadTimeDays: null, warrantyMonths: null, notes: null },
});
const loadQuote = async (quoteId: Types.ObjectId) => (await asOwner(() => RfqModel.findOne({ "quotes._id": quoteId }).lean()))!.quotes.find((q) => q._id.equals(quoteId))!;

/** A project with one outsourced package and an RFQ inviting the given vendors. */
async function seedPackage(vendorNames: string[]) {
  if (!(await OrgModel.exists({ _id: org }))) await OrgModel.create([{ _id: org, companyName: "T", createdBy: newId() }]);
  return asOwner(async () => {
    const workItemId = newId(), bomItemId = newId();
    const [project] = await ProjectModel.create([{
      code: `P-${newId()}`, name: "Taman Desa", clientName: "A", workItems: [{ _id: workItemId, seq: 1, name: "Flooring" }],
      bomItems: [{ _id: bomItemId, workItemId, seq: 1, workPackage: "Tiling", qty: 400, unit: "sq ft", unitCost: 1500, estTotal: 600_000 }],
    }]);
    const vendors = await VendorModel.create(vendorNames.map((name) => ({ name: `${name} ${newId()}` })));
    const [rfq] = await RfqModel.create([{ code: `RFQ-${newId()}`, projectId: project._id, bomItemId, quantity: "400 sq ft", quotes: vendors.map((v) => ({ vendorId: v._id })) }]);
    return { project: project._id, rfq, quoteIds: rfq.quotes.map((q) => q._id) };
  });
}

describe("record_vendor_quote", () => {
  it("records the quote on the invited row", async () => {
    const { quoteIds: [q] } = await seedPackage(["Ali"]);
    const r = await asOwner(() => executeTool(tc(), quote(q, 500_000)));
    expect(r.isError).toBe(false);
    expect(r.content).toContain("RM 5,000.00");
    expect(await loadQuote(q)).toMatchObject({ quotedPrice: 500_000, leadTimeDays: 0, warrantyMonths: 0, revisions: [] });
    expect((await loadQuote(q)).receivedAt).toBeInstanceOf(Date);
  });

  it("a second figure from the same vendor becomes a revision, keeping the first in history", async () => {
    const { quoteIds: [q] } = await seedPackage(["Ali"]);
    await asOwner(() => executeTool(tc(), quote(q, 500_000)));
    const use = quote(q, 450_000);
    const r = await asOwner(() => executeTool(tc(), use));
    expect(r.content).toContain("revised");
    const saved = await loadQuote(q);
    expect(saved.quotedPrice).toBe(450_000);
    expect(saved.revisions.map((v) => v.quotedPrice)).toEqual([500_000]);
    expect((await asOwner(() => AssistantToolCallModel.findOne({ toolUseId: use.id }).lean()))!.undo).toBeNull(); // no undo for a revision
  });

  it("refuses once the package is awarded", async () => {
    const { project, rfq, quoteIds: [q] } = await seedPackage(["Ali"]);
    await asOwner(() => PurchaseOrderModel.create([{ code: `PO-${newId()}`, projectId: project, rfqId: rfq._id, vendorId: rfq.quotes[0].vendorId, description: "Tiling", qty: "1", amount: 1 }]));
    const r = await asOwner(() => executeTool(tc(), quote(q, 500_000)));
    expect(r).toMatchObject({ isError: true, content: expect.stringContaining("already been awarded") });
  });

  it("site staff lack procurement:write and are refused", async () => {
    const { project, quoteIds: [q] } = await seedPackage(["Ali"]);
    const r = await asOrg(org, () => executeTool(tc(), quote(q, 500_000)), { role: "site_staff", projectScope: [project] });
    expect(r).toEqual({ content: "You don't have permission to do that.", isError: true });
    expect((await loadQuote(q)).receivedAt).toBeNull();
  });

  it("undo restores the invited state and refuses if the quote changed since", async () => {
    const { quoteIds: [q] } = await seedPackage(["Ali"]);
    const first = quote(q, 500_000);
    await asOwner(() => executeTool(tc(), first));
    const call = (await asOwner(() => AssistantToolCallModel.findOne({ toolUseId: first.id }).lean()))!;
    await asOwner(() => undoToolCall(call._id));
    expect(await loadQuote(q)).toMatchObject({ receivedAt: null, quotedPrice: 0, revisions: [] });

    const again = quote(q, 500_000);
    await asOwner(() => executeTool(tc(), again));
    await asOwner(() => new ProcurementService().reviseQuote(q, { quotedPrice: 480_000, leadTimeDays: 0, warrantyMonths: 0, notes: null, file: null }));
    const call2 = (await asOwner(() => AssistantToolCallModel.findOne({ toolUseId: again.id }).lean()))!;
    await expect(asOwner(() => undoToolCall(call2._id))).rejects.toThrow("This has changed since");
    expect((await loadQuote(q)).quotedPrice).toBe(480_000);
  });

  it("a quoteId from another organization is not found", async () => {
    const { quoteIds: [q] } = await seedPackage(["Ali"]);
    const r = await asOrg(newId(), () => executeTool(tc(), quote(q, 500_000)));
    expect(r).toMatchObject({ isError: true, content: expect.stringContaining("not found") });
  });

  it("get_project lists quote and milestone ids", async () => {
    const { project, quoteIds: [q] } = await seedPackage(["Ali"]);
    const r = await asOwner(() => executeTool(tc(), { id: String(newId()), name: "get_project", input: { projectId: String(project) } }));
    const pkg = JSON.parse(r.content).packages[0];
    expect(pkg).toMatchObject({ bomItemId: expect.any(String), quotes: [{ quoteId: String(q), vendor: expect.stringContaining("Ali"), received: false }], po: null });
  });
});
