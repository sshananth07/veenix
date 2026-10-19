"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { bomDeleteBlocker, refreshDraftQuotation } from "@/lib/bom";
import { calcBomTotal } from "@/lib/bom-math";
import { WORK_UNITS } from "@/lib/types";
import { fail, ok, optStr, str, type ActionResult } from "@/lib/actionResult";

// Create (bomItemId null) or edit a BOM line. The stored estTotal is always
// recomputed here from qty x unit cost plus materials, never trusted from the form.
export async function saveBomItem(projectId: string, bomItemId: string | null, formData: FormData): Promise<ActionResult> {
  const workItemId = str(formData, "workItemId");
  const workPackage = str(formData, "workPackage");
  const unit = str(formData, "unit");
  const qty = unit === "lot" ? 1 : Number(str(formData, "qty"));
  const unitCost = Number(str(formData, "unitCost"));
  const performedBy = str(formData, "performedBy") === "SELF" ? "SELF" : "OUTSOURCED";

  if (!workItemId) return fail("Choose the work item this line belongs to");
  const workItem = await prisma.workItem.findFirst({ where: { id: workItemId, projectId } });
  if (!workItem) return fail("Choose a valid work item");
  if (!workPackage) return fail("Job name is required");
  if (!unit) return fail("Choose what the quantity is measured in");
  if (!WORK_UNITS.includes(unit)) {
    const current = bomItemId ? await prisma.bomItem.findFirst({ where: { id: bomItemId, projectId }, select: { unit: true } }) : null;
    if (current?.unit !== unit) return fail("Choose a unit from the list");
  }
  if (!(qty > 0)) return fail("Quantity must be greater than zero");
  if (!(unitCost >= 0)) return fail("Unit cost cannot be negative");

  const materials: { name: string; qty: number; unit: string; unitCost: number; total: number }[] = [];
  if (performedBy === "SELF") {
    const names = formData.getAll("matName").map(String);
    const qtys = formData.getAll("matQty").map(String);
    const units = formData.getAll("matUnit").map(String);
    const costs = formData.getAll("matCost").map(String);
    for (let i = 0; i < names.length; i++) {
      const name = names[i].trim();
      if (!name && !qtys[i] && !costs[i]) continue;
      const mQty = Number(qtys[i]);
      const mCost = Number(costs[i]);
      if (!name) return fail("Every material needs a name");
      if (!(mQty > 0) || !(mCost > 0)) return fail(`Material "${name}" needs a quantity and a unit cost`);
      materials.push({ name, qty: mQty, unit: (units[i] || "nos").trim(), unitCost: mCost, total: Math.round(mQty * mCost) });
    }
  }

  const { total } = calcBomTotal({ qty, unitCost, materials });
  if (total <= 0) return fail("Enter a cost: the line total must be greater than zero");

  if (bomItemId) {
    const existing = await prisma.bomItem.findFirstOrThrow({ where: { id: bomItemId, projectId }, include: { rfqs: true } });
    if (performedBy === "SELF" && existing.rfqs.length > 0) {
      return fail("This line already has vendor RFQs. Remove the vendor requests before making it self-performed.");
    }
    await prisma.bomItem.update({
      where: { id: bomItemId },
      data: {
        workItemId,
        workPackage,
        description: optStr(formData, "description"),
        qty,
        unit,
        unitCost,
        estTotal: total,
        performedBy,
        materials: { deleteMany: {}, create: materials },
      },
    });
  } else {
    const last = await prisma.bomItem.findFirst({ where: { projectId }, orderBy: { seq: "desc" } });
    await prisma.bomItem.create({
      data: {
        projectId,
        workItemId,
        seq: (last?.seq ?? 0) + 1,
        workPackage,
        description: optStr(formData, "description"),
        qty,
        unit,
        unitCost,
        estTotal: total,
        performedBy,
        materials: { create: materials },
      },
    });
  }

  await refreshDraftQuotation(projectId);
  revalidatePath(`/projects/${projectId}`);
  return ok();
}

export async function deleteBomItem(bomItemId: string): Promise<ActionResult> {
  const item = await prisma.bomItem.findUniqueOrThrow({ where: { id: bomItemId } });
  const blocker = await bomDeleteBlocker(bomItemId);
  if (blocker) return fail(`Cannot delete: this line ${blocker}.`);

  await prisma.bomItem.delete({ where: { id: bomItemId } });
  await refreshDraftQuotation(item.projectId);

  revalidatePath(`/projects/${item.projectId}`);
  return ok();
}
