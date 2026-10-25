import { describe, expect, it } from "vitest";
import { LeadsService } from "./leads.service";
import { LeadModel } from "./lead.model";
import { ProjectModel } from "../projects/project.model";
import { setUser } from "../common/context";
import { asOrg, newId } from "../../test/ctx";
import { leadInput, convertLeadInput } from "@veenix/shared";

const svc = new LeadsService();
const org = newId();
const run = <T>(fn: () => Promise<T>) => asOrg(org, async () => { setUser({ id: newId(), email: "s@x.my", name: "Siti", platformRole: null }); return fn(); }, { role: "sales" });

describe("LeadsService", () => {
  it("creates with a yearly code and searches name, phone, code and place", async () => {
    await run(() => svc.create(leadInput.parse({ name: "Aisyah Rahman", phone: "012-3456789", city: "Petaling Jaya" })));
    const list = await run(() => svc.list({ view: "open", q: "petaling", page: 1 }));
    expect(list.leads[0].code).toMatch(/^L-\d{4}-0001$/);
    expect(list.counts).toEqual({ open: 1, converted: 0, all: 1 });
  });

  it("converts once, needs a full address, and links both ways", async () => {
    const lead = await run(() => LeadModel.findOne().lean());
    const input = convertLeadInput.parse({ projectName: "Aisyah Condo" });
    await expect(run(() => svc.convert(lead!._id, input))).rejects.toThrow("Add the site address before converting");

    const address = { addressLine1: "No. 12, Jalan SS 2/24", postcode: "47300", city: "Petaling Jaya", state: "Selangor" };
    const { projectId } = await run(() => svc.convert(lead!._id, convertLeadInput.parse({ projectName: "Aisyah Condo", address })));
    const project = await run(() => ProjectModel.findById(projectId).lean());
    expect(project).toMatchObject({ name: "Aisyah Condo", clientName: "Aisyah Rahman", siteAddress: "No. 12, Jalan SS 2/24, 47300 Petaling Jaya, Selangor" });
    expect((await run(() => svc.get(lead!._id))).status).toBe("CONVERTED");
    await expect(run(() => svc.convert(lead!._id, input))).rejects.toThrow("This lead is already converted");
  });
});
