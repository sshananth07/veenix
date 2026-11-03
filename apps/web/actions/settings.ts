"use server";

import { revalidatePath } from "next/cache";
import { apiAction, apiActionData } from "@/lib/api";
import { parseAddress } from "@/lib/address";
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

export async function updateEinvoiceSettings(formData: FormData): Promise<ActionResult> {
  // The .p12 goes straight to the API (never to storage); the API keeps only the encrypted key.
  const file = formData.get("certificate");
  const certificateBase64 = file instanceof File && file.size > 0 ? Buffer.from(await file.arrayBuffer()).toString("base64") : undefined;
  const r = await apiAction("/org/einvoice", {
    method: "PATCH",
    body: {
      enabled: str(formData, "enabled") === "on",
      environment: str(formData, "environment"),
      tin: str(formData, "tin"),
      brn: str(formData, "brn"),
      sstNo: optStr(formData, "sstNo"),
      msicCode: str(formData, "msicCode"),
      businessActivity: str(formData, "businessActivity"),
      phone: str(formData, "phone"),
      ...parseAddress(formData, true),
      clientId: str(formData, "clientId"),
      clientSecret: optStr(formData, "clientSecret") ?? undefined,
      certificateBase64,
      certificatePassword: certificateBase64 ? str(formData, "certificatePassword") : undefined,
    },
  });
  revalidatePath("/settings");
  return r;
}

export async function startWhatsAppLink() {
  return apiActionData<{ code: string; waUrl: string }>("/whatsapp/link", { method: "POST" });
}

export async function unlinkWhatsApp(): Promise<ActionResult> {
  const r = await apiAction("/whatsapp/link", { method: "DELETE" });
  revalidatePath("/settings");
  return r;
}
