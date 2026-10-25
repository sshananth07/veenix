import { Injectable } from "@nestjs/common";
import {
  addDays, can, daysBetween, formatDate, getAttention, LEAD_SOURCES, LEAD_STATUSES, mytStartOfDay, PRIORITY_ORDER, quotationReadiness, quotationTotals,
  type DashboardDto, type DashboardRowDto, type LeadStatus, type ReportsDto, type Role,
} from "@veenix/shared";
import { ctx, currentUser } from "../common/context";
import { LeadModel } from "../leads/lead.model";
import { loadOrg } from "../orgs/org.model";
import { buildCores } from "../projects/core";
import { ProjectModel } from "../projects/project.model";
import { PurchaseOrderModel } from "../procurement/purchase-order.model";
import { QuotationModel } from "../quotations/quotation.model";
import { VendorModel } from "../vendors/vendor.model";

const DAY = 86_400_000;
const place = (x: { city?: string | null; state?: string | null; siteAddress?: string | null }) => [x.city, x.state].filter(Boolean).join(", ") || x.siteAddress || null;

@Injectable()
export class DashboardService {
  /** Ports the data half of the old Home page. */
  async dashboard(): Promise<DashboardDto> {
    const now = new Date();
    const week = addDays(now, -7);
    const month = addDays(now, -30);
    const today = mytStartOfDay(now);

    // ponytail: reads every open lead and active project per request; fine up to a few hundred each. Move to counting aggregations when an organization outgrows that.
    const [leads, projects, completedProjects, signedRecently, org] = await Promise.all([
      can(ctx().role as Role, "lead:read") ? LeadModel.find().select("-activities").sort({ createdAt: -1 }).lean() : Promise.resolve([]),
      ProjectModel.find({ stage: { $nin: ["COMPLETED", "CANCELLED"] } }).lean(),
      ProjectModel.countDocuments({ stage: "COMPLETED" }),
      QuotationModel.find({ status: "ACCEPTED", acceptedAt: { $gte: month } }).select("lineItems").lean(),
      loadOrg(),
    ]);
    const { cores } = await buildCores(projects);

    const openLeads = leads.filter((l) => l.status !== "CONVERTED");
    const contractValue = projects.reduce((s, p) => s + p.contractValue, 0);
    const collected = projects.reduce((s, p) => s + p.milestones.filter((m) => m.status === "PAID").reduce((a, m) => a + m.amount, 0), 0);

    // Everything waiting on someone, across every active project and open lead.
    const rows: DashboardRowDto[] = [];
    for (const core of cores) {
      for (const a of getAttention(core, quotationReadiness(core.workItems, core.bomItems))) {
        rows.push({
          key: `${core.id}-${a.title}-${rows.length}`, priority: a.priority, name: core.name, sub: core.code, place: place(core),
          title: a.title, text: a.text, status: a.status, target: { kind: "project", id: core.id, tab: a.tab },
        });
      }
    }
    for (const l of openLeads) {
      const id = String(l._id);
      const base = { name: l.name, sub: l.code, place: place(l), target: { kind: "lead" as const, id } };
      if (l.status === "NEW") {
        rows.push({ ...base, key: `lead-new-${id}`, priority: "medium", title: "New lead to contact", text: `Enquiry from ${l.source}. Contact them to qualify the job.`, status: "New" });
      }
      if (l.surveyAt && l.status !== "LOST") {
        if (l.surveyAt < today) {
          rows.push({ ...base, key: `lead-survey-${id}`, priority: "high", title: "Site survey date has passed", text: `The survey was on ${formatDate(l.surveyAt)}. Log the outcome or move the lead on.`, status: "Overdue" });
        } else if (l.surveyAt.getTime() - today.getTime() <= 3 * DAY) {
          rows.push({ ...base, key: `lead-survey-${id}`, priority: "low", title: "Site survey coming up", text: `Survey scheduled for ${formatDate(l.surveyAt)}.`, status: "Scheduled" });
        }
      }
    }
    rows.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);

    const leadCounts = Object.fromEntries(LEAD_STATUSES.map((s) => [s, leads.filter((l) => l.status === s).length])) as Record<LeadStatus, number>;
    return {
      userName: currentUser().name,
      kpis: {
        openLeads: openLeads.length,
        newLeads7d: leads.filter((l) => l.createdAt >= week).length,
        activeProjects: projects.length,
        newProjects7d: projects.filter((p) => p.createdAt >= week).length,
        contractValue,
        signedLast30d: signedRecently.reduce((s, q) => s + quotationTotals(q.lineItems, org.sstBps).total, 0),
        collected,
        collectedPct: contractValue > 0 ? Math.round((collected / contractValue) * 100) : 0,
        quotedLeads: leadCounts.QUOTED,
        completedProjects,
      },
      leadCounts,
      rows: rows.slice(0, 8),
      rowsTotal: rows.length,
    };
  }

  /** Ports the old reports page's numbers. */
  async reports(): Promise<ReportsDto> {
    const [leads, projects, vendors, pos, org] = await Promise.all([
      LeadModel.find().select("status source createdAt").lean(),
      ProjectModel.find().select("name contractValue leadId").lean(),
      VendorModel.find().select("name").lean(),
      PurchaseOrderModel.find().select("vendorId amount status").lean(),
      loadOrg(),
    ]);
    const signed = await QuotationModel.find({ projectId: { $in: projects.map((p) => p._id) }, status: "ACCEPTED" }).select("projectId acceptedAt lineItems").lean();
    const signedByProject = new Map(signed.map((q) => [String(q.projectId), q]));
    const leadById = new Map(leads.map((l) => [String(l._id), l]));

    const converted = leads.filter((l) => l.status === "CONVERTED").length;
    const lost = leads.filter((l) => l.status === "LOST").length;
    const decided = converted + lost;

    const signedProjects = projects.filter((p) => signedByProject.has(String(p._id)));
    const dealSizes = signedProjects.map((p) => p.contractValue).filter((v) => v > 0);
    const daysToSign = signedProjects
      .map((p) => {
        const lead = p.leadId ? leadById.get(String(p.leadId)) : undefined;
        const acceptedAt = signedByProject.get(String(p._id))!.acceptedAt;
        return lead && acceptedAt ? daysBetween(lead.createdAt, acceptedAt) : null;
      })
      .filter((d): d is number => d != null && d >= 0);

    const sources = LEAD_SOURCES.map((source) => {
      const inSource = leads.filter((l) => l.source === source);
      const won = inSource.filter((l) => l.status === "CONVERTED").length;
      return { source, count: inSource.length, won, pct: inSource.length > 0 ? Math.round((won / inSource.length) * 100) : 0 };
    })
      .filter((s) => s.count > 0)
      .sort((a, b) => b.count - a.count);

    const margins = signedProjects
      .map((p) => {
        const totals = quotationTotals(signedByProject.get(String(p._id))!.lineItems, org.sstBps);
        return { id: String(p._id), name: p.name, cost: totals.cost, contract: totals.total, profit: totals.profit, marginPct: totals.marginPct };
      })
      .sort((a, b) => b.contract - a.contract)
      .slice(0, 8);

    const vendorSpend = vendors
      .map((v) => {
        const mine = pos.filter((po) => po.vendorId.equals(v._id));
        return {
          id: String(v._id), name: v.name, jobs: mine.length,
          committed: mine.reduce((s, po) => s + po.amount, 0),
          paid: mine.reduce((s, po) => s + (po.status === "PAID" ? po.amount : 0), 0),
        };
      })
      .filter((v) => v.committed > 0)
      .sort((a, b) => b.committed - a.committed)
      .slice(0, 8);

    return {
      leads: {
        total: leads.length, converted, lost,
        convertedPct: leads.length > 0 ? Math.round((converted / leads.length) * 100) : 0,
        winRatePct: decided > 0 ? Math.round((converted / decided) * 100) : 0,
      },
      deals: {
        signedCount: dealSizes.length,
        avgDeal: dealSizes.length > 0 ? Math.round(dealSizes.reduce((s, v) => s + v, 0) / dealSizes.length) : 0,
        avgDaysToSign: daysToSign.length > 0 ? Math.round(daysToSign.reduce((s, d) => s + d, 0) / daysToSign.length) : null,
        daysToSignCount: daysToSign.length,
      },
      sources,
      margins,
      vendorSpend,
    };
  }
}
