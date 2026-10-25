import { describe, expect, it } from "vitest";
import { BomService } from "./bom.service";
import { ProjectModel } from "./project.model";
import { RfqModel } from "../procurement/rfq.model";
import { QuotationModel } from "../quotations/quotation.model";
import { OrgModel } from "../orgs/org.model";
import { asOrg, newId } from "../../test/ctx";

const bom = new BomService();
const org = newId();
const run = <T>(fn: () => Promise<T>) => asOrg(org, fn);

async function seedProject() {
  await OrgModel.create([{ _id: org, companyName: "T", createdBy: newId() }]);
  const [p] = await run(() => ProjectModel.create([{ code: "PRJ-2026-0001", name: "Condo", clientName: "Aisyah", siteAddress: "x" }]));
  return p._id;
}

describe("BOM", () => {
  it("computes totals in sen on the server and keeps the draft in step", async () => {
    const projectId = await seedProject();
    await run(() => bom.createWorkItem(projectId, { name: "Kitchen", description: null }));
    const wi = (await run(() => ProjectModel.findById(projectId).lean()))!.workItems[0];
    await run(() => bom.saveBomItem(projectId, null, {
      workItemId: String(wi._id), workPackage: "Cabinets", description: null, unit: "ft run", qty: 12.5, unitCost: 34500, performedBy: "SELF",
      materials: [{ name: "Plywood", qty: 3, unit: "pcs", unitCost: 8990 }],
    }));
    const line = (await run(() => ProjectModel.findById(projectId).lean()))!.bomItems[0];
    expect(line.estTotal).toBe(431250 + 26970);
  });

  it("refuses duplicate work item names, case-insensitively", async () => {
    const projectId = (await run(() => ProjectModel.findOne().lean()))!._id;
    await expect(run(() => bom.createWorkItem(projectId, { name: "kitchen", description: null }))).rejects.toThrow('"kitchen" already exists on this project');
  });

  it("cascades a BOM delete to its RFQ and unlinks quotation lines", async () => {
    const p = (await run(() => ProjectModel.findOne().lean()))!;
    const b = p.bomItems[0];
    await run(() => RfqModel.create([{ code: "RFQ-0001", projectId: p._id, bomItemId: b._id, quantity: "1 lot" }]));
    await run(() => QuotationModel.create([{ code: "QT-2026-0001", revision: 1, projectId: p._id, status: "SUPERSEDED", lineItems: [{ bomItemId: b._id, workPackage: "Cabinets", bomCost: 1, markupPct: 0, clientPrice: 1 }] }]));
    await run(() => bom.deleteBomItem(b._id));
    expect(await run(() => RfqModel.countDocuments({ bomItemId: b._id }))).toBe(0);
    expect((await run(() => QuotationModel.findOne({ code: "QT-2026-0001" }).lean()))!.lineItems[0].bomItemId).toBeNull();
  });
});
