"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";

function nextInvoiceCode() {
  return `INV-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 8999)}`;
}

export async function generateInvoiceForMilestone(milestoneId: string) {
  const milestone = await prisma.paymentMilestone.findUniqueOrThrow({
    where: { id: milestoneId },
    include: { invoice: true },
  });
  if (milestone.invoice) return milestone.invoice.id;

  const amountExSst = Math.round(milestone.amount / 1.08);
  const sstAmount = milestone.amount - amountExSst;
  const now = new Date();
  const due = new Date(now);
  due.setDate(due.getDate() + 7);

  const invoice = await prisma.invoice.create({
    data: {
      code: nextInvoiceCode(),
      milestoneId,
      invoiceDate: now,
      dueDate: due,
      amount: amountExSst,
      sstAmount,
      status: "ISSUED",
      eInvoiceUuid: `${Math.random().toString(36).slice(2, 7).toUpperCase()}-${now.getMonth() + 1}${now.getDate()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      eInvoiceValidatedAt: now,
    },
  });

  await prisma.paymentMilestone.update({ where: { id: milestoneId }, data: { status: "AWAITING_PAYMENT" } });

  revalidatePath(`/projects/${milestone.projectId}`);
  return invoice.id;
}

export async function markInvoicePaid(invoiceId: string) {
  const invoice = await prisma.invoice.update({
    where: { id: invoiceId },
    data: { status: "PAID" },
    include: { milestone: true },
  });
  await prisma.paymentMilestone.update({ where: { id: invoice.milestoneId }, data: { status: "PAID" } });
  revalidatePath(`/projects/${invoice.milestone.projectId}`);
}
