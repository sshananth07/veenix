"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { parseAddress } from "@/lib/address";
import { getFile, saveUpload } from "@/lib/uploads";
import { date, fail, num, ok, optStr, str, type ActionResult } from "@/lib/actionResult";
import { PROJECT_STAGES } from "@/lib/types";

export async function updateProject(projectId: string, formData: FormData): Promise<ActionResult> {
  const name = str(formData, "name");
  const clientName = str(formData, "clientName");
  if (!name) return fail("Project name is required");
  if (!clientName) return fail("Client name is required");
  const address = parseAddress(formData, true);
  if (!address.ok) return fail(address.error);

  const targetStart = date(formData, "targetStart");
  const targetHandover = date(formData, "targetHandover");
  if (targetStart && targetHandover && targetHandover < targetStart) {
    return fail("Target handover must be after the site start");
  }

  const budgetMin = num(formData, "budgetMin");
  const budgetMax = num(formData, "budgetMax");
  if (budgetMin != null && budgetMax != null && budgetMax <= budgetMin) {
    return fail("Max budget must be greater than min budget");
  }

  const stage = str(formData, "stage");
  const current = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  const nextStage = PROJECT_STAGES.includes(stage as (typeof PROJECT_STAGES)[number]) ? stage : current.stage;

  let photoPath: string | undefined;
  const photo = getFile(formData, "photo");
  if (photo) {
    try {
      photoPath = (await saveUpload(photo, "photos")).path;
    } catch (e) {
      return fail(e instanceof Error ? e.message : "Could not upload the photo");
    }
  } else if (str(formData, "removePhoto") === "1") {
    photoPath = "";
  }

  await prisma.project.update({
    where: { id: projectId },
    data: {
      photoPath: photoPath === "" ? null : photoPath,
      name,
      clientName,
      clientPhone: optStr(formData, "clientPhone"),
      clientEmail: optStr(formData, "clientEmail"),
      ...address.parts,
      siteAddress: address.siteAddress ?? "",
      propertyType: optStr(formData, "propertyType"),
      builtUpArea: optStr(formData, "builtUpArea"),
      budgetMin,
      budgetMax,
      pmName: optStr(formData, "pmName"),
      siteName: optStr(formData, "siteName"),
      targetStart,
      targetHandover,
      stage: nextStage,
      stageEnteredAt: nextStage !== current.stage ? new Date() : undefined,
      cancelReason: nextStage === "CANCELLED" ? optStr(formData, "cancelReason") : null,
    },
  });

  revalidatePath("/projects");
  revalidatePath(`/projects/${projectId}`);
  return ok();
}
