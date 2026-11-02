import { describe, expect, it } from "vitest";
import { Types } from "mongoose";
import "./tools.project";
import { normalizeUnit } from "./tools.procurement";
import { approve, type Card } from "./pending";
import { executeTool } from "./tools";
import { PendingActionModel } from "./models";
import { ProjectModel } from "../projects/project.model";
import { QuotationModel } from "../quotations/quotation.model";
import { OrgModel } from "../orgs/org.model";
import { asOrg, newId } from "../../test/ctx";

const org = newId(), owner = newId();
const asOwner = <T>(fn: () => Promise<T>) => asOrg(org, fn, { userId: owner });
const tc = () => ({ conversationId: newId(), messageId: newId(), attachments: [] });
type Line = { workItemName?: string; workPackage?: string; qty: number; unit: string; totalSen?: number | null; unitCostSen?: number | null; performedBy?: string };

async function newProject() {
  if (!(await OrgModel.exists({ _id: org }))) await OrgModel.create([{ _id: org, companyName: "T", createdBy: newId(), defaultMarkupPct: 40 }]);
  return asOwner(async () => {
    const [p] = await ProjectModel.create([{ code: `P-${newId()}`, name: "Taman Desa", clientName: "A", workItems: [{ seq: 1, name: "Flooring" }] }]);
    await QuotationModel.create([{ code: `QT-${newId()}`, revision: 1, projectId: p._id, status: "DRAFT" }]);
    return p._id;
  });
}

async function propose(projectId: Types.ObjectId, ...lines: Line[]) {
  const input = {
    projectId: String(projectId),
    lines: lines.map((l) => ({ workItemName: "flooring", workPackage: "Tiling", performedBy: "OUTSOURCED", totalSen: null, unitCostSen: null, ...l })),
  };
  const r = await asOwner(() => executeTool(tc(), { id: String(newId()), name: "propose_budget_lines", input }));
  const action = r.isError ? null : await asOwner(() => PendingActionModel.findOne().sort({ _id: -1 }).lean());
  return { r, id: action?._id as Types.ObjectId, card: action?.card as Card };
}

const values = (card: Card) => card.lines.map((l) => l.value).join(" | ");
const bom = async (p: Types.ObjectId) => (await asOwner(() => ProjectModel.findById(p).lean()))!.bomItems;

describe("propose_budget_lines", () => {
  it("normalizes units to WORK_UNITS, or returns null", () => {
    expect(["sqft", "sq.ft", "Square Feet", "SQ FT", "sf"].map(normalizeUnit)).toEqual(Array(5).fill("sq ft"));
    expect(normalizeUnit("m2")).toBe("sq m");
    expect(normalizeUnit("pts")).toBe("point");
    expect(normalizeUnit("bucket")).toBeNull();
  });

  it("400 sq ft at a RM6,000 allowance is one line at RM15.00", async () => {
    const p = await newProject();
    const { card, id } = await propose(p, { qty: 400, unit: "sqft", totalSen: 600_000 });
    expect(card.missing).toEqual([]);
    expect(values(card)).toContain("400 sq ft × RM 15.00 = RM 6,000.00 cost");
    await asOwner(() => approve(id));
    expect((await bom(p))[0]).toMatchObject({ unit: "sq ft", unitCost: 1500, qty: 400, estTotal: 600_000 });
  });

  it("shows the client price after markup", async () => {
    const { card } = await propose(await newProject(), { qty: 400, unit: "sq ft", totalSen: 600_000 });
    expect(values(card)).toContain("RM 8,400.00 to the client (40% markup)");
  });

  it("RM100 over 3 units shows the real total of RM99.99", async () => {
    const { card } = await propose(await newProject(), { qty: 3, unit: "unit", totalSen: 10_000 });
    expect(values(card)).toContain("3 unit × RM 33.33 = RM 99.99 cost");
    expect(values(card)).toContain("stated RM 100.00");
  });

  it("a line with no price can't be approved until a price is entered", async () => {
    const p = await newProject();
    const { card, id, r } = await propose(p, { qty: 400, unit: "sq ft" });
    expect(r.content).toContain("must fill in");
    expect(card.missing).toEqual(["Price for Tiling"]);
    expect(card.inputs).toEqual([{ key: "lines.0.totalSen", label: "Tiling: line total", kind: "money" }]);
    await expect(asOwner(() => approve(id))).rejects.toThrow("Fill in: Price for Tiling");
    await expect(asOwner(() => approve(id, { "lines.0.workPackage": "Marble" }))).rejects.toThrow("can't be edited");
    await asOwner(() => approve(id, { "lines.0.totalSen": 500_000 }));
    expect((await bom(p))[0]).toMatchObject({ workPackage: "Tiling", unitCost: 1250, estTotal: 500_000 });
  });

  it("nothing changes before approval", async () => {
    const p = await newProject();
    await propose(p, { qty: 400, unit: "sq ft", totalSen: 600_000 });
    expect(await bom(p)).toHaveLength(0);
  });

  it("approval goes through saveBomItem, creates a missing work item and refreshes the draft", async () => {
    const p = await newProject();
    // Outsourced lines reach the quotation only once a PO prices them; in-house lines go in straight away.
    const ceiling = { workItemName: "Ceiling", workPackage: "Plaster ceiling", qty: 1, unit: "lot", unitCostSen: 300_000, performedBy: "SELF" };
    const { id } = await propose(p, { qty: 400, unit: "sq ft", totalSen: 600_000 }, ceiling);
    await asOwner(() => approve(id));
    const project = (await asOwner(() => ProjectModel.findById(p).lean()))!;
    expect(project.workItems.map((w) => w.name)).toEqual(["Flooring", "Ceiling"]);
    expect(project.bomItems).toHaveLength(2);
    expect((await asOwner(() => QuotationModel.findOne({ projectId: p, status: "DRAFT" }).lean()))!.lineItems.map((l) => l.workPackage)).toEqual(["Plaster ceiling"]);
  });

  it("an accepted quotation's lines don't change", async () => {
    const p = await newProject();
    const line = { workItemName: "Flooring", workPackage: "Old", qty: 1, unit: "lot", bomCost: 100, markupPct: 40, clientPrice: 140, seq: 0 };
    await asOwner(() => QuotationModel.create([{ code: `QT-${newId()}`, revision: 0, projectId: p, status: "ACCEPTED", lineItems: [line] }]));
    const { id } = await propose(p, { qty: 400, unit: "sq ft", totalSen: 600_000, performedBy: "SELF" });
    await asOwner(() => approve(id));
    const accepted = (await asOwner(() => QuotationModel.findOne({ projectId: p, status: "ACCEPTED" }).lean()))!;
    expect(accepted.lineItems.map((l) => l.workPackage)).toEqual(["Old"]);
  });

  it("unknown units are refused with the list of valid ones", async () => {
    const { r } = await propose(await newProject(), { qty: 2, unit: "bucket", totalSen: 1000 });
    expect(r).toMatchObject({ isError: true, content: expect.stringContaining("sq ft, sq m, ft run") });
  });
});
