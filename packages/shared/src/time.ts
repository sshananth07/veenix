export const MY_TZ = "Asia/Kuala_Lumpur";

// Malaysia is UTC+8 all year (no daylight saving), so a fixed offset is exact.
const OFFSET_MS = 8 * 3_600_000;
const DAY_MS = 86_400_000;

export function mytYear(d: Date = new Date()): number {
  return new Date(d.getTime() + OFFSET_MS).getUTCFullYear();
}

/** The UTC instant at which the Malaysian calendar day containing `d` began. */
export function mytStartOfDay(d: Date = new Date()): Date {
  const local = new Date(d.getTime() + OFFSET_MS);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() - OFFSET_MS);
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS);
}

/** "YYYY-MM-DD" in Malaysian time, for <input type="date"> values. */
export function toDateInput(value: Date | string | null | undefined): string {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  return new Date(d.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

export function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / DAY_MS);
}
