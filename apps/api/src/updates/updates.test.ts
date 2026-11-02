import { describe, expect, it } from "vitest";
import { Types } from "mongoose";
import { UpdatesService } from "./updates.service";
import { SiteUpdateModel } from "./site-update.model";
import { TasksService } from "../tasks/tasks.service";
import { ProjectsService } from "../projects/projects.service";
import { ProjectModel } from "../projects/project.model";
import { MembershipModel } from "../orgs/membership.model";
import { AuditModel } from "../audit/audit";
import { asOrg, newId } from "../../test/ctx";

const updates = new UpdatesService(), tasks = new TasksService(), projects = new ProjectsService();
const org = newId(), staff = newId(), boss = newId();
let mine: Types.ObjectId, other: Types.ObjectId;

const asBoss = <T>(fn: () => Promise<T>) => asOrg(org, fn, { userId: boss });
const asStaff = <T>(fn: () => Promise<T>) => asOrg(org, fn, { userId: staff, role: "site_staff", projectScope: [mine] });

describe("site updates and tasks", () => {
  it("site staff can add an update only on an assigned project", async () => {
    const [a, b] = await asBoss(() => ProjectModel.create([
      { code: "PRJ-1", name: "Mine", clientName: "A", assignees: [{ userId: staff, role: "site_staff" }] },
      { code: "PRJ-2", name: "Other", clientName: "B" },
    ]));
    mine = a._id; other = b._id;
    await expect(asStaff(() => updates.add({ projectId: String(other), kind: "progress", text: "x", photos: [] }))).rejects.toThrow("Project not found");
    await expect(asStaff(() => updates.add({ projectId: String(mine), kind: "progress", text: "x", photos: [] }))).resolves.toBeDefined();
    expect(await asBoss(() => SiteUpdateModel.countDocuments())).toBe(1);
    expect(await asStaff(() => updates.list(mine))).toHaveLength(1);
    await expect(asStaff(() => updates.list(other))).rejects.toThrow("Project not found");
  });

  it("a scoped user sees their general task but not one on an unassigned project", async () => {
    await MembershipModel.create([{ orgId: org, userId: staff, role: "site_staff" }, { orgId: org, userId: boss, role: "owner" }]);
    const general = await asStaff(() => tasks.create({ title: "Buy grout", assigneeId: null, dueAt: null, projectId: null, leadId: null }));
    const hidden = await asBoss(() => tasks.create({ title: "Other site", assigneeId: null, dueAt: null, projectId: String(other), leadId: null }));
    const titles = (await asStaff(() => tasks.listMine())).map((t) => t.title);
    expect(titles).toEqual(["Buy grout"]);
    await expect(asStaff(() => tasks.complete(new Types.ObjectId(hidden.id)))).rejects.toThrow("Task not found");
    await expect(asStaff(() => tasks.complete(new Types.ObjectId(general.id)))).resolves.toBeUndefined();
  });

  it("assignee must be an active member of the organization", async () => {
    await expect(asBoss(() => tasks.create({ title: "x", assigneeId: String(newId()), dueAt: null, projectId: null, leadId: null }))).rejects.toThrow("must be a member");
  });

  it("setStage records the time, the audit event, and returns the previous stage", async () => {
    const r = await asBoss(() => projects.setStage(mine, "QUOTING", null));
    expect(r.previous.stage).toBe("SITE_VISIT");
    const p = await asBoss(() => ProjectModel.findById(mine).lean());
    expect(p!.stage).toBe("QUOTING");
    expect(p!.stageEnteredAt.getTime()).toBeGreaterThan(r.previous.stageEnteredAt.getTime());
    expect(await asBoss(() => AuditModel.countDocuments({ action: "project.stage", entityId: mine }))).toBe(1);
  });
});
