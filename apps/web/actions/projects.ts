"use server";

import { revalidatePath } from "next/cache";
import { apiAction } from "@/lib/api";
import { parseAddress } from "@/lib/address";
import { BAD_AMOUNT, date, fail, fileRef, money, optStr, str, type ActionResult } from "@/lib/actionResult";

export async function updateProject(projectId: string, formData: FormData): Promise<ActionResult> {
  const budgetMin = money(formData, "budgetMin");
  const budgetMax = money(formData, "budgetMax");
  if (Number.isNaN(budgetMin) || Number.isNaN(budgetMax)) return fail(BAD_AMOUNT);

  const r = await apiAction(`/projects/${projectId}`, {
    method: "PATCH",
    body: {
      name: str(formData, "name"),
      clientName: str(formData, "clientName"),
      clientPhone: optStr(formData, "clientPhone"),
      clientEmail: optStr(formData, "clientEmail"),
      ...parseAddress(formData, true),
      propertyType: optStr(formData, "propertyType"),
      builtUpArea: optStr(formData, "builtUpArea"),
      budgetMin,
      budgetMax,
      pmName: optStr(formData, "pmName"),
      siteName: optStr(formData, "siteName"),
      targetStart: date(formData, "targetStart"),
      targetHandover: date(formData, "targetHandover"),
      stage: str(formData, "stage"),
      cancelReason: optStr(formData, "cancelReason"),
      photo: fileRef(formData, "photo") ?? (str(formData, "removePhoto") === "1" ? "remove" : null),
    },
  });

  revalidatePath("/projects");
  revalidatePath(`/projects/${projectId}`);
  return r;
}
