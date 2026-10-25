import { describe, expect, it } from "vitest";
import { DocumentsService } from "./documents.service";
import { OrgModel } from "../orgs/org.model";
import { ProjectModel } from "../projects/project.model";
import { QuotationModel } from "../quotations/quotation.model";
import { asOrg, newId } from "../../test/ctx";

const docs = new DocumentsService();
const org = newId();

describe("documents", () => {
  it("renders a quotation PDF from Mongo data", async () => {
    await OrgModel.create([{ _id: org, companyName: "Wawasan Interior", createdBy: newId() }]);
    const [p] = await asOrg(org, () => ProjectModel.create([{ code: "PRJ-2026-0001", name: "Condo", clientName: "Aisyah", siteAddress: "Petaling Jaya" }]));
    const [q] = await asOrg(org, () => QuotationModel.create([{ code: "QT-2026-0001", revision: 1, projectId: p._id, lineItems: [{ workItemName: "Kitchen", workPackage: "Cabinets", bomCost: 100_000, markupPct: 40, clientPrice: 140_000 }], terms: [{ seq: 1, name: "Deposit", trigger: "-", pct: 100 }] }]));
    const r = await asOrg(org, () => docs.pdf("quotation", q._id));
    expect(r.filename).toBe("QT-2026-0001.pdf");
    expect(r.buffer.subarray(0, 4).toString()).toBe("%PDF");
  });
});
