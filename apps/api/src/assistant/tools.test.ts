import { describe, expect, it } from "vitest";
import { Types } from "mongoose";
import { z } from "zod";
import "./tools.project";
import { allTools, defineTool, executeTool, toolsFor, type ToolContext } from "./tools";
import { AssistantToolCallModel } from "./models";
import { SiteUpdateModel } from "../updates/site-update.model";
import { ProjectModel } from "../projects/project.model";
import { AuditModel } from "../audit/audit";
import { asOrg, newId } from "../../test/ctx";

const org = newId(), staff = newId();
let mine: Types.ObjectId, other: Types.ObjectId;
const c = (): ToolContext => ({ conversationId: newId(), messageId: newId(), attachments: [] });
const asOwner = <T>(fn: () => Promise<T>) => asOrg(org, fn);
const asStaff = <T>(fn: () => Promise<T>) => asOrg(org, fn, { userId: staff, role: "site_staff", projectScope: [mine] });
const names = (tools: ReturnType<typeof toolsFor>) => tools.map((t) => ("name" in t ? t.name : t.type));

defineTool({ name: "zz_deferred_probe", description: "test", input: z.strictObject({}), permission: "bom:write", level: "read", deferred: true, run: async () => ({ content: "ok" }) });

describe("tool registry", () => {
  it("offers each role only its tools, in a stable order", async () => {
    [mine, other] = (await asOwner(() => ProjectModel.create([
      { code: "PRJ-1", name: "Mine", clientName: "A", assignees: [{ userId: staff, role: "site_staff" }] },
      { code: "PRJ-2", name: "Other", clientName: "B" },
    ]))).map((p) => p._id);
    const tools = toolsFor("site_staff").filter((t) => t.type === "function");
    const n = names(tools);
    expect(n).toContain("add_project_update");
    expect(n).not.toContain("set_project_stage");
    expect(n).toEqual([...n].sort());
    expect(tools.every((t) => t.type === "function" && t.strict)).toBe(true);
  });

  it("refuses a tool the role lacks even if the LLM calls it", async () => {
    const r = await asStaff(() => executeTool(c(), { id: "t1", name: "set_project_stage", input: { projectId: String(mine), stage: "QUOTING", cancelReason: null } }));
    expect(r).toEqual({ content: "You don't have permission to do that.", isError: true });
    expect((await asOwner(() => ProjectModel.findById(mine).lean()))!.stage).toBe("SITE_VISIT");
  });

  it("can't reach an unassigned project", async () => {
    const r = await asStaff(() => executeTool(c(), { id: "t2", name: "add_project_update", input: { projectId: String(other), kind: "progress", text: "x", attachPhotos: false } }));
    expect(r).toEqual({ content: "Project not found", isError: true });
    expect(await asOwner(() => SiteUpdateModel.countDocuments({ projectId: other }))).toBe(0);
  });

  it("a retried tool call doesn't write twice", async () => {
    const ctx = c();
    const use = { id: "t3", name: "add_project_update", input: { projectId: String(mine), kind: "progress", text: "tiling done", attachPhotos: false } };
    await asStaff(() => executeTool(ctx, use));
    await asStaff(() => executeTool(ctx, use));
    expect(await asOwner(() => SiteUpdateModel.countDocuments({ projectId: mine }))).toBe(1);
    expect((await asOwner(() => AssistantToolCallModel.findOne({ toolUseId: "t3" }).lean()))!.undo).toMatchObject({ updateId: expect.any(String) });
  });

  it("returns invalid input as an error for the LLM to correct", async () => {
    const r = await asStaff(() => executeTool(c(), { id: "t4", name: "add_project_update", input: { projectId: String(mine), kind: "gossip", text: "x", attachPhotos: false } }));
    expect(r.isError).toBe(true);
    expect(r.content).toContain("kind");
  });

  it("marks deferred tools with defer_loading, adds tool search, and hides them from a role without the permission", () => {
    const owner = toolsFor("owner");
    expect(owner.find((t) => "name" in t && t.name === "zz_deferred_probe")).toMatchObject({ defer_loading: true });
    expect(owner.some((t) => t.type === "tool_search")).toBe(true);
    expect(owner.some((t) => t.type === "function" && !t.defer_loading)).toBe(true);
    expect(names(toolsFor("site_staff"))).not.toContain("zz_deferred_probe");
  });

  it("refuses to register an apply tool with no undo, or a schema strict mode won't take", () => {
    const base = { description: "x", permission: null, run: async () => ({ content: "" }) };
    expect(() => defineTool({ ...base, name: "x1", level: "apply", input: z.strictObject({}) })).toThrow("needs an undo");
    expect(() => defineTool({ ...base, name: "x2", level: "read", input: z.strictObject({ a: z.string().optional() }) })).toThrow("every field required");
  });

  it("no registered tool uses a forbidden permission or deletes anything", () => {
    const forbidden = ["einvoice:submit", "org:manage", "member:manage"];
    expect(allTools().filter((t) => forbidden.includes(t.permission as string))).toEqual([]);
    expect(allTools().filter((t) => /delete|remove/.test(t.name))).toEqual([]);
  });

  it("report_unsupported_request records an audit event and changes nothing else", async () => {
    const ctx = c();
    const r = await asStaff(() => executeTool(ctx, { id: "t5", name: "report_unsupported_request", input: { request: "Send the invoice to LHDN" } }));
    expect(r.isError).toBe(false);
    expect(await asOwner(() => AuditModel.countDocuments({ action: "assistant.unsupported_request", entityId: ctx.conversationId }))).toBe(1);
  });
});
