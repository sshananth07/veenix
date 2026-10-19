"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { deleteUpload, getFile, saveUpload } from "@/lib/uploads";
import { fail, ok, type ActionResult } from "@/lib/actionResult";

// Every file in the submit goes to the "files" field (the drop zone appends
// one entry per file dropped or picked). Each is saved and recorded.
export async function uploadProjectFiles(projectId: string, formData: FormData): Promise<ActionResult> {
  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return fail("Choose at least one file");

  const saved: { name: string; path: string; size: number; contentType: string }[] = [];
  for (const file of files) {
    try {
      saved.push(await saveUpload(file, "files"));
    } catch (e) {
      for (const s of saved) await deleteUpload(s.path);
      return fail(e instanceof Error ? `"${file.name}": ${e.message}` : "Could not upload the file");
    }
  }

  await prisma.projectFile.createMany({
    data: saved.map((s) => ({ projectId, name: s.name, path: s.path, size: s.size, contentType: s.contentType })),
  });

  revalidatePath(`/projects/${projectId}`);
  return ok();
}

export async function deleteProjectFile(fileId: string): Promise<ActionResult> {
  const file = await prisma.projectFile.findUniqueOrThrow({ where: { id: fileId } });
  await prisma.projectFile.delete({ where: { id: fileId } });
  await deleteUpload(file.path);

  revalidatePath(`/projects/${file.projectId}`);
  return ok();
}
