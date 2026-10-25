import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";
import { bomCosts, composeAddress, getAttention, quotationReadiness, type ProjectDetailDto, type ProjectListItemDto, type ProjectUpdateInput } from "@veenix/shared";
import { notFound, rule } from "../common/errors";
import { plain } from "../common/plain";
import { afterCommit, tx } from "../common/tx";
import { claim, removeObject } from "../storage/storage";
import { MembershipModel } from "../orgs/membership.model";
import { ctx } from "../common/context";
import { indexProject } from "../leads/leads.service";
import { PurchaseOrderModel } from "../procurement/purchase-order.model";
import { ProjectModel, loadProject } from "./project.model";
import { buildCores } from "./core";

@Injectable()
export class ProjectsService {
  async list(): Promise<ProjectListItemDto[]> {
    const projects = await ProjectModel.find().select("-workItems -bomItems").sort({ createdAt: -1 }).lean();
    const pos = await PurchaseOrderModel.find({ projectId: { $in: projects.map((p) => p._id) } }).select("-milestones").lean();
    return projects.map((p) => {
      const d = plain<ProjectListItemDto>(p);
      return { ...d, milestones: d.milestones.map((m) => ({ ...m, projectId: d.id })), purchaseOrders: pos.filter((po) => po.projectId.equals(p._id)).map((po) => plain(po)) } as ProjectListItemDto;
    });
  }

  async detail(id: Types.ObjectId): Promise<ProjectDetailDto> {
    const p = await ProjectModel.findById(id).lean();
    if (!p) throw notFound("Project");
    const { cores: [core], org } = await buildCores([p]);
    const readiness = quotationReadiness(core.workItems, core.bomItems);
    return {
      ...core,
      costs: bomCosts(core.bomItems),
      readiness,
      attention: getAttention(core, readiness),
      pricing: { defaultMarkupPct: org.defaultMarkupPct, minMarkupPct: org.minMarkupPct, sstBps: org.sstBps },
    };
  }

  /** Ports actions/projects.ts updateProject. */
  async update(id: Types.ObjectId, input: ProjectUpdateInput) {
    await tx(async () => {
      const project = await loadProject(id);
      const oldPhoto = project.photoPath;
      const { photo, ...fields } = input;
      if (photo === "remove") project.photoPath = null;
      else if (photo) project.photoPath = (await claim(photo, "photos")).path;
      if (fields.stage !== project.stage) project.stageEnteredAt = new Date();
      project.set({
        ...fields,
        siteAddress: composeAddress(fields),
        cancelReason: fields.stage === "CANCELLED" ? fields.cancelReason : null,
      });
      await project.save();
      if (oldPhoto && oldPhoto !== project.photoPath) afterCommit(() => removeObject(oldPhoto));
      indexProject(project);
    });
  }

  /** Who the project is assigned to. Each person must be an active member holding that same role. */
  async setAssignees(id: Types.ObjectId, input: { assignees: { userId: string; role: "project_manager" | "site_staff" }[] }) {
    const members = await MembershipModel.find({ orgId: ctx().orgId, status: "active", userId: { $in: input.assignees.map((a) => new Types.ObjectId(a.userId)) } }).lean();
    for (const a of input.assignees) {
      const m = members.find((x) => String(x.userId) === a.userId);
      if (!m) throw rule("Everyone assigned must be a member of this organization");
      if (m.role !== a.role) throw rule(`That person's role is ${m.role.replace("_", " ")}, not ${a.role.replace("_", " ")}`);
    }
    const project = await loadProject(id);
    project.set("assignees", input.assignees.map((a) => ({ userId: new Types.ObjectId(a.userId), role: a.role })));
    await project.save();
    indexProject(project);
  }
}
