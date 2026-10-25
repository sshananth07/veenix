"use server";

import { revalidatePath } from "next/cache";
import { apiAction } from "@/lib/api";
import { BAD_AMOUNT, fail, fileRef, money, optStr, str, type ActionResult } from "@/lib/actionResult";

export async function createVariationOrder(projectId: string, formData: FormData): Promise<ActionResult> {
  const amount = money(formData, "amount");
  if (Number.isNaN(amount)) return fail(BAD_AMOUNT);
  const r = await apiAction(`/projects/${projectId}/variation-orders`, {
    method: "POST",
    body: {
      title: str(formData, "title"),
      description: str(formData, "description"),
      reason: optStr(formData, "reason"),
      raisedBy: optStr(formData, "raisedBy"),
      amount,
      bomItemId: optStr(formData, "bomItemId"),
      programmeImpact: optStr(formData, "programmeImpact"),
      file: fileRef(formData, "file"),
    },
  });
  revalidatePath(`/projects/${projectId}`);
  return r;
}

export async function sendVariationOrderToClient(voId: string): Promise<ActionResult> {
  const r = await apiAction(`/variation-orders/${voId}/send`, { method: "POST" });
  revalidatePath("/projects/[id]", "page");
  return r;
}

export async function acceptVariationOrder(voId: string): Promise<ActionResult> {
  const r = await apiAction(`/variation-orders/${voId}/accept`, { method: "POST" });
  revalidatePath("/projects/[id]", "page");
  return r;
}
