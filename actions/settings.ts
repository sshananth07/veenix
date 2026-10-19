"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { deleteUpload, getFile, saveUpload } from "@/lib/uploads";
import { fail, num, ok, optStr, str, type ActionResult } from "@/lib/actionResult";

export async function updateLetterhead(formData: FormData): Promise<ActionResult> {
  const companyName = str(formData, "companyName");
  if (!companyName) return fail("Company name is required");

  const current = await prisma.settings.findUnique({ where: { id: "default" } });

  let logoPath: string | undefined;
  const logo = getFile(formData, "logo");
  if (logo) {
    try {
      logoPath = (await saveUpload(logo, "logos")).path;
    } catch (e) {
      return fail(e instanceof Error ? e.message : "Could not upload the logo");
    }
  } else if (str(formData, "removeLogo") === "1") {
    logoPath = "";
  }
  if (logoPath && current?.logoPath) await deleteUpload(current.logoPath);

  const data = {
    companyName,
    companyReg: str(formData, "companyReg"),
    companyAddress: str(formData, "companyAddress"),
    companyPhone: str(formData, "companyPhone"),
    ...(logoPath !== undefined ? { logoPath: logoPath === "" ? null : logoPath } : {}),
  };
  await prisma.settings.upsert({ where: { id: "default" }, create: { id: "default", ...data }, update: data });

  revalidatePath("/settings");
  return ok();
}

export async function updateBankDetails(formData: FormData): Promise<ActionResult> {
  const bankName = str(formData, "bankName");
  const bankAccount = str(formData, "bankAccount");
  if (!bankName) return fail("Bank name is required");
  if (!bankAccount) return fail("Account number is required");

  const data = {
    bankName,
    bankAccountName: str(formData, "bankAccountName"),
    bankAccount,
    swiftCode: optStr(formData, "swiftCode"),
  };
  await prisma.settings.upsert({ where: { id: "default" }, create: { id: "default", ...data }, update: data });

  revalidatePath("/settings");
  return ok();
}

export async function updateMarkupSettings(formData: FormData): Promise<ActionResult> {
  const defaultMarkupPct = num(formData, "defaultMarkupPct");
  const minMarkupPct = num(formData, "minMarkupPct");
  if (defaultMarkupPct == null || defaultMarkupPct < 0) return fail("Enter a default markup of 0% or more");
  if (minMarkupPct == null || minMarkupPct < 0) return fail("Enter a minimum markup of 0% or more");

  const data = { defaultMarkupPct: Math.round(defaultMarkupPct), minMarkupPct: Math.round(minMarkupPct) };
  await prisma.settings.upsert({ where: { id: "default" }, create: { id: "default", ...data }, update: data });

  revalidatePath("/settings");
  return ok();
}
