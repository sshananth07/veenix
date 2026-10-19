"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { bomDeleteBlocker, refreshDraftQuotation } from "@/lib/bom";
import { fail, ok, optStr, str, type ActionResult } from "@/lib/actionResult";

async function nameTaken(projectId: string, name: string, exceptId?: string) {
  const items = await prisma.workItem.findMany({ where: { projectId } });
  return items.some((w) => w.id !== exceptId && w.name.toLowerCase() === name.toLowerCase());
}

export async function createWorkItem(projectId: string, formData: FormData): Promise<ActionResult> {
  const name = str(formData, "name");
  if (!name) return fail("Work item name is required");
  if (await nameTaken(projectId, name)) return fail(`"${name}" already exists on this project`);

  const count = await prisma.workItem.count({ where: { projectId } });
  await prisma.workItem.create({ data: { projectId, seq: count + 1, name, description: optStr(formData, "description") } });

  revalidatePath(`/projects/${projectId}`);
  return ok();
}

export async function updateWorkItem(workItemId: string, formData: FormData): Promise<ActionResult> {
  const name = str(formData, "name");
  if (!name) return fail("Work item name is required");
  const item = await prisma.workItem.findUniqueOrThrow({ where: { id: workItemId } });
  if (await nameTaken(item.projectId, name, workItemId)) return fail(`"${name}" already exists on this project`);

  await prisma.workItem.update({ where: { id: workItemId }, data: { name, description: optStr(formData, "description") } });
  await refreshDraftQuotation(item.projectId);

  revalidatePath(`/projects/${item.projectId}`);
  return ok();
}

// Removes the work item and every BOM line under it, then rewrites the draft
// quotation. Refused if any line already has a PO or sits in a signed quotation.
export async function deleteWorkItem(workItemId: string): Promise<ActionResult> {
  const item = await prisma.workItem.findUniqueOrThrow({ where: { id: workItemId }, include: { bomItems: true } });

  for (const b of item.bomItems) {
    const blocker = await bomDeleteBlocker(b.id);
    if (blocker) return fail(`Cannot delete: "${b.workPackage}" ${blocker}.`);
  }

  await prisma.$transaction([
    prisma.bomItem.deleteMany({ where: { workItemId } }),
    prisma.workItem.delete({ where: { id: workItemId } }),
  ]);
  await refreshDraftQuotation(item.projectId);

  revalidatePath(`/projects/${item.projectId}`);
  return ok();
}
