"use server";

import { revalidatePath } from "next/cache";
import { apiAction } from "@/lib/api";
import { fileRef, num, optStr, str, type ActionResult } from "@/lib/actionResult";

export async function updateLetterhead(formData: FormData): Promise<ActionResult> {
  const r = await apiAction("/org/letterhead", {
    method: "PATCH",
    body: {
      companyName: str(formData, "companyName"),
      companyReg: str(formData, "companyReg"),
      companyAddress: str(formData, "companyAddress"),
      companyPhone: str(formData, "companyPhone"),
      logo: fileRef(formData, "logo") ?? (str(formData, "removeLogo") === "1" ? "remove" : null),
    },
  });
  revalidatePath("/settings");
  return r;
}

export async function updateBankDetails(formData: FormData): Promise<ActionResult> {
  const r = await apiAction("/org/bank", {
    method: "PATCH",
    body: {
      bankName: str(formData, "bankName"),
      bankAccountName: str(formData, "bankAccountName"),
      bankAccount: str(formData, "bankAccount"),
      swiftCode: optStr(formData, "swiftCode"),
    },
  });
  revalidatePath("/settings");
  return r;
}

export async function updateMarkupSettings(formData: FormData): Promise<ActionResult> {
  const r = await apiAction("/org/pricing", {
    method: "PATCH",
    body: { defaultMarkupPct: num(formData, "defaultMarkupPct"), minMarkupPct: num(formData, "minMarkupPct") },
  });
  revalidatePath("/settings");
  return r;
}
