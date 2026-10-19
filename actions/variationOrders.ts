"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getFile, saveUpload } from "@/lib/uploads";
import { fail, num, ok, optStr, str, uniqueCode, type ActionResult } from "@/lib/actionResult";

export async function createVariationOrder(projectId: string, formData: FormData): Promise<ActionResult> {
  const signed = await prisma.quotation.findFirst({ where: { projectId, status: "ACCEPTED" } });
  if (!signed) return fail("Variation orders start once the client has signed a quotation");

  const title = str(formData, "title");
  const description = str(formData, "description");
  const amount = Math.round(num(formData, "amount") ?? 0);
  if (!title) return fail("Give the variation a short title");
  if (!description) return fail("Describe the additional work");
  if (!(amount > 0)) return fail("Enter the additional cost");

  let upload: { path: string; name: string } | null = null;
  const file = getFile(formData, "file");
  if (file) {
    try {
      upload = await saveUpload(file, "vo");
    } catch (e) {
      return fail(e instanceof Error ? e.message : "Could not upload the file");
    }
  }

  const code = await uniqueCode("VO", await prisma.variationOrder.count({ where: { projectId } }), async (c) =>
    !!(await prisma.variationOrder.findUnique({ where: { code: c } }))
  );

  await prisma.variationOrder.create({
    data: {
      code,
      projectId,
      title,
      description,
      reason: optStr(formData, "reason"),
      raisedBy: optStr(formData, "raisedBy"),
      amount,
      bomItemId: optStr(formData, "bomItemId"),
      programmeImpact: optStr(formData, "programmeImpact"),
      status: "DRAFT",
      ...(upload ? { attachmentPath: upload.path, attachmentName: upload.name } : {}),
    },
  });

  revalidatePath(`/projects/${projectId}`);
  return ok();
}

export async function sendVariationOrderToClient(voId: string) {
  const vo = await prisma.variationOrder.update({ where: { id: voId }, data: { status: "CLIENT_REVIEW" } });
  revalidatePath(`/projects/${vo.projectId}`);
}

export async function acceptVariationOrder(voId: string) {
  const vo = await prisma.variationOrder.update({ where: { id: voId }, data: { status: "ACCEPTED" } });

  const count = await prisma.paymentMilestone.count({ where: { projectId: vo.projectId } });
  await prisma.paymentMilestone.create({
    data: {
      projectId: vo.projectId,
      seq: count + 1,
      name: `${vo.code} - variation`,
      trigger: "On completion of this VO",
      amount: vo.amount,
      status: "PENDING_SIGNOFF",
    },
  });
  await prisma.project.update({ where: { id: vo.projectId }, data: { contractValue: { increment: vo.amount } } });

  revalidatePath(`/projects/${vo.projectId}`);
}
