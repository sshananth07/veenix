import { describe, expect, it } from "vitest";
import { DocumentsService } from "./documents.service";
import { runDue } from "../jobs/jobs";
import { enqueue } from "../jobs/jobs";
import { storedFor } from "./stored";
import { tx } from "../common/tx";
import { OrgModel } from "../orgs/org.model";
import { ProjectModel } from "../projects/project.model";
import { QuotationModel } from "../quotations/quotation.model";
import { asOrg, newId } from "../../test/ctx";

const docs = new DocumentsService();
const org = newId();

describe("snapshots", () => {
  it("keeps the PDF the client received after the letterhead changes", async () => {
    await OrgModel.create([{ _id: org, companyName: "Old Name Sdn Bhd", createdBy: newId() }]);
    const [p] = await asOrg(org, () => ProjectModel.create([{ code: "PRJ-2026-0001", name: "Condo", clientName: "A", siteAddress: "x" }]));
    const [q] = await asOrg(org, () => QuotationModel.create([{ code: "QT-2026-0001", revision: 1, projectId: p._id, status: "SENT", terms: [{ seq: 1, name: "All", trigger: "-", pct: 100 }] }]));
    await asOrg(org, () => tx(() => enqueue("document.snapshot", { type: "quotation", id: String(q._id) })));
    await runDue();

    const sent = await asOrg(org, () => docs.pdf("quotation", q._id));
    await OrgModel.updateOne({ _id: org }, { companyName: "New Name Sdn Bhd" });
    const later = await asOrg(org, () => docs.pdf("quotation", q._id));
    expect(later.buffer.equals(sent.buffer)).toBe(true);
  });

  it("never hands out an earlier draft render once the quotation is sent", async () => {
    const p = (await asOrg(org, () => ProjectModel.findOne().lean()))!;
    const [q] = await asOrg(org, () => QuotationModel.create([{ code: "QT-2026-0002", revision: 2, projectId: p._id, status: "DRAFT" }]));
    const draft = await asOrg(org, () => storedFor("quotation", q._id)); // emailing a draft is allowed
    await asOrg(org, () => QuotationModel.updateOne({ _id: q._id }, { status: "SENT" }));
    const sent = await asOrg(org, () => storedFor("quotation", q._id));
    expect(sent.key).not.toBe(draft.key);
    const again = await asOrg(org, () => storedFor("quotation", q._id));
    expect(again.key).toBe(sent.key);
    expect((await asOrg(org, () => QuotationModel.findById(q._id).lean()))!.snapshot?.key).toBe(sent.key);
  });
});
