import { prisma } from "@/lib/prisma";
import { allocate } from "@/lib/paymentTerms";
import { quotationTotals } from "@/lib/quotation";

// Turns the signed quotation's payment terms into the project's client
// payment schedule. Does nothing if a schedule already exists or the
// quotation has no terms; returns whether it created one.
export async function createScheduleFromTerms(projectId: string, quotationId: string) {
  const [existing, quotation] = await Promise.all([
    prisma.paymentMilestone.count({ where: { projectId } }),
    prisma.quotation.findUnique({ where: { id: quotationId }, include: { lineItems: true, terms: { orderBy: { seq: "asc" } } } }),
  ]);
  if (existing > 0 || !quotation || quotation.terms.length === 0) return false;

  const contractSum = quotationTotals(quotation.lineItems).total;
  const amounts = allocate(contractSum, quotation.terms);
  await prisma.$transaction(
    quotation.terms.map((t, i) =>
      prisma.paymentMilestone.create({
        data: {
          projectId,
          seq: i + 1,
          name: t.name,
          trigger: t.trigger,
          pct: t.pct,
          amount: amounts[i],
          status: i === 0 ? "AWAITING_PAYMENT" : "NOT_YET_DUE",
        },
      })
    )
  );
  return true;
}
