import { describe, expect, it } from "vitest";
import { Types } from "mongoose";
import "./tools.leads";
import { approve, type Card } from "./pending";
import { executeTool } from "./tools";
import { PendingActionModel } from "./models";
import { LeadModel } from "../leads/lead.model";
import { ProjectModel } from "../projects/project.model";
import { asOrg, newId } from "../../test/ctx";

const org = newId(), user = newId();
const as = <T>(fn: () => Promise<T>) => asOrg(org, fn, { userId: user });

async function run(name: string, input: object) {
  const r = await as(() => executeTool({ conversationId: newId(), messageId: newId(), attachments: [] }, { id: String(newId()), name, input }));
  const action = r.isError ? null : await as(() => PendingActionModel.findOne().sort({ _id: -1 }).lean());
  return { r, id: action?._id as Types.ObjectId, card: action?.card as Card };
}
const lead = (over: object = {}) => ({
  name: "Puan Aisyah", phone: "012-345 6789", email: null, source: null, propertyType: "Terrace", budgetMinSen: null, budgetMaxSen: null,
  addressLine1: "12 Jalan Mawar", postcode: "47300", city: "Petaling Jaya", state: "Selangor", ...over,
});
const convert = (leadId: string, address: object | null = null) =>
  run("propose_convert_lead", { leadId, projectName: "Aisyah Residence", nextStage: null, projectOwner: null, targetStart: null, targetHandover: null, address });
const site = { addressLine1: "8 Jalan Melawati", addressLine2: null, addressLine3: null, postcode: "53100", city: "Kuala Lumpur", state: "Selangor" };

describe("lead and project approvals", () => {
  it("adds a lead, then turns it into a project, and says what was made", async () => {
    const proposed = await run("propose_create_lead", lead());
    expect(proposed.card.lines).toContainEqual({ label: "Site address", value: expect.stringContaining("47300 Petaling Jaya") });
    expect(await as(() => LeadModel.countDocuments())).toBe(0); // nothing until approved
    const added = await as(() => approve(proposed.id));
    expect(added.result.done).toMatch(/^Lead L-\S+ added for Puan Aisyah\.$/);
    expect(added.result.next).toEqual({ label: "Make it a project", prompt: expect.stringMatching(/^Convert lead L-\S+ \(Puan Aisyah\) into a project$/) });

    expect((await run("propose_create_lead", lead({ name: "Someone else" }))).r).toMatchObject({ isError: true, content: expect.stringContaining("already has this phone number") });

    const c = await convert(String(added.result.leadId));
    expect(c.card).toMatchObject({ title: "Create project Aisyah Residence", missing: [] });
    const made = await as(() => approve(c.id));
    expect(made.result.done).toMatch(/^Project PRJ-\S+ created: Aisyah Residence\.$/);
    const project = await as(() => ProjectModel.findById(made.result.projectId).lean());
    expect(project).toMatchObject({ clientName: "Puan Aisyah", stage: "SITE_VISIT" });
    expect((await as(() => PendingActionModel.findById(c.id).lean()))!.card).toMatchObject({ link: `/projects/${project!._id}` });

    expect((await convert(String(added.result.leadId))).r).toMatchObject({ isError: true, content: expect.stringContaining("already a project") });
  });

  it("a lead without a site address gets it filled in on the card, or from the chat", async () => {
    const noAddress = { addressLine1: null, postcode: null, city: null, state: null };
    const addLead = async (phone: string) => { const { id } = await run("propose_create_lead", lead({ phone, ...noAddress })); return as(() => approve(id)); };
    const first = await addLead("019-000 0000");
    const c = await convert(String(first.result.leadId));
    expect(c.card).toMatchObject({ missing: ["Site address"], inputs: [{ key: "address", kind: "address" }] });
    await expect(as(() => approve(c.id))).rejects.toThrow("Fill in: Site address");
    await expect(as(() => approve(c.id, { address: { ...site, postcode: "531" } }))).rejects.toThrow("5 digits");
    const made = await as(() => approve(c.id, { address: site }));
    expect(made.result.siteAddress).toContain("53100 Kuala Lumpur");
    expect(await as(() => LeadModel.findById(first.result.leadId).lean())).toMatchObject({ status: "CONVERTED", postcode: "53100" });

    // An address the user stated in chat makes the card complete.
    const second = await addLead("019-111 1111");
    expect((await convert(String(second.result.leadId), site)).card).toMatchObject({ missing: [], inputs: [] });
  });
});
