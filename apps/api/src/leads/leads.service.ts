import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";
import { composeAddress, hasStructuredAddress, type ConvertLeadInput, type LeadDetailDto, type LeadDto, type LeadInput, type LeadListDto, type LeadStatus } from "@veenix/shared";
import { currentUser } from "../common/context";
import { notFound, rule } from "../common/errors";
import { plain } from "../common/plain";
import { contains } from "../common/regex";
import { tx } from "../common/tx";
import { nextCode } from "../counters/counters";
import { changed } from "../live/live";
import { indexEntry } from "../search/search";
import { LeadModel } from "./lead.model";
import { ProjectModel } from "../projects/project.model";
import { DesignConceptModel } from "../concepts/concept.model";

const PAGE_SIZE = 10; // same as the old leads page
const ADDRESS = ["addressLine1", "addressLine2", "addressLine3", "postcode", "city", "state"] as const;

function indexLead(l: { _id: Types.ObjectId; name: string; code: string; phone: string; city?: string | null }) {
  indexEntry({ kind: "lead", refId: l._id, projectId: null, title: l.name, subtitle: [l.code, l.city].filter(Boolean).join(" · "), keywords: l.phone });
  changed({ kind: "lead", id: String(l._id) });
}

export function indexProject(p: { _id: Types.ObjectId; name: string; code: string; clientName: string; city?: string | null }) {
  indexEntry({ kind: "project", refId: p._id, projectId: p._id, title: p.name, subtitle: [p.code, p.clientName, p.city].filter(Boolean).join(" · ") });
  changed({ kind: "project", projectId: String(p._id) });
}

@Injectable()
export class LeadsService {
  async list(q: { view: "open" | "converted" | "all"; q?: string; source?: string; status?: LeadStatus; page: number }): Promise<LeadListDto> {
    const and: object[] = [];
    if (q.view === "open") and.push({ status: { $ne: "CONVERTED" } });
    if (q.view === "converted") and.push({ status: "CONVERTED" });
    if (q.source) and.push({ source: q.source });
    if (q.status) and.push({ status: q.status });
    if (q.q) and.push({ $or: ["name", "phone", "code", "siteAddress", "city", "state"].map((f) => ({ [f]: contains(q.q!) })) });
    const where = and.length ? { $and: and } : {};

    const [open, converted, all, total] = await Promise.all([
      LeadModel.countDocuments({ status: { $ne: "CONVERTED" } }),
      LeadModel.countDocuments({ status: "CONVERTED" }),
      LeadModel.countDocuments(),
      LeadModel.countDocuments(where),
    ]);
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const page = Math.min(q.page, pages);
    const leads = await LeadModel.find(where).select("-activities").sort({ createdAt: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean();
    const projects = await ProjectModel.find({ leadId: { $in: leads.map((l) => l._id) } }).select("_id leadId").lean();
    return {
      leads: leads.map((l) => {
        const p = projects.find((x) => x.leadId && x.leadId.equals(l._id));
        return { ...plain<LeadDto>(l), project: p ? { id: String(p._id) } : null };
      }),
      counts: { open, converted, all },
      total, page, pages, pageSize: PAGE_SIZE,
    };
  }

  async get(id: Types.ObjectId): Promise<LeadDetailDto> {
    const lead = await LeadModel.findById(id).lean();
    if (!lead) throw notFound("Lead");
    const project = await ProjectModel.findOne({ leadId: id }).select("_id code name").lean();
    return { ...plain<LeadDetailDto>(lead), project: project ? { id: String(project._id), code: project.code, name: project.name } : null };
  }

  async create(input: LeadInput) {
    return tx(async () => {
      const [lead] = await LeadModel.create([{
        ...input,
        status: input.status ?? "NEW",
        siteAddress: composeAddress(input) || null,
        code: await nextCode("L"),
        activities: [{ note: "Lead created", author: "System" }],
      }]);
      indexLead(lead);
      return { id: String(lead._id) };
    });
  }

  async update(id: Types.ObjectId, input: LeadInput) {
    const { status, ...rest } = input;
    const lead = await LeadModel.findOneAndUpdate(
      { _id: id },
      { $set: { ...rest, siteAddress: composeAddress(input) || null, ...(status ? { status } : {}) } },
      { new: true, lean: true },
    );
    if (!lead) throw notFound("Lead");
    indexLead(lead);
  }

  async addActivity(id: Types.ObjectId, input: { note: string; author: string | null }) {
    const u = currentUser();
    const r = await LeadModel.updateOne({ _id: id }, { $push: { activities: { note: input.note, author: input.author ?? u.name, authorId: u.id } } });
    if (r.matchedCount === 0) throw notFound("Lead");
    changed({ kind: "lead", id: String(id) });
  }

  async convert(id: Types.ObjectId, input: ConvertLeadInput) {
    return tx(async () => {
      const lead = await LeadModel.findById(id);
      if (!lead) throw notFound("Lead");
      if (lead.status === "CONVERTED") throw rule("This lead is already converted");

      // A project needs a full site address. If the lead never had one, the convert form sends it and it's saved back onto the lead.
      let address: Record<string, string | null> = Object.fromEntries(ADDRESS.map((k) => [k, lead[k] ?? null]));
      let siteAddress = hasStructuredAddress(lead) ? composeAddress(lead) : (lead.siteAddress ?? "");
      if (input.address) {
        address = { ...input.address };
        siteAddress = composeAddress(input.address);
      } else if (!hasStructuredAddress(lead)) {
        throw rule("Add the site address before converting");
      }

      const [project] = await ProjectModel.create([{
        code: await nextCode("PRJ"),
        name: input.projectName,
        clientName: lead.name,
        clientPhone: lead.phone,
        clientEmail: lead.email,
        ...address,
        siteAddress,
        propertyType: lead.propertyType,
        builtUpArea: lead.builtUpArea,
        budgetMin: lead.budgetMin,
        budgetMax: lead.budgetMax,
        campaign: lead.campaign,
        surveyAt: lead.surveyAt,
        pmName: input.projectOwner ?? lead.assignedTo,
        stage: input.nextStage,
        targetStart: input.targetStart,
        targetHandover: input.targetHandover,
        leadId: lead._id,
      }]);

      await DesignConceptModel.updateMany({ leadId: lead._id }, { $set: { projectId: project._id, leadId: null } });
      lead.set({ ...address, siteAddress, status: "CONVERTED" });
      lead.activities.push({ note: `Converted to project ${project.code}`, author: "System" });
      await lead.save();
      indexLead(lead);
      indexProject(project);
      return { projectId: String(project._id) };
    });
  }
}
