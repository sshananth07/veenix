"use server";

import { revalidatePath } from "next/cache";
import { apiAction } from "@/lib/api";
import { parseTermRows } from "@/lib/paymentTerms";
import type { ActionResult } from "@/lib/actionResult";

// Fallback for a signed quotation that has no payment terms (signed before
// terms existed): the client schedule is typed in against the signed total.
// Normally the schedule is created automatically when the client signs.
export async function createMilestoneSchedule(projectId: string, formData: FormData): Promise<ActionResult> {
  const r = await apiAction(`/projects/${projectId}/payment-schedule`, { method: "POST", body: { terms: parseTermRows(formData).rows } });
  revalidatePath(`/projects/${projectId}`);
  return r;
}
