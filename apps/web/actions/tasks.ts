"use server";

import { revalidatePath } from "next/cache";
import { apiAction } from "@/lib/api";
import { str, type ActionResult } from "@/lib/actionResult";

// FormDialog uploads the photos first and sends photosKey / photosName pairs.
export async function addSiteUpdate(projectId: string, formData: FormData): Promise<ActionResult> {
  const names = formData.getAll("photosName").map(String);
  const photos = formData.getAll("photosKey").map((key, i) => ({ key: String(key), name: names[i] || "photo" }));
  const r = await apiAction("/updates", { method: "POST", body: { projectId, kind: str(formData, "kind"), text: str(formData, "text"), photos } });
  revalidatePath(`/projects/${projectId}`);
  return r;
}

export async function deleteSiteUpdate(id: string): Promise<ActionResult> {
  const r = await apiAction(`/updates/${id}`, { method: "DELETE" });
  revalidatePath("/projects/[id]", "page");
  return r;
}

export async function completeTask(id: string): Promise<ActionResult> {
  const r = await apiAction(`/tasks/${id}/complete`, { method: "POST" });
  revalidatePath("/", "layout");
  return r;
}

export async function deleteTask(id: string): Promise<ActionResult> {
  const r = await apiAction(`/tasks/${id}`, { method: "DELETE" });
  revalidatePath("/", "layout");
  return r;
}
