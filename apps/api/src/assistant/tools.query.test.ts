import { describe, expect, it } from "vitest";
import { Types } from "mongoose";
import "./tools.project";
import { buildPipeline, defineQueryEntity, runQuery, type QueryInput } from "./tools.query";
import { executeTool } from "./tools";
import { ProjectModel } from "../projects/project.model";
import { SiteUpdateModel } from "../updates/site-update.model";
import { TaskModel } from "../tasks/task.model";
import { TasksService } from "../tasks/tasks.service";
import { asOrg, newId } from "../../test/ctx";

const org = newId(), otherOrg = newId(), staff = newId();
let mine: Types.ObjectId, other: Types.ObjectId;
const asOwner = <T>(fn: () => Promise<T>, o = org) => asOrg(o, fn);
const asStaff = <T>(fn: () => Promise<T>) => asOrg(org, fn, { userId: staff, role: "site_staff", projectScope: [mine] });
const q = (over: Partial<QueryInput>): QueryInput => ({ entity: "site_updates", filters: [], groupBy: null, metric: { type: "rows", field: null }, sort: null, limit: null, ...over });
const call = (input: object) => executeTool({ conversationId: newId(), messageId: newId(), attachments: [] }, { id: String(newId()), name: "query_records", input });

// Test-only entity with a money field.
defineQueryEntity("zz_money", { model: ProjectModel, permission: "project:read", fields: { name: { type: "string", label: "Name" }, contractValue: { type: "money", label: "Contract" } } });
defineQueryEntity("zz_reports", { model: ProjectModel, permission: "report:read", fields: { name: { type: "string", label: "Name" } } });

describe("query_records", () => {
  it("counts site updates per project", async () => {
    [mine, other] = (await asOwner(() => ProjectModel.create([
      { code: "P1", name: "Mine", clientName: "A", contractValue: 100_00, assignees: [{ userId: staff, role: "site_staff" }] },
      { code: "P2", name: "Other", clientName: "B", contractValue: 250_00 },
    ]))).map((p) => p._id);
    await asOwner(() => SiteUpdateModel.create([
      { projectId: mine, kind: "progress", text: "a" }, { projectId: mine, kind: "issue", text: "b" }, { projectId: other, kind: "progress", text: "c" },
    ]));
    await asOwner(() => SiteUpdateModel.create([{ projectId: newId(), kind: "progress", text: "other org" }]), otherOrg);
    const r = await asOwner(() => runQuery(q({ groupBy: "projectId", metric: { type: "count", field: null } })));
    expect(JSON.parse(r.content).rows).toEqual([{ projectId: String(mine), value: 2 }, { projectId: String(other), value: 1 }]);
  });

  it("site staff only get assigned projects; another organization never appears", async () => {
    const r = await asStaff(() => runQuery(q({ metric: { type: "rows", field: null } })));
    expect(JSON.parse(r.content).rows.map((x: { text: string }) => x.text).sort()).toEqual(["a", "b"]);
    expect(r.display.columns).not.toContain("Project id"); // the model gets ids; the table people see doesn't
    expect(Object.keys(JSON.parse(r.content).rows[0])).toContain("projectId");
    const all = await asOwner(() => runQuery(q({ metric: { type: "count", field: null } })));
    expect(JSON.parse(all.content).rows[0].value).toBe(3);
  });

  it("a task query follows the same scope as TasksService", async () => {
    const boss = newId();
    await asOwner(() => TaskModel.create([
      { title: "mine general", createdBy: staff }, { title: "on my project", projectId: mine, createdBy: boss },
      { title: "on other project", projectId: other, createdBy: boss }, { title: "boss general", createdBy: boss },
    ]));
    const viaQuery = await asStaff(() => runQuery(q({ entity: "tasks", sort: { field: "title", dir: "asc" } })));
    const titles = JSON.parse(viaQuery.content).rows.map((t: { title: string }) => t.title);
    expect(titles).toEqual(["mine general", "on my project"]);
    const viaService = [...(await asStaff(() => new TasksService().listMine())), ...(await asStaff(() => new TasksService().listForProject(mine)))].map((t) => t.title);
    expect(new Set(titles)).toEqual(new Set(viaService));
  });

  it("refuses a field outside the map, including orgId, and lists the allowed ones", async () => {
    const r = await asOwner(() => call(q({ filters: [{ field: "orgId", op: "eq", value: String(otherOrg) }] })));
    expect(r.isError).toBe(true);
    expect(r.content).toContain("Allowed fields: _id, projectId, kind");
  });

  it("refuses an entity the role has no permission for", async () => {
    expect(await asStaff(() => call(q({ entity: "zz_reports" })))).toEqual({ content: "You don't have permission to see that.", isError: true });
    expect((await asOwner(() => call(q({ entity: "zz_reports" })))).isError).toBe(false);
  });

  it("an object as a filter value is refused", async () => {
    const r = await asOwner(() => call(q({ filters: [{ field: "kind", op: "ne", value: { $ne: null } as never }] })));
    expect(r.isError).toBe(true);
    await expect(asOwner(async () => buildPipeline({ model: SiteUpdateModel, permission: null, fields: { kind: { type: "string", label: "K" } } }, q({ filters: [{ field: "kind", op: "eq", value: { $gt: "" } as never }] })))).rejects.toThrow("isn't a valid string");
  });

  it("a sum on a money field needs report:read", async () => {
    const sum = q({ entity: "zz_money", metric: { type: "sum", field: "contractValue" } });
    await expect(asStaff(() => runQuery(sum))).rejects.toThrow("reports permission");
    const r = await asOwner(() => runQuery(sum));
    expect(r.display.rows).toEqual([["RM 350.00"]]);
  });

  it("caps rows at 50 and reports truncation", async () => {
    await asOwner(() => SiteUpdateModel.create(Array.from({ length: 55 }, (_, i) => ({ projectId: other, kind: "progress", text: `n${i}` }))));
    const r = await asOwner(() => runQuery(q({ limit: 50 })));
    expect(JSON.parse(r.content)).toMatchObject({ truncated: true });
    expect(JSON.parse(r.content).rows).toHaveLength(50);
    expect((await asOwner(() => call(q({ limit: 51 })))).isError).toBe(true);
  });

  it("the pipeline contains only allowed stages", async () => {
    const e = { model: TaskModel, permission: null, unwind: "x", scope: () => ({}), fields: { status: { type: "string" as const, label: "S" } } };
    const stages = await asOwner(async () => buildPipeline(e, q({ filters: [{ field: "status", op: "eq", value: "open" }], groupBy: "status", metric: { type: "count", field: null } })));
    expect(stages.map((s) => Object.keys(s)[0]).every((k) => ["$match", "$unwind", "$group", "$sort", "$limit"].includes(k))).toBe(true);
  });
});
