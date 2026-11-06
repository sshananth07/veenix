import { Injectable } from "@nestjs/common";
import mongoose, { Types } from "mongoose";
import { can, fitRoom, upgradeRoom, type ConceptDto, type ConceptPatchInput, type Role } from "@veenix/shared";
import { ctx } from "../common/context";
import { notFound, rule } from "../common/errors";
import { tx } from "../common/tx";
import { OVER_CAP, overSpendCap } from "../assistant/limits";
import { enqueue } from "../jobs/jobs";
import { LeadModel } from "../leads/lead.model";
import { loadProject } from "../projects/project.model";
import { downloadUrl } from "../storage/storage";
import { DesignConceptModel, type DesignConcept } from "./concept.model";

export const DAILY_CONCEPTS = 20; // per organisation, in any 24 hours; failures don't count (spec §7)

const canReadLeads = () => can(ctx().role as Role, "lead:read");

/** Saves a concept and its job, inside the caller's transaction. No OpenAI call happens here. */
export async function startConcept(
  input: { projectId: Types.ObjectId | null; leadId: Types.ObjectId | null; brief: string; layout?: string | null; sourceKey: string; extraKeys?: string[] },
  conversationId: Types.ObjectId,
) {
  if (!input.projectId === !input.leadId) throw rule("Say which project or lead this is for.");
  if (input.projectId) await loadProject(input.projectId); // 404 outside scope
  else if (!canReadLeads() || !(await LeadModel.exists({ _id: input.leadId }))) throw notFound("Lead");

  // Counted org-wide with the raw driver: the tenant plugin would count only a scoped member's own projects.
  // ponytail: two requests at the same moment can both pass at 19; add a Redis counter if that ever matters.
  const used = await mongoose.connection.collection("design_concepts").countDocuments({
    orgId: ctx().orgId, status: { $ne: "failed" }, createdAt: { $gt: new Date(Date.now() - 86_400_000) },
  });
  if (used >= DAILY_CONCEPTS) throw rule(`Your organisation has made ${DAILY_CONCEPTS} room concepts in the last 24 hours. Try again later.`);

  const [concept] = await DesignConceptModel.create([{ ...input, name: input.brief.slice(0, 60), conversationId, createdBy: ctx().userId }]);
  await enqueue("concept.generate", { conceptId: String(concept._id), userId: String(ctx().userId) });
  return concept;
}

export async function toDto(c: DesignConcept): Promise<ConceptDto> {
  return {
    id: String(c._id), name: c.name, brief: c.brief, status: c.status as ConceptDto["status"], error: c.error ?? null,
    projectId: c.projectId ? String(c.projectId) : null, leadId: c.leadId ? String(c.leadId) : null,
    photoUrl: await downloadUrl(c.sourceKey, "photo"),
    imageUrl: c.imageKey ? await downloadUrl(c.imageKey, `${c.name}.jpg`) : null,
    room: upgradeRoom(c.room), saved: c.saved, createdAt: c.createdAt,
    renderStatus: (c.renderStatus ?? "none") as ConceptDto["renderStatus"],
    renderUrl: c.renderKey && c.renderStatus === "ready" ? await downloadUrl(c.renderKey, `${c.name} render.webp`) : null,
  };
}

@Injectable()
export class ConceptsService {
  /** Saved concepts on a project or lead, newest first. */
  async list(ref: { projectId: Types.ObjectId } | { leadId: Types.ObjectId }): Promise<ConceptDto[]> {
    if ("leadId" in ref && !canReadLeads()) return [];
    const rows = await DesignConceptModel.find({ ...ref, saved: true }).sort({ _id: -1 }).lean();
    return Promise.all(rows.map((c) => toDto(c as DesignConcept)));
  }

  async get(id: Types.ObjectId) {
    return toDto(await this.load(id));
  }

  async update(id: Types.ObjectId, patch: ConceptPatchInput) {
    await this.load(id);
    await DesignConceptModel.updateOne({ _id: id }, { $set: { ...patch, ...(patch.room ? { room: fitRoom(patch.room) } : {}) } });
    return this.get(id);
  }

  /** Starts the presentation render once per concept; a failed one can be tried again. */
  async render(id: Types.ObjectId) {
    const c = await this.load(id);
    if (c.status !== "ready") throw rule("The concept isn't ready yet.");
    if (c.renderStatus === "generating" || c.renderStatus === "ready") return toDto(c);
    if (await overSpendCap(String(ctx().orgId))) throw rule(OVER_CAP);
    await tx(async () => {
      const r = await DesignConceptModel.updateOne({ _id: id, renderStatus: { $nin: ["generating", "ready"] } }, { $set: { renderStatus: "generating" } });
      if (r.modifiedCount) await enqueue("concept.render", { conceptId: String(id), userId: String(ctx().userId) });
    });
    return this.get(id);
  }

  /** Project scope comes from the tenant plugin; a lead's concept also needs lead:read. */
  private async load(id: Types.ObjectId) {
    const c = await DesignConceptModel.findById(id).lean();
    if (!c || (c.leadId && !canReadLeads())) throw notFound("Concept");
    return c as DesignConcept;
  }
}
