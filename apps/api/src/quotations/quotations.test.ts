import { describe, expect, it } from "vitest";
import { QuotationsService } from "./quotations.service";
import { QuotationModel } from "./quotation.model";
import { BomService } from "../projects/bom.service";
import { ProjectModel } from "../projects/project.model";
import { OrgModel } from "../orgs/org.model";
import { asOrg, newId } from "../../test/ctx";

const q = new QuotationsService();
const bom = new BomService();
const org = newId();
const run = <T>(fn: () => Promise<T>) => asOrg(org, fn);
const terms = { terms: [{ name: "Deposit", trigger: "On acceptance", pct: 30 }, { name: "Completion", trigger: "Handover", pct: 70 }] };

async function pricedProject() {
  await OrgModel.create([{ _id: org, companyName: "T", createdBy: newId() }]);
  const [p] = await run(() => ProjectModel.create([{ code: "PRJ-2026-0001", name: "Condo", clientName: "Aisyah", siteAddress: "x" }]));
  await run(() => bom.createWorkItem(p._id, { name: "Kitchen", description: null }));
  const wi = (await run(() => ProjectModel.findById(p._id).lean()))!.workItems[0];
  await run(() => bom.saveBomItem(p._id, null, { workItemId: String(wi._id), workPackage: "Cabinets", description: null, unit: "lot", qty: 1, unitCost: 1_000_000, performedBy: "SELF", materials: [] }));
  return p._id;
}

describe("QuotationsService", () => {
  it("runs draft → sent → signed atomically and builds the schedule", async () => {
    const projectId = await pricedProject();
    const { id } = await run(() => q.build(projectId, { markupPct: 40 }));
    await expect(run(() => q.send(id))).rejects.toThrow("Set the payment terms first");
    await run(() => q.setTerms(id, terms));
    await run(() => q.send(id));
    const { id: draft2 } = await run(() => q.revise(id)); // a newer draft while Rev 1 is with the client
    await run(() => q.accept(id, { signedBy: "Aisyah" }));

    const project = (await run(() => ProjectModel.findById(projectId).lean()))!;
    expect(project.contractValue).toBe(1_512_000); // 1,000,000 × 1.4 + 8% SST
    expect(project.milestones.map((m) => [m.name, m.amount, m.status])).toEqual([
      ["Deposit", 453_600, "AWAITING_PAYMENT"],
      ["Completion", 1_058_400, "NOT_YET_DUE"],
    ]);
    expect(await run(() => QuotationModel.findById(draft2).lean())).toBeNull();
    await expect(run(() => q.revise(id))).rejects.toThrow("The quotation is signed. Further changes go through Variation Orders.");
  });
});
