import { describe, expect, it } from "vitest";
import { Types } from "mongoose";
import "./tools.project";
import "./tools.billing";
import { approve, type Card } from "./pending";
import { executeTool, getTool, strictSchema } from "./tools";
import { AssistantConversationModel, PendingActionModel } from "./models";
import { cardText } from "../whatsapp/reply";
import { BillingService } from "../billing/billing.service";
import { InvoiceModel } from "../billing/invoice.model";
import { ProjectModel } from "../projects/project.model";
import { OrgModel } from "../orgs/org.model";
import type { RequestContext } from "../common/context";
import { asOrg, newId } from "../../test/ctx";

const org = newId(), user = newId();
const as = <T>(fn: () => Promise<T>, over: Partial<RequestContext> = {}) => asOrg(org, fn, { userId: user, role: "finance", ...over });

/** A project whose RM 1,080 deposit has been invoiced. */
async function seedInvoice() {
  if (!(await OrgModel.exists({ _id: org }))) await OrgModel.create([{ _id: org, companyName: "T", createdBy: newId() }]);
  return as(async () => {
    const [p] = await ProjectModel.create([{ code: `P-${newId()}`, name: "Taman Desa", clientName: "A", siteAddress: "x", contractValue: 108_000, milestones: [{ seq: 1, name: "Deposit", amount: 108_000, status: "AWAITING_PAYMENT" }] }]);
    const { invoiceId } = await new BillingService().generateInvoice(p.milestones[0]._id);
    const [conv] = await AssistantConversationModel.create([{ userId: user, channel: "app" }]);
    return { projectId: p._id, invoiceId, conv: conv._id };
  });
}

async function propose(conv: Types.ObjectId, input: object) {
  const r = await as(() => executeTool({ conversationId: conv, messageId: newId(), attachments: [] }, { id: String(newId()), name: "propose_client_payment", input }));
  const action = r.isError ? null : await as(() => PendingActionModel.findOne({ conversationId: conv }).sort({ _id: -1 }).lean());
  return { r, id: action?._id as Types.ObjectId, card: action?.card as Card };
}

describe("propose_client_payment", () => {
  it("never lets the model see or set the payment reference", async () => {
    const { properties } = strictSchema(getTool("propose_client_payment")!.input) as { properties: object };
    expect(Object.keys(properties)).toEqual(["invoiceId", "amountSen", "receivedAt", "method"]);
    const { invoiceId, conv } = await seedInvoice();
    const { r } = await propose(conv, { invoiceId, amountSen: 40_000, receivedAt: null, method: null, reference: "BANK-123" });
    expect(r.isError).toBe(true);
  });

  it("records nothing until approved, then takes the reference from the card only", async () => {
    const { invoiceId, conv } = await seedInvoice();
    const { id, card } = await propose(conv, { invoiceId, amountSen: 40_000, receivedAt: "2026-11-01", method: "DuitNow QR" });
    expect(card.missing).toEqual([]);
    expect(card.inputs!.find((i) => i.key === "reference")).toMatchObject({ webOnly: true, value: null });
    expect((await as(() => InvoiceModel.findById(invoiceId).lean()))!.payments).toHaveLength(0);

    const { result } = await as(() => approve(id, { reference: "BANK-123" }));
    expect(result.done).toBe("Recorded RM 400.00 on " + card.title.split(" on ")[1] + ". RM 680.00 still owed.");
    const inv = (await as(() => InvoiceModel.findById(invoiceId).lean()))!;
    expect(inv.payments[0]).toMatchObject({ amount: 40_000, method: "DuitNow QR", reference: "BANK-123" });
    expect(inv.status).toBe("PARTIALLY_PAID");
    // What goes back to the model: the approval note. No reference in it.
    const notes = (await as(() => AssistantConversationModel.findById(conv).lean()))!.notes.join(" ");
    expect(notes).toContain("RM 400.00");
    expect(notes).not.toContain("BANK-123");
  });

  it("asks for what the user didn't say, and refuses more than is owed", async () => {
    const { invoiceId, conv } = await seedInvoice();
    const { id, card } = await propose(conv, { invoiceId, amountSen: null, receivedAt: null, method: null });
    expect(card.missing).toEqual(["Amount received", "Date received", "Method"]);
    await expect(as(() => approve(id))).rejects.toThrow("Fill in");
    await expect(as(() => approve(id, { amountSen: 108_001, receivedAt: "2026-11-01", method: "Cash" }))).rejects.toThrow("RM 1,080.00 still owed");
    expect((await propose(conv, { invoiceId, amountSen: 108_001, receivedAt: null, method: null })).r).toMatchObject({ isError: true, content: expect.stringContaining("still owed") });
  });

  it("only finance and owners can propose it", async () => {
    const { invoiceId, conv } = await seedInvoice();
    const r = await as(() => executeTool({ conversationId: conv, messageId: newId(), attachments: [] }, { id: "x", name: "propose_client_payment", input: { invoiceId, amountSen: 1, receivedAt: null, method: null } }), { role: "procurement" });
    expect(r).toEqual({ content: "You don't have permission to do that.", isError: true });
  });

  it("WhatsApp shows the prefilled fields but never a web-only one", () => {
    const text = cardText({
      title: "Record a client payment", lines: [], changes: [], missing: [],
      inputs: [
        { key: "amountSen", label: "Amount received", kind: "money", value: "400.00" },
        { key: "reference", label: "Reference", kind: "text", value: "BANK-123", webOnly: true },
      ],
    });
    expect(text).toContain("Amount received: RM 400.00");
    expect(text).not.toContain("BANK-123");
  });

  it("get_project gives the model invoice ids and balances, not payment details", async () => {
    const { projectId, invoiceId, conv } = await seedInvoice();
    const { id } = await propose(conv, { invoiceId, amountSen: 8_000, receivedAt: "2026-11-01", method: "Cash" });
    await as(() => approve(id, { reference: "SECRET-REF" }));
    const r = await as(() => executeTool({ conversationId: conv, messageId: newId(), attachments: [] }, { id: "y", name: "get_project", input: { projectId: String(projectId) } }));
    expect(JSON.parse(r.content).clientMilestones[0].invoice).toMatchObject({ invoiceId: String(invoiceId), paidSen: 8_000, balanceSen: 100_000 });
    expect(r.content).not.toContain("SECRET-REF");
    expect(r.content).not.toContain("Cash");
  });
});
