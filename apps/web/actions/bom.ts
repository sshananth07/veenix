"use server";

import { revalidatePath } from "next/cache";
import { parseRinggit } from "@veenix/shared";
import { apiAction } from "@/lib/api";
import { BAD_AMOUNT, fail, money, optStr, str, type ActionResult } from "@/lib/actionResult";

export async function saveBomItem(projectId: string, bomItemId: string | null, formData: FormData): Promise<ActionResult> {
  const unit = str(formData, "unit");
  const unitCost = money(formData, "unitCost");
  if (unitCost == null || Number.isNaN(unitCost)) return fail(BAD_AMOUNT);
  const performedBy = str(formData, "performedBy") === "SELF" ? "SELF" : "OUTSOURCED";

  const names = formData.getAll("matName").map(String);
  const qtys = formData.getAll("matQty").map(String);
  const units = formData.getAll("matUnit").map(String);
  const costs = formData.getAll("matCost").map(String);
  const materials = performedBy !== "SELF" ? [] : names
    .map((name, i) => ({ name: name.trim(), qty: Number(qtys[i]), unit: (units[i] || "nos").trim(), unitCost: parseRinggit(costs[i] ?? "") ?? Number.NaN }))
    .filter((m, i) => m.name || qtys[i] || costs[i]);
  if (materials.some((m) => Number.isNaN(m.unitCost))) return fail(BAD_AMOUNT);

  const body = {
    workItemId: str(formData, "workItemId"),
    workPackage: str(formData, "workPackage"),
    description: optStr(formData, "description"),
    unit,
    qty: unit === "lot" ? 1 : Number(str(formData, "qty")),
    unitCost,
    performedBy,
    materials,
  };
  const r = bomItemId
    ? await apiAction(`/projects/${projectId}/bom-items/${bomItemId}`, { method: "PUT", body })
    : await apiAction(`/projects/${projectId}/bom-items`, { method: "POST", body });
  revalidatePath(`/projects/${projectId}`);
  return r;
}

export async function deleteBomItem(bomItemId: string): Promise<ActionResult> {
  const r = await apiAction(`/bom-items/${bomItemId}`, { method: "DELETE" });
  revalidatePath("/projects/[id]", "page");
  return r;
}
