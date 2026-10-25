"use server";

import { revalidatePath } from "next/cache";
import { apiAction } from "@/lib/api";
import { optStr, str, type ActionResult } from "@/lib/actionResult";

const body = (formData: FormData) => ({ name: str(formData, "name"), description: optStr(formData, "description") });

export async function createWorkItem(projectId: string, formData: FormData): Promise<ActionResult> {
  const r = await apiAction(`/projects/${projectId}/work-items`, { method: "POST", body: body(formData) });
  revalidatePath(`/projects/${projectId}`);
  return r;
}

export async function updateWorkItem(workItemId: string, formData: FormData): Promise<ActionResult> {
  const r = await apiAction(`/work-items/${workItemId}`, { method: "PATCH", body: body(formData) });
  revalidatePath("/projects/[id]", "page");
  return r;
}

// Removes the work item and every BOM line under it. The API refuses if any line has a PO or is in a signed quotation.
export async function deleteWorkItem(workItemId: string): Promise<ActionResult> {
  const r = await apiAction(`/work-items/${workItemId}`, { method: "DELETE" });
  revalidatePath("/projects/[id]", "page");
  return r;
}
