import { describe, expect, it } from "vitest";
import { Types } from "mongoose";
import { z } from "zod";
import "./tools.project";
import { approve, defineApprovalAction, reject, undoToolCall } from "./pending";
import { allTools, executeTool, getTool, toolsFor } from "./tools";
import { AssistantConversationModel, AssistantToolCallModel, PendingActionModel } from "./models";
import { ProjectModel } from "../projects/project.model";
import { SiteUpdateModel } from "../updates/site-update.model";
import { MembershipModel } from "../orgs/membership.model";
import { asOrg, newId } from "../../test/ctx";

const org = newId(), owner = newId(), pm = newId();
let project: Types.ObjectId, conv: Types.ObjectId;
const asOwner = <T>(fn: () => Promise<T>) => asOrg(org, fn, { userId: owner });
const asOther = <T>(fn: () => Promise<T>) => asOrg(org, fn, { userId: newId() });
const tc = () => ({ conversationId: conv, messageId: newId(), attachments: [] });
const callId = () => String(newId());

let applied = 0;
defineApprovalAction({
  name: "zz_priced",
  description: "test",
  input: z.strictObject({ label: z.string(), price: z.int().nullable() }),
  permission: "bom:write",
  validate: async ({ label, price }) => ({ title: label, lines: [], changes: [], missing: price == null ? ["Price"] : [] }),
  apply: async ({ label }) => {
    if (label === "explode") throw new Error("service refused");
    applied++;
    return { ok: true };
  },
});

async function proposeAs(input: { label: string; price: number | null }) {
  const r = await asOwner(() => executeTool(tc(), { id: callId(), name: "propose_zz_priced", input }));
  expect(r.content).toContain("Not applied");
  return (await asOwner(() => PendingActionModel.findOne().sort({ _id: -1 }).lean()))!._id;
}

describe("approval and undo", () => {
  it("registering an action creates a deferred propose_ tool at approval level", async () => {
    [project] = (await asOwner(() => ProjectModel.create([{ code: "P1", name: "Taman Desa", clientName: "A" }]))).map((p) => p._id);
    conv = (await asOwner(() => AssistantConversationModel.create([{ userId: owner, channel: "app", projectId: null }])))[0]._id;
    expect(getTool("propose_zz_priced")).toMatchObject({ level: "approval", deferred: true });
    expect(toolsFor("owner").find((t) => "name" in t && t.name === "propose_assign_project_staff")).toMatchObject({ defer_loading: true });
  });

  it("another user can't approve", async () => {
    const id = await proposeAs({ label: "a", price: 1 });
    await expect(asOther(() => approve(id))).rejects.toThrow("Only the person who asked");
  });

  it("can't approve twice: apply runs once", async () => {
    const id = await proposeAs({ label: "twice", price: 1 });
    const before = applied;
    await asOwner(() => approve(id));
    await expect(asOwner(() => approve(id))).rejects.toThrow("already handled");
    expect(applied).toBe(before + 1);
  });

  it("refuses after 24 hours", async () => {
    const id = await proposeAs({ label: "old", price: 1 });
    await asOwner(() => PendingActionModel.updateOne({ _id: id }, { $set: { expiresAt: new Date(Date.now() - 1) } }));
    await expect(asOwner(() => approve(id))).rejects.toThrow("expired");
  });

  it("re-checks permission: a demoted user is refused", async () => {
    const id = await proposeAs({ label: "demoted", price: 1 });
    await expect(asOrg(org, () => approve(id), { userId: owner, role: "sales" })).rejects.toThrow("Your role cannot do this");
  });

  it("refuses while the card has missing fields, and accepts edits that fill them", async () => {
    const id = await proposeAs({ label: "no price", price: null });
    await expect(asOwner(() => approve(id))).rejects.toThrow("Fill in: Price");
    await expect(asOwner(() => approve(id, { price: 500 }))).resolves.toMatchObject({ status: "applied" });
  });

  it("a failed apply leaves the action pending", async () => {
    const id = await proposeAs({ label: "explode", price: 1 });
    await expect(asOwner(() => approve(id))).rejects.toThrow("service refused");
    expect((await asOwner(() => PendingActionModel.findById(id).lean()))!.status).toBe("pending");
    await asOwner(() => reject(id));
    expect((await asOwner(() => PendingActionModel.findById(id).lean()))!.status).toBe("rejected");
  });

  it("no tool can approve: approve isn't in the registry and proposing never applies", async () => {
    expect(allTools().filter((t) => /approve|reject|undo/.test(t.name))).toEqual([]);
    await MembershipModel.create({ orgId: org, userId: pm, role: "project_manager" });
    const r = await asOwner(() => executeTool(tc(), { id: callId(), name: "propose_assign_project_staff", input: { projectId: String(project), assignees: [{ userId: String(pm), role: "project_manager" }] } }));
    expect(r.isError).toBe(false);
    expect((await asOwner(() => ProjectModel.findById(project).lean()))!.assignees).toEqual([]);
  });

  it("propose_assign_project_staff shows current and new assignees, and applies only on approval", async () => {
    const p = (await asOwner(() => PendingActionModel.findOne({ toolName: "assign_project_staff" }).lean()))!;
    expect(p.card).toMatchObject({ changes: [{ label: "Assigned", before: "Nobody", after: expect.stringContaining("project manager") }] });
    await asOwner(() => approve(p._id));
    expect((await asOwner(() => ProjectModel.findById(project).lean()))!.assignees).toHaveLength(1);
  });

  it("undo removes the update; undo refuses when the stage changed since", async () => {
    const add = { id: callId(), name: "add_project_update", input: { projectId: String(project), kind: "progress", text: "undo me", attachPhotos: false } };
    await asOwner(() => executeTool(tc(), add));
    const addCall = (await asOwner(() => AssistantToolCallModel.findOne({ toolUseId: add.id }).lean()))!;
    await asOwner(() => undoToolCall(addCall._id));
    expect(await asOwner(() => SiteUpdateModel.countDocuments({ text: "undo me" }))).toBe(0);
    await expect(asOwner(() => undoToolCall(addCall._id))).rejects.toThrow("already undone");
    await expect(asOther(() => undoToolCall(addCall._id))).rejects.toThrow("not found");

    const stage = { id: callId(), name: "set_project_stage", input: { projectId: String(project), stage: "QUOTING", cancelReason: null } };
    await asOwner(() => executeTool(tc(), stage));
    const stageCall = (await asOwner(() => AssistantToolCallModel.findOne({ toolUseId: stage.id }).lean()))!;
    const doc = await asOwner(() => ProjectModel.findById(project));
    doc!.stage = "WORK_IN_PROGRESS";
    await asOwner(() => doc!.save());
    await expect(asOwner(() => undoToolCall(stageCall._id))).rejects.toThrow("This has changed since");
    expect((await asOwner(() => ProjectModel.findById(project).lean()))!.stage).toBe("WORK_IN_PROGRESS");
    expect((await asOwner(() => AssistantToolCallModel.findById(stageCall._id).lean()))!.undoneAt).toBeNull();
  });
});
