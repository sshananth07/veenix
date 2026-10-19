"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { createDraftQuotation, getQuotationReadiness } from "@/lib/bom";
import { quotationTotals } from "@/lib/quotation";
import { parseTermRows } from "@/lib/paymentTerms";
import { createScheduleFromTerms } from "@/lib/schedule";
import { fail, num, ok, str, type ActionResult } from "@/lib/actionResult";

const OPEN_STATUSES = ["SENT", "VIEWED", "QUESTIONED"];

function readinessError(blockers: { message: string }[]) {
  return `Not ready to quote yet: ${blockers[0].message}${blockers.length > 1 ? ` (+${blockers.length - 1} more)` : ""}`;
}

export async function buildQuotation(projectId: string, formData: FormData): Promise<ActionResult> {
  const existing = await prisma.quotation.count({ where: { projectId } });
  if (existing > 0) return fail("This project already has a quotation. Create a new version from it instead.");

  const readiness = await getQuotationReadiness(projectId);
  if (!readiness.ready) return fail(readinessError(readiness.blockers));

  const markupPct = num(formData, "markupPct");
  if (markupPct == null || markupPct < 0) return fail("Enter a markup of 0% or more");

  await createDraftQuotation(projectId, undefined, Math.round(markupPct));

  revalidatePath(`/projects/${projectId}`);
  return ok();
}

export async function createRevision(fromQuotationId: string): Promise<ActionResult> {
  const from = await prisma.quotation.findUniqueOrThrow({ where: { id: fromQuotationId } });
  const others = await prisma.quotation.findMany({ where: { projectId: from.projectId } });
  if (others.some((q) => q.status === "ACCEPTED")) return fail("The quotation is signed. Further changes go through Variation Orders.");
  if (others.some((q) => q.status === "DRAFT")) return fail("Finish or discard the current draft first.");

  await createDraftQuotation(from.projectId, fromQuotationId);
  revalidatePath(`/projects/${from.projectId}`);
  return ok();
}

export async function discardDraft(quotationId: string): Promise<ActionResult> {
  const q = await prisma.quotation.findUniqueOrThrow({ where: { id: quotationId } });
  if (q.status !== "DRAFT") return fail("Only a draft can be discarded");

  await prisma.quotation.delete({ where: { id: quotationId } });
  revalidatePath(`/projects/${q.projectId}`);
  return ok();
}

export async function updateLineMarkup(lineId: string, formData: FormData): Promise<ActionResult> {
  const markupPct = num(formData, "markupPct");
  if (markupPct == null || markupPct < 0 || markupPct > 500) return fail("Enter a markup between 0% and 500%");

  const line = await prisma.quotationLineItem.findUniqueOrThrow({ where: { id: lineId }, include: { quotation: true } });
  if (line.quotation.status !== "DRAFT") return fail("Only a draft can be edited. Create a new version to change prices.");

  await prisma.quotationLineItem.update({
    where: { id: lineId },
    data: { markupPct: Math.round(markupPct), clientPrice: Math.round(line.bomCost * (1 + markupPct / 100)) },
  });
  revalidatePath(`/projects/${line.quotation.projectId}`);
  return ok();
}

// Replaces the client payment terms on a draft. Amounts are not stored: they
// are always the term's share of the quotation total.
export async function saveQuotationTerms(quotationId: string, formData: FormData): Promise<ActionResult> {
  const q = await prisma.quotation.findUniqueOrThrow({ where: { id: quotationId } });
  if (q.status !== "DRAFT") return fail("Payment terms can only be changed on a draft. Create a new version to change them.");

  const parsed = parseTermRows(formData);
  if (!parsed.ok) return fail(parsed.error);

  await prisma.$transaction([
    prisma.quotationTerm.deleteMany({ where: { quotationId } }),
    prisma.quotationTerm.createMany({ data: parsed.rows.map((r, i) => ({ quotationId, seq: i + 1, name: r.name, trigger: r.trigger, pct: r.pct })) }),
  ]);
  revalidatePath(`/projects/${q.projectId}`);
  return ok();
}

export async function sendQuotation(quotationId: string): Promise<ActionResult> {
  const q = await prisma.quotation.findUniqueOrThrow({ where: { id: quotationId }, include: { lineItems: true, terms: true } });
  if (q.status !== "DRAFT") return fail("Only a draft can be sent");
  if (q.lineItems.length === 0) return fail("There are no priced lines to send");
  const termsTotal = q.terms.reduce((s, t) => s + t.pct, 0);
  if (termsTotal !== 100) return fail("Set the payment terms first. They must add up to 100% of the contract sum.");

  const readiness = await getQuotationReadiness(q.projectId);
  if (!readiness.ready) return fail(readinessError(readiness.blockers));

  const now = new Date();
  await prisma.$transaction([
    prisma.quotation.updateMany({
      where: { projectId: q.projectId, status: { in: OPEN_STATUSES } },
      data: { status: "SUPERSEDED" },
    }),
    prisma.quotation.update({
      where: { id: quotationId },
      data: { status: "SENT", sentAt: now, events: { create: [{ type: "SENT", note: "Link sent via WhatsApp and email" }] } },
    }),
  ]);

  revalidatePath(`/projects/${q.projectId}`);
  return ok();
}

// Stand-in for the client-facing link until a portal exists: records what the client did.
export async function recordClientResponse(
  quotationId: string,
  response: "VIEWED" | "ACCEPTED",
  note?: string
): Promise<ActionResult> {
  const q = await prisma.quotation.findUniqueOrThrow({ where: { id: quotationId }, include: { lineItems: true, project: true } });
  if (!OPEN_STATUSES.includes(q.status)) return fail("This version is not awaiting a client response");

  if (response === "ACCEPTED") {
    const total = quotationTotals(q.lineItems).total;
    await prisma.$transaction([
      prisma.quotation.deleteMany({ where: { projectId: q.projectId, status: "DRAFT" } }),
      prisma.quotation.updateMany({ where: { projectId: q.projectId, id: { not: quotationId }, status: { in: OPEN_STATUSES } }, data: { status: "SUPERSEDED" } }),
      prisma.quotation.update({
        where: { id: quotationId },
        data: {
          status: "ACCEPTED",
          acceptedAt: new Date(),
          signedBy: note || q.project.clientName,
          events: { create: [{ type: "ACCEPTED", note: `Signed by ${note || q.project.clientName}, IP logged` }] },
        },
      }),
      prisma.project.update({ where: { id: q.projectId }, data: { contractValue: total } }),
    ]);
    // The client's payment schedule follows the terms they just signed.
    await createScheduleFromTerms(q.projectId, quotationId);
  } else {
    await prisma.quotation.update({
      where: { id: quotationId },
      data: {
        status: response,
        viewedAt: q.viewedAt ?? new Date(),
        events: { create: [{ type: response, note: null }] },
      },
    });
  }

  revalidatePath(`/projects/${q.projectId}`);
  return ok();
}

// The client asked something (call, WhatsApp, site visit). The comment goes on
// the quotation's conversation and the version waits for our reply. This can
// happen any number of times until the client signs.
export async function recordClientQuestion(quotationId: string, formData: FormData): Promise<ActionResult> {
  const comment = str(formData, "comment");
  if (comment.length < 3) return fail("Write what the client asked or commented");

  const q = await prisma.quotation.findUniqueOrThrow({ where: { id: quotationId } });
  if (!OPEN_STATUSES.includes(q.status)) return fail("This version is not awaiting a client response");

  await prisma.quotation.update({
    where: { id: quotationId },
    data: {
      status: "QUESTIONED",
      viewedAt: q.viewedAt ?? new Date(),
      events: { create: [{ type: "QUESTIONED", note: comment }] },
    },
  });

  revalidatePath(`/projects/${q.projectId}`);
  return ok();
}

// Our answer to the client's last question. The version goes back to waiting
// on the client, who may reply again or sign.
export async function recordReply(quotationId: string, formData: FormData): Promise<ActionResult> {
  const reply = str(formData, "reply");
  if (reply.length < 3) return fail("Write the reply you gave the client");

  const q = await prisma.quotation.findUniqueOrThrow({ where: { id: quotationId } });
  if (q.status !== "QUESTIONED") return fail("There is no open client question to reply to");

  await prisma.quotation.update({
    where: { id: quotationId },
    data: { status: "VIEWED", events: { create: [{ type: "REPLIED", note: reply }] } },
  });

  revalidatePath(`/projects/${q.projectId}`);
  return ok();
}

export async function applyMarkupToAll(quotationId: string, formData: FormData): Promise<ActionResult> {
  const markupPct = num(formData, "markupPct");
  if (markupPct == null || markupPct < 0 || markupPct > 500) return fail("Enter a markup between 0% and 500%");

  const q = await prisma.quotation.findUniqueOrThrow({ where: { id: quotationId }, include: { lineItems: true } });
  if (q.status !== "DRAFT") return fail("Only a draft can be edited. Create a new version to change prices.");

  await prisma.$transaction(
    q.lineItems.map((l) =>
      prisma.quotationLineItem.update({
        where: { id: l.id },
        data: { markupPct: Math.round(markupPct), clientPrice: Math.round(l.bomCost * (1 + markupPct / 100)) },
      })
    )
  );
  revalidatePath(`/projects/${q.projectId}`);
  return ok();
}
