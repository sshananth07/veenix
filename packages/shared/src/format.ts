import type { Sen } from "./money";
import { MY_TZ } from "./time";

/** "RM 1,234.50", or "RM 1,200" when there are no sen. */
export function formatCurrency(sen: Sen): string {
  const digits = sen % 100 === 0 ? 0 : 2;
  return "RM " + new Intl.NumberFormat("en-MY", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(sen / 100);
}

/** Always two decimals: "RM 1,200.00". */
export function formatMoney2(sen: Sen): string {
  return "RM " + new Intl.NumberFormat("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(sen / 100);
}

export function formatNumber(value: number, maxFractionDigits = 2): string {
  return new Intl.NumberFormat("en-MY", { maximumFractionDigits: maxFractionDigits }).format(value);
}

/** "RM 100k – 200k": compact enough for a table cell. Inputs are sen. */
export function formatBudget(minSen: Sen | null | undefined, maxSen: Sen | null | undefined): string | null {
  const short = (sen: number) => {
    const n = sen / 100;
    const trim = (v: number) => String(Math.round(v * 10) / 10);
    return n >= 1_000_000 ? `${trim(n / 1_000_000)}m` : n >= 1000 ? `${trim(n / 1000)}k` : String(n);
  };
  if (minSen != null && maxSen != null) return `RM ${short(minSen)} – ${short(maxSen)}`;
  if (minSen != null) return `From RM ${short(minSen)}`;
  if (maxSen != null) return `Up to RM ${short(maxSen)}`;
  return null;
}

export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "-";
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-MY", { timeZone: MY_TZ, year: "numeric", month: "short", day: "numeric" }).format(d);
}

export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return "-";
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-MY", {
    timeZone: MY_TZ,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}
