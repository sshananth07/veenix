import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export { formatCurrency, formatMoney2, formatNumber, formatBudget, formatDate, formatDateTime, toDateInput, daysBetween } from "@veenix/shared";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}
