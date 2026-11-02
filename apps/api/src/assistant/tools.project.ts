import { Types } from "mongoose";
import { z } from "zod";
import { ASSIGNABLE_ROLES, getPackages, PROJECT_STAGES, SITE_UPDATE_KINDS, siteUpdateInput, taskInput, type ProjectStage } from "@veenix/shared";
import { audit } from "../audit/audit";
import { rule } from "../common/errors";
import { loadProject } from "../projects/project.model";
import { ProjectsService } from "../projects/projects.service";
import { UserModel } from "../users/user.model";
import { defineApprovalAction } from "./pending";
import { search } from "../search/search";
import { TaskModel } from "../tasks/task.model";
import { TasksService } from "../tasks/tasks.service";
import { UpdatesService } from "../updates/updates.service";
import { defineTool } from "./tools";

const projects = new ProjectsService();
const updates = new UpdatesService();
const tasks = new TasksService();

const id = z.string().regex(/^[a-f\d]{24}$/i, "Use an id from a tool result");
const json = (v: unknown) => JSON.stringify(v);

defineTool({
  name: "search_records",
  description: "Find projects, leads, vendors, quotations, POs and invoices by name, code, client or address. Use it to get ids before other tools.",
  input: z.strictObject({ query: z.string().trim().min(1).max(200) }),
  permission: null,
  level: "read",
  run: async ({ query }) => ({ content: json(await search(query)) }),
});

defineTool({
  name: "get_project",
  description: "A project's name, code, stage, client, work items, procurement packages and assigned staff.",
  input: z.strictObject({ projectId: id }),
  permission: "project:read",
  level: "read",
  run: async ({ projectId }) => {
    const p = await projects.detail(new Types.ObjectId(projectId));
    return {
      content: json({
        id: p.id, name: p.name, code: p.code, stage: p.stage, clientName: p.clientName, siteAddress: p.siteAddress,
        workItems: p.workItems.map((w) => w.name),
        packages: getPackages(p).map((k) => ({ item: k.bom.workPackage, description: k.bom.description, stage: k.stage })),
        assignees: p.assignees.map((a) => ({ userId: a.userId, name: a.name, role: a.role })),
      }),
    };
  },
});

defineTool({
  name: "list_my_tasks",
  description: "The user's open tasks and recently completed ones.",
  input: z.strictObject({}),
  permission: null,
  level: "read",
  run: async () => ({ content: json(await tasks.listMine()) }),
});

defineTool({
  name: "add_project_update",
  description: "Record what happened on site: progress, an issue, a material request or a delivery. Set attachPhotos to attach the photos sent with this message.",
  input: z.strictObject({ projectId: id, kind: z.enum(SITE_UPDATE_KINDS), text: z.string().trim().min(1).max(4000), attachPhotos: z.boolean() }),
  permission: "update:write",
  level: "apply",
  run: async ({ projectId, kind, text, attachPhotos }, c) => {
    const photos = attachPhotos ? c.attachments.filter((a) => a.kind === "photo").map(({ key, name }) => ({ key, name })) : [];
    const { id: updateId } = await updates.add(siteUpdateInput.parse({ projectId, kind, text, photos }), { messageId: c.messageId });
    return { content: `Added a ${kind.replace("_", " ")} update${photos.length ? ` with ${photos.length} photo(s)` : ""}.`, undo: { updateId } };
  },
  undo: async (data) => updates.remove(new Types.ObjectId((data as { updateId: string }).updateId)),
});

defineTool({
  name: "create_task",
  description: "Create a task or follow-up, optionally assigned to a member, due at a time, and linked to a project or lead.",
  input: z.strictObject({
    title: z.string().trim().min(1).max(200),
    assigneeId: id.nullable(),
    dueAt: z.iso.datetime({ offset: true }).nullable(),
    projectId: id.nullable(),
    leadId: id.nullable(),
  }),
  permission: "task:write",
  level: "apply",
  run: async (input, c) => {
    const { id: taskId } = await tasks.create(taskInput.parse(input), { messageId: c.messageId });
    return { content: `Created the task "${input.title}".`, undo: { taskId } };
  },
  undo: async (data) => {
    const taskId = new Types.ObjectId((data as { taskId: string }).taskId);
    if (await TaskModel.exists({ _id: taskId, status: "done" })) throw rule("This has changed since. Open it in Veenix.");
    await tasks.remove(taskId);
  },
});

defineTool({
  name: "set_project_stage",
  description: "Move a project to another stage. Cancelling needs a reason.",
  input: z.strictObject({ projectId: id, stage: z.enum(PROJECT_STAGES), cancelReason: z.string().trim().min(1).max(500).nullable() }),
  permission: "project:write",
  level: "apply",
  run: async ({ projectId, stage, cancelReason }) => {
    const { previous } = await projects.setStage(new Types.ObjectId(projectId), stage, cancelReason);
    return { content: `Moved the project from ${previous.stage} to ${stage}.`, undo: { projectId, stage, previous } };
  },
  undo: async (data) => {
    const d = data as { projectId: string; stage: ProjectStage; previous: { stage: ProjectStage; cancelReason: string | null; stageEnteredAt: Date } };
    await projects.restoreStage(new Types.ObjectId(d.projectId), d.stage, d.previous);
  },
});

defineTool({
  name: "report_unsupported_request",
  description: "Call this when no tool can do what the user asked, with their request in a sentence.",
  input: z.strictObject({ request: z.string().trim().min(1).max(500) }),
  permission: null,
  level: "read",
  run: async ({ request }, c) => {
    await audit("assistant.unsupported_request", "conversation", c.conversationId, { request });
    return { content: "Noted. Tell the user this isn't available yet." };
  },
});

// ---- Action catalogue: approval cards around existing service methods ----

const assignInput = z.strictObject({ projectId: id, assignees: z.array(z.strictObject({ userId: id, role: z.enum(ASSIGNABLE_ROLES) })).max(50) });

defineApprovalAction({
  name: "assign_project_staff",
  description: "Set who is assigned to a project (project managers and site staff). Give the full new list.",
  input: assignInput,
  permission: "project:assign",
  validate: async ({ projectId, assignees }) => {
    const project = await loadProject(projectId);
    const ids = [...project.assignees.map((a) => a.userId), ...assignees.map((a) => new Types.ObjectId(a.userId))];
    const users = await UserModel.find({ _id: { $in: ids } }).select("name").lean();
    const who = (list: { userId: Types.ObjectId | string; role: string }[]) =>
      list.map((a) => `${users.find((u) => u._id.equals(a.userId))?.name || "Unknown member"} (${a.role.replace("_", " ")})`).join(", ") || "Nobody";
    return {
      title: `Assign staff to ${project.name}`,
      lines: [{ label: "Project", value: `${project.name} (${project.code})` }],
      changes: [{ label: "Assigned", before: who(project.assignees), after: who(assignees) }],
      missing: [],
      link: `/projects/${projectId}`,
    };
  },
  apply: async ({ projectId, assignees }) => {
    await projects.setAssignees(new Types.ObjectId(projectId), { assignees });
    return { assigned: assignees.length };
  },
});
