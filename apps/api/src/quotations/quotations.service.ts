import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";
import { OPEN_QUOTATION_STATUSES, quotationTotals, withMarkup, type QuotationStatus } from "@veenix/shared";
import { ctx } from "../common/context";
import { findSub } from "../common/fields";
import { notFound, rule } from "../common/errors";
import { tx } from "../common/tx";
import { enqueue } from "../jobs/jobs";
import { audit } from "../audit/audit";
import { changed } from "../live/live";
import { indexEntry } from "../search/search";
import { applySchedule } from "../billing/schedule";
import { loadOrg } from "../orgs/org.model";
import { loadProject } from "../projects/project.model";
import { QuotationModel, type QuotationDoc } from "./quotation.model";
import { createDraft, readinessError, readinessOf } from "./draft";

type Id = Types.ObjectId;
const isOpen = (s: string) => OPEN_QUOTATION_STATUSES.includes(s as QuotationStatus);

async function loadQuotation(id: Id) {
  const q = await QuotationModel.findById(id);
  if (!q) throw notFound("Quotation");
  return q;
}

function event(q: QuotationDoc, type: string, note: string | null = null) {
  q.events.push({ type, note, actorId: ctx().userId });
}

async function saved(q: QuotationDoc, projectName?: string) {
  await q.save();
  indexEntry({ kind: "quotation", refId: q._id, projectId: q.projectId, title: q.code, subtitle: projectName ?? `Rev ${q.revision}` });
  changed({ kind: "project", projectId: String(q.projectId) });
}

@Injectable()
export class QuotationsService {
  async build(projectId: Id, input: { markupPct: number }) {
    return tx(async () => {
      if (await QuotationModel.exists({ projectId })) throw rule("This project already has a quotation. Create a new version from it instead.");
      const project = await loadProject(projectId);
      const readiness = readinessOf(project);
      if (!readiness.ready) throw rule(readinessError(readiness.blockers));
      const q = await createDraft(project, null, input.markupPct);
      await saved(q, project.name);
      return { id: String(q._id) };
    });
  }

  async revise(fromId: Id) {
    return tx(async () => {
      const from = await loadQuotation(fromId);
      const others = await QuotationModel.find({ projectId: from.projectId }).select("status").lean();
      if (others.some((q) => q.status === "ACCEPTED")) throw rule("The quotation is signed. Further changes go through Variation Orders.");
      if (others.some((q) => q.status === "DRAFT")) throw rule("Finish or discard the current draft first.");
      const project = await loadProject(from.projectId);
      const q = await createDraft(project, from);
      await saved(q, project.name);
      return { id: String(q._id) };
    });
  }

  async discard(id: Id) {
    const q = await loadQuotation(id);
    if (q.status !== "DRAFT") throw rule("Only a draft can be discarded");
    await QuotationModel.deleteOne({ _id: id });
    changed({ kind: "project", projectId: String(q.projectId) });
  }

  private async draftForEdit(id: Id) {
    const q = await loadQuotation(id);
    if (q.status !== "DRAFT") throw rule("Only a draft can be edited. Create a new version to change prices.");
    return q;
  }

  async setLineMarkup(lineId: Id, input: { markupPct: number }) {
    const owner = await QuotationModel.findOne({ "lineItems._id": lineId }).select("_id").lean();
    if (!owner) throw notFound("Quotation line");
    const q = await this.draftForEdit(owner._id);
    const line = findSub(q.lineItems, lineId)!;
    line.set({ markupPct: input.markupPct, clientPrice: withMarkup(line.bomCost, input.markupPct) });
    await saved(q);
  }

  async applyMarkup(id: Id, input: { markupPct: number }) {
    const q = await this.draftForEdit(id);
    for (const line of q.lineItems) line.set({ markupPct: input.markupPct, clientPrice: withMarkup(line.bomCost, input.markupPct) });
    await saved(q);
  }

  /** Replaces the client payment terms on a draft. Amounts aren't stored; they're the term's share of the total. */
  async setTerms(id: Id, input: { terms: { name: string; trigger: string; pct: number }[] }) {
    const q = await loadQuotation(id);
    if (q.status !== "DRAFT") throw rule("Payment terms can only be changed on a draft. Create a new version to change them.");
    q.set("terms", input.terms.map((t, i) => ({ seq: i + 1, ...t })));
    await saved(q);
  }

  async send(id: Id) {
    await tx(async () => {
      const q = await loadQuotation(id);
      if (q.status !== "DRAFT") throw rule("Only a draft can be sent");
      if (q.lineItems.length === 0) throw rule("There are no priced lines to send");
      if (q.terms.reduce((s, t) => s + t.pct, 0) !== 100) throw rule("Set the payment terms first. They must add up to 100% of the contract sum.");
      const project = await loadProject(q.projectId);
      const readiness = readinessOf(project);
      if (!readiness.ready) throw rule(readinessError(readiness.blockers));

      await QuotationModel.updateMany({ projectId: q.projectId, status: { $in: OPEN_QUOTATION_STATUSES } }, { $set: { status: "SUPERSEDED" } });
      q.set({ status: "SENT", sentAt: new Date() });
      event(q, "SENT");
      await saved(q, project.name);
      await audit("quotation.sent", "quotation", q._id, { revision: q.revision }, q.projectId);
      await enqueue("document.snapshot", { type: "quotation", id: String(q._id) });
    });
  }

  private async openForClient(id: Id) {
    const q = await loadQuotation(id);
    if (!isOpen(q.status)) throw rule("This version is not awaiting a client response");
    return q;
  }

  async viewed(id: Id) {
    const q = await this.openForClient(id);
    q.set({ status: "VIEWED", viewedAt: q.viewedAt ?? new Date() });
    event(q, "VIEWED");
    await saved(q);
  }

  /** The client asked something (a call, WhatsApp, a site visit). The version waits for our reply. */
  async question(id: Id, input: { comment: string }) {
    const q = await this.openForClient(id);
    q.set({ status: "QUESTIONED", viewedAt: q.viewedAt ?? new Date() });
    event(q, "QUESTIONED", input.comment);
    await saved(q);
  }

  async reply(id: Id, input: { reply: string }) {
    const q = await loadQuotation(id);
    if (q.status !== "QUESTIONED") throw rule("There is no open client question to reply to");
    q.set({ status: "VIEWED" });
    event(q, "REPLIED", input.reply);
    await saved(q);
  }

  /** Client signed: one transaction drops drafts, supersedes other open versions, sets the contract value and creates the schedule. */
  async accept(id: Id, input: { signedBy: string | null }) {
    await tx(async () => {
      const q = await this.openForClient(id);
      const project = await loadProject(q.projectId);
      const signedBy = input.signedBy ?? project.clientName;
      const total = quotationTotals(q.lineItems, (await loadOrg()).sstBps).total;

      await QuotationModel.deleteMany({ projectId: q.projectId, status: "DRAFT" });
      await QuotationModel.updateMany({ projectId: q.projectId, _id: { $ne: q._id }, status: { $in: OPEN_QUOTATION_STATUSES } }, { $set: { status: "SUPERSEDED" } });
      q.set({ status: "ACCEPTED", acceptedAt: new Date(), signedBy });
      event(q, "ACCEPTED", `Signed by ${signedBy}`);
      await saved(q, project.name);

      project.contractValue = total;
      // The client's payment schedule follows the terms they just signed.
      if (project.milestones.length === 0 && q.terms.length > 0) applySchedule(project, q.terms, total);
      await project.save();
      await audit("quotation.accepted", "quotation", q._id, { total, signedBy }, q.projectId);
    });
  }
}
