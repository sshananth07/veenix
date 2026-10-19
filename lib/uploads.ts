import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

const ROOT = path.join(process.cwd(), "uploads");
const MAX_BYTES = 10 * 1024 * 1024;

const TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

const IMAGE_EXT = [".png", ".jpg", ".jpeg", ".webp"];
const DOCUMENT_EXT = [".pdf", ".png", ".jpg", ".jpeg", ".webp"];
const ANY_FILE_EXT = Object.keys(TYPES);

export type UploadFolder = "quotes" | "invoices" | "photos" | "vo" | "files" | "logos";

const ALLOWED: Record<UploadFolder, string[]> = {
  quotes: DOCUMENT_EXT,
  invoices: DOCUMENT_EXT,
  vo: DOCUMENT_EXT,
  photos: IMAGE_EXT,
  logos: IMAGE_EXT,
  files: ANY_FILE_EXT,
};

const ALLOWED_LABEL: Record<UploadFolder, string> = {
  quotes: "Upload a PDF, PNG, JPG or WEBP file",
  invoices: "Upload a PDF, PNG, JPG or WEBP file",
  vo: "Upload a PDF, PNG, JPG or WEBP file",
  photos: "Upload a PNG, JPG or WEBP image",
  logos: "Upload a PNG, JPG or WEBP image",
  files: "Upload a PDF, image, Word or Excel file",
};

export async function saveUpload(file: File, folder: UploadFolder) {
  const ext = path.extname(file.name).toLowerCase();
  if (!ALLOWED[folder].includes(ext)) throw new Error(ALLOWED_LABEL[folder]);
  if (file.size > MAX_BYTES) throw new Error("File is larger than 10 MB");

  const relative = `${folder}/${randomUUID()}${ext}`;
  await mkdir(path.join(ROOT, folder), { recursive: true });
  await writeFile(path.join(ROOT, relative), Buffer.from(await file.arrayBuffer()));
  return { path: relative, name: file.name.slice(0, 120), size: file.size, contentType: TYPES[ext] };
}

const FOLDER_PATTERN = "quotes|invoices|photos|vo|files|logos";
const EXT_PATTERN = ANY_FILE_EXT.map((e) => e.slice(1)).join("|");
const PATH_RE = new RegExp(`^(${FOLDER_PATTERN})/[0-9a-f-]{36}\\.(${EXT_PATTERN})$`);

export async function readUpload(relative: string) {
  if (!PATH_RE.test(relative)) return null;
  try {
    const buffer = await readFile(path.join(ROOT, relative));
    return { buffer, contentType: TYPES[path.extname(relative)] };
  } catch {
    return null;
  }
}

export async function deleteUpload(relative: string) {
  if (!PATH_RE.test(relative)) return;
  try {
    await unlink(path.join(ROOT, relative));
  } catch {
    // already gone — fine
  }
}

export function absoluteUploadPath(relative: string) {
  return path.join(ROOT, relative);
}

// Returns the uploaded file from a form, or null when the field was left empty.
export function getFile(formData: FormData, field: string) {
  const value = formData.get(field);
  return value instanceof File && value.size > 0 ? value : null;
}
