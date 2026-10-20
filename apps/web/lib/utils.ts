import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number | string) {
  const n = typeof value === "string" ? Number(value) : value;
  return "RM " + new Intl.NumberFormat("en-MY", { maximumFractionDigits: 0 }).format(n);
}

export function formatMoney2(value: number) {
  return "RM " + new Intl.NumberFormat("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

export function formatNumber(value: number, maxFractionDigits = 2) {
  return new Intl.NumberFormat("en-MY", { maximumFractionDigits: maxFractionDigits }).format(value);
}

// "RM 100k – 200k": compact enough for a table cell.
export function formatBudget(min: number | null | undefined, max: number | null | undefined) {
  const short = (n: number) => {
    const trim = (v: number) => String(Math.round(v * 10) / 10);
    return n >= 1_000_000 ? `${trim(n / 1_000_000)}m` : n >= 1000 ? `${trim(n / 1000)}k` : String(n);
  };
  if (min != null && max != null) return `RM ${short(min)} – ${short(max)}`;
  if (min != null) return `From RM ${short(min)}`;
  if (max != null) return `Up to RM ${short(max)}`;
  return null;
}

export function formatDate(value: Date | string | null | undefined) {
  if (!value) return "-";
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-MY", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
}

export function formatDateTime(value: Date | string | null | undefined) {
  if (!value) return "-";
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-MY", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

export function toDateInput(value: Date | null | undefined) {
  return value ? value.toISOString().slice(0, 10) : "";
}

export function daysBetween(from: Date, to: Date) {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}
