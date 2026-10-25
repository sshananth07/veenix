"use server";

import { revalidatePath } from "next/cache";
import { api, apiAction } from "@/lib/api";
import type { ActionResult } from "@/lib/actionResult";

export async function generateInvoiceForMilestone(milestoneId: string) {
  const { invoiceId } = await api<{ invoiceId: string }>(`/milestones/${milestoneId}/invoice`, { method: "POST" });
  revalidatePath("/projects/[id]", "page");
  return invoiceId;
}

export async function markInvoicePaid(invoiceId: string): Promise<ActionResult> {
  const r = await apiAction(`/invoices/${invoiceId}/paid`, { method: "POST" });
  revalidatePath("/projects/[id]", "page");
  return r;
}
