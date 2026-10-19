"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { allocate, parseTermRows } from "@/lib/paymentTerms";
import { quotationTotals } from "@/lib/quotation";
import { fail, ok, type ActionResult } from "@/lib/actionResult";

// Fallback for a signed quotation that has no payment terms (signed before
// terms existed): the client schedule is typed in against the signed total.
// Normally the schedule is created automatically when the client signs.
export async function createMilestoneSchedule(projectId: string, formData: FormData): Promise<ActionResult> {
  const existing = await prisma.paymentMilestone.count({ where: { projectId } });
  if (existing > 0) return fail("Payment milestones already exist for this project");

  const signed = await prisma.quotation.findFirst({ where: { projectId, status: "ACCEPTED" }, include: { lineItems: true } });
  if (!signed) return fail("Payment milestones are set up once the client has signed a quotation");
  const contractSum = quotationTotals(signed.lineItems).total;

  const parsed = parseTermRows(formData);
  if (!parsed.ok) return fail(parsed.error);

  const amounts = allocate(contractSum, parsed.rows);
  await prisma.$transaction([
    prisma.quotationTerm.deleteMany({ where: { quotationId: signed.id } }),
    prisma.quotationTerm.createMany({ data: parsed.rows.map((r, i) => ({ quotationId: signed.id, seq: i + 1, name: r.name, trigger: r.trigger, pct: r.pct })) }),
    ...parsed.rows.map((r, i) =>
      prisma.paymentMilestone.create({
        data: { projectId, seq: i + 1, name: r.name, trigger: r.trigger, pct: r.pct, amount: amounts[i], status: i === 0 ? "AWAITING_PAYMENT" : "NOT_YET_DUE" },
      })
    ),
  ]);

  revalidatePath(`/projects/${projectId}`);
  return ok();
}
