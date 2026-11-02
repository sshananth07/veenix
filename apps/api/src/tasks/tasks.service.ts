import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";
import { can, type Role, type TaskDto, type TaskInput } from "@veenix/shared";
import { audit } from "../audit/audit";
import { ctx } from "../common/context";
import { forbidden, notFound, rule } from "../common/errors";
import { tx } from "../common/tx";
import { changed } from "../live/live";
import { LeadModel } from "../leads/lead.model";
import { MembershipModel } from "../orgs/membership.model";
import { loadProject, ProjectModel } from "../projects/project.model";
import { UserModel } from "../users/user.model";
import { TaskModel } from "./task.model";

/** What a user may see: everything, or for project-scoped roles their own tasks plus tasks on their projects. */
export function taskScope(): object {
  const c = ctx();
  if (c.projectScope === "all") return {};
  return { $or: [{ assigneeId: c.userId }, { createdBy: c.userId }, { projectId: { $in: c.projectScope } }] };
}

async function loadTask(id: Types.ObjectId) {
  const t = await TaskModel.findOne({ _id: id, ...taskScope() });
  if (!t) throw notFound("Task");
  return t;
}

@Injectable()
export class TasksService {
  async create(input: TaskInput, source?: { messageId: Types.ObjectId }): Promise<{ id: string }> {
    return tx(async () => {
      const c = ctx();
      if (input.assigneeId && !(await MembershipModel.exists({ orgId: c.orgId, userId: new Types.ObjectId(input.assigneeId), status: "active" }))) {
        throw rule("The assignee must be a member of this organization");
      }
      if (input.projectId) await loadProject(input.projectId); // 404 outside scope
      if (input.leadId) {
        if (!can(c.role as Role, "lead:read")) throw forbidden();
        if (!(await LeadModel.exists({ _id: input.leadId }))) throw notFound("Lead");
      }
      const [t] = await TaskModel.create([{ ...input, createdBy: c.userId, messageId: source?.messageId ?? null }]);
      await audit("task.create", "task", t._id, { messageId: source?.messageId }, t.projectId ?? undefined);
      if (t.projectId) changed({ kind: "project", projectId: String(t.projectId) });
      return { id: String(t._id) };
    });
  }

  async complete(id: Types.ObjectId) {
    await tx(async () => {
      const t = await loadTask(id);
      t.set({ status: "done", doneAt: new Date() });
      await t.save();
      await audit("task.complete", "task", t._id, undefined, t.projectId ?? undefined);
      if (t.projectId) changed({ kind: "project", projectId: String(t.projectId) });
    });
  }

  async remove(id: Types.ObjectId) {
    await tx(async () => {
      const t = await loadTask(id);
      await TaskModel.deleteOne({ _id: t._id });
      await audit("task.remove", "task", t._id, undefined, t.projectId ?? undefined);
      if (t.projectId) changed({ kind: "project", projectId: String(t.projectId) });
    });
  }

  /** Open tasks assigned to me, or created by me with no assignee; then the last 20 done. */
  async listMine(): Promise<TaskDto[]> {
    const me = ctx().userId;
    const mine = { $or: [{ assigneeId: me }, { createdBy: me, assigneeId: null }] };
    const [open, done] = await Promise.all([
      TaskModel.find({ ...mine, status: "open" }).sort({ dueAt: 1, createdAt: 1 }).limit(200).lean(),
      TaskModel.find({ ...mine, status: "done" }).sort({ doneAt: -1 }).limit(20).lean(),
    ]);
    return toDtos([...open, ...done]);
  }

  async listForProject(projectId: Types.ObjectId): Promise<TaskDto[]> {
    await loadProject(projectId);
    return toDtos(await TaskModel.find({ projectId, ...taskScope() }).sort({ status: -1, dueAt: 1 }).limit(200).lean());
  }
}

type Lean = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function toDtos(rows: Lean[]): Promise<TaskDto[]> {
  const [users, projects] = await Promise.all([
    UserModel.find({ _id: { $in: rows.map((r) => r.assigneeId).filter(Boolean) } }).select("name").lean(),
    ProjectModel.find({ _id: { $in: rows.map((r) => r.projectId).filter(Boolean) } }).select("name").lean(),
  ]);
  const name = (list: { _id: Types.ObjectId; name: string }[], id: Types.ObjectId | null) => (id ? list.find((x) => x._id.equals(id))?.name ?? null : null);
  return rows.map((r) => ({
    id: String(r._id), title: r.title, status: r.status, dueAt: r.dueAt, assigneeId: r.assigneeId ? String(r.assigneeId) : null,
    assigneeName: name(users, r.assigneeId), projectId: r.projectId ? String(r.projectId) : null, projectName: name(projects, r.projectId),
    leadId: r.leadId ? String(r.leadId) : null, fromAssistant: !!r.messageId, createdAt: r.createdAt,
  }));
}
