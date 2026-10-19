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

export async function uniqueCode(prefix: string, count: number, exists: (code: string) => Promise<boolean>) {
  let n = count + 1;
  let code = `${prefix}-${String(n).padStart(4, "0")}`;
  while (await exists(code)) code = `${prefix}-${String(++n).padStart(4, "0")}`;
  return code;
}
