import { parseRinggit } from "@veenix/shared";

export type ActionResult = { ok: true } | { ok: false; error: string };

export const ok = (): ActionResult => ({ ok: true });
export const fail = (error: string): ActionResult => ({ ok: false, error });

export function str(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

export function optStr(formData: FormData, key: string) {
  return str(formData, key) || null;
}

export function num(formData: FormData, key: string) {
  const raw = str(formData, key);
  return raw === "" ? null : Number(raw);
}

export function date(formData: FormData, key: string) {
  const raw = str(formData, key);
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** A ringgit form field as sen: null when blank, NaN when not a valid amount. */
export function money(formData: FormData, key: string): number | null {
  const raw = str(formData, key);
  if (raw === "") return null;
  return parseRinggit(raw) ?? Number.NaN;
}

export const BAD_AMOUNT = "Enter a valid amount, e.g. 1234.50";

/** A file the browser already uploaded (FormDialog swaps File fields for <field>Key / <field>Name, Task 8.4). */
export function fileRef(formData: FormData, field: string) {
  const key = str(formData, `${field}Key`);
  return key ? { key, name: str(formData, `${field}Name`) || "file" } : null;
}
