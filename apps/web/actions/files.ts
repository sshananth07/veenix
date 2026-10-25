"use server";

import { revalidatePath } from "next/cache";
import { apiAction } from "@/lib/api";
import { fail, type ActionResult } from "@/lib/actionResult";

// The browser uploads each dropped file first; FormDialog sends their keys as filesKey / filesName pairs.
export async function uploadProjectFiles(projectId: string, formData: FormData): Promise<ActionResult> {
  const names = formData.getAll("filesName").map(String);
  const files = formData.getAll("filesKey").map((key, i) => ({ key: String(key), name: names[i] || "file" }));
  if (files.length === 0) return fail("Choose at least one file");
  const r = await apiAction(`/projects/${projectId}/files`, { method: "POST", body: { files } });
  revalidatePath(`/projects/${projectId}`);
  return r;
}

export async function deleteProjectFile(fileId: string): Promise<ActionResult> {
  const r = await apiAction(`/files/${fileId}`, { method: "DELETE" });
  revalidatePath("/projects/[id]", "page");
  return r;
}
