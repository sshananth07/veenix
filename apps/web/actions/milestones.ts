"use server";

import { revalidatePath } from "next/cache";
import { apiAction } from "@/lib/api";
import { BAD_AMOUNT, fail, money, optStr, str, type ActionResult } from "@/lib/actionResult";

const refresh = (r: ActionResult) => {
  revalidatePath("/projects/[id]", "page");
  return r;
};

export async function raiseInvoice(milestoneId: string): Promise<ActionResult> {
  return refresh(await apiAction(`/milestones/${milestoneId}/invoice`, { method: "POST" }));
}

export async function recordClientPayment(invoiceId: string, formData: FormData): Promise<ActionResult> {
  const amount = money(formData, "amount");
  if (amount === null || Number.isNaN(amount)) return fail(BAD_AMOUNT);
  const body = { amount, receivedAt: str(formData, "receivedAt"), method: str(formData, "method"), reference: optStr(formData, "reference") };
  return refresh(await apiAction(`/invoices/${invoiceId}/payments`, { method: "POST", body }));
}

export async function reverseClientPayment(invoiceId: string, paymentId: string): Promise<ActionResult> {
  return refresh(await apiAction(`/invoices/${invoiceId}/payments/${paymentId}/reverse`, { method: "POST" }));
}

/** Sends an invoice to LHDN MyInvois, or again after fixing what it rejected. */
export async function submitEinvoice(invoiceId: string): Promise<ActionResult> {
  return refresh(await apiAction(`/invoices/${invoiceId}/einvoice`, { method: "POST" }));
}
