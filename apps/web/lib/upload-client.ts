"use client";
import { MAX_UPLOAD_BYTES, type UploadPurpose } from "@veenix/shared";
import { presignUpload } from "@/actions/session";

/** Sends the file straight to storage (past Vercel's 4.5 MB request limit) and returns its key for the form. */
export async function uploadFile(file: File, purpose: UploadPurpose) {
  if (file.size > MAX_UPLOAD_BYTES) throw new Error(`"${file.name}" is larger than 10 MB`);
  const { key, url, contentType } = await presignUpload({ purpose, filename: file.name, contentType: file.type, size: file.size });
  const put = await fetch(url, { method: "PUT", body: file, headers: { "content-type": contentType } });
  if (!put.ok) throw new Error(`Could not upload "${file.name}". Try again.`);
  return { key, name: file.name.slice(0, 120) };
}

/** Replaces every File in the form with <field>Key / <field>Name after uploading it. */
export async function uploadFormFiles(formData: FormData, purpose: UploadPurpose) {
  const out = new FormData();
  for (const [field, value] of formData.entries()) {
    if (value instanceof File) {
      if (value.size === 0) continue;
      const { key, name } = await uploadFile(value, purpose);
      out.append(`${field}Key`, key);
      out.append(`${field}Name`, name);
    } else {
      out.append(field, value);
    }
  }
  return out;
}
