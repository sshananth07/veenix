"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api, apiAction } from "@/lib/api";
import { parseAddress } from "@/lib/address";
import { BAD_AMOUNT, date, fail, money, optStr, str, type ActionResult } from "@/lib/actionResult";

function leadBody(formData: FormData) {
  const budgetMin = money(formData, "budgetMin");
  const budgetMax = money(formData, "budgetMax");
  if (Number.isNaN(budgetMin) || Number.isNaN(budgetMax)) return null;
  return {
    name: str(formData, "name"),
    phone: str(formData, "phone"),
    email: optStr(formData, "email"),
    source: str(formData, "source") || "Other",
    campaign: optStr(formData, "campaign"),
    propertyType: optStr(formData, "propertyType"),
    builtUpArea: optStr(formData, "builtUpArea"),
    budgetMin,
    budgetMax,
    ...parseAddress(formData),
    targetStart: optStr(formData, "targetStart"),
    assignedTo: optStr(formData, "assignedTo"),
    surveyAt: date(formData, "surveyAt"),
    ...(str(formData, "status") ? { status: str(formData, "status") } : {}),
  };
}

export async function createLead(formData: FormData): Promise<ActionResult> {
  const body = leadBody(formData);
  if (!body) return fail(BAD_AMOUNT);
  const r = await apiAction("/leads", { method: "POST", body });
  revalidatePath("/leads");
  return r;
}

export async function updateLead(leadId: string, formData: FormData): Promise<ActionResult> {
  const body = leadBody(formData);
  if (!body) return fail(BAD_AMOUNT);
  const r = await apiAction(`/leads/${leadId}`, { method: "PATCH", body });
  revalidatePath("/leads");
  revalidatePath(`/leads/${leadId}`);
  return r;
}

export async function logLeadActivity(leadId: string, note: string) {
  if (!note.trim()) return;
  await apiAction(`/leads/${leadId}/activities`, { method: "POST", body: { note: note.trim(), author: null } });
  revalidatePath(`/leads/${leadId}`);
}

export async function convertLead(leadId: string, formData: FormData): Promise<ActionResult> {
  let projectId: string;
  try {
    ({ projectId } = await api<{ projectId: string }>(`/leads/${leadId}/convert`, {
      method: "POST",
      body: {
        projectName: str(formData, "projectName"),
        targetStart: date(formData, "targetStart"),
        targetHandover: date(formData, "targetHandover"),
        projectOwner: optStr(formData, "projectOwner"),
        nextStage: str(formData, "nextStage") || "SITE_VISIT",
        address: formData.has("addressLine1") ? parseAddress(formData, true) : null,
      },
    }));
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Could not convert the lead");
  }
  revalidatePath("/leads");
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/projects");
  redirect(`/projects/${projectId}`);
}
