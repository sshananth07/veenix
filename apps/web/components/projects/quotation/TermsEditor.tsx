"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TERM_TEMPLATES, allocate, type TermRow } from "@/lib/paymentTerms";
import { cn, formatCurrency } from "@/lib/utils";

export type TermFormRow = { name: string; trigger: string; pct: string };

export const emptyTerm = (): TermFormRow => ({ name: "", trigger: "", pct: "" });
export const toFormRows = (rows: TermRow[]): TermFormRow[] => rows.map((r) => ({ name: r.name, trigger: r.trigger, pct: String(r.pct) }));
export const termsSum = (rows: TermFormRow[]) => rows.reduce((s, r) => s + (Number(r.pct) || 0), 0);

// Rows of "what triggers the payment" and its share of the contract sum.
// Controlled by the parent so it can block saving until the terms hit 100%.
export function TermsEditor({
  rows,
  setRows,
  total,
}: {
  rows: TermFormRow[];
  setRows: (rows: TermFormRow[]) => void;
  total: number;
}) {
  const sum = termsSum(rows);
  // Only true-up the last row's rounding once the terms are complete; while
  // editing, each row just shows its own share.
  const pcts = rows.map((r) => ({ pct: Number(r.pct) || 0 }));
  const amounts = sum === 100 ? allocate(total, pcts) : pcts.map((r) => Math.round((total * r.pct) / 100));
  const update = (i: number, patch: Partial<TermFormRow>) => setRows(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">Start from</span>
        {TERM_TEMPLATES.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setRows(toFormRows(t.rows))}
            className="rounded-full border bg-card px-3 py-1 text-xs transition-colors hover:border-primary hover:text-primary"
            title={t.hint}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="grid gap-2">
        <div className="hidden grid-cols-[1fr_1.4fr_76px_104px_32px] gap-2 text-xs font-medium text-muted-foreground sm:grid">
          <span>Payment</span>
          <span>When it is due</span>
          <span>%</span>
          <span className="text-right">Amount</span>
          <span />
        </div>
        {rows.map((row, i) => (
          <div key={i} className="grid grid-cols-[1fr_76px_32px] items-center gap-2 sm:grid-cols-[1fr_1.4fr_76px_104px_32px]">
            <Input
              name="termName"
              aria-label={`Payment ${i + 1} name`}
              value={row.name}
              onChange={(e) => update(i, { name: e.target.value })}
              placeholder={i === 0 ? "Deposit" : "Progress payment"}
              className="col-span-3 sm:col-span-1"
            />
            <Input
              name="termTrigger"
              aria-label={`Payment ${i + 1} trigger`}
              value={row.trigger}
              onChange={(e) => update(i, { trigger: e.target.value })}
              placeholder={i === 0 ? "On acceptance of quotation" : "On completion of tiling"}
              className="col-span-3 sm:col-span-1"
            />
            <Input
              name="termPct"
              aria-label={`Payment ${i + 1} percentage`}
              type="number"
              min={1}
              max={100}
              value={row.pct}
              onChange={(e) => update(i, { pct: e.target.value })}
              placeholder="30"
            />
            <span className="text-right text-sm tabular-nums text-muted-foreground">{formatCurrency(amounts[i] ?? 0)}</span>
            <button
              type="button"
              aria-label="Remove payment"
              disabled={rows.length === 1}
              className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
              onClick={() => setRows(rows.filter((_, idx) => idx !== i))}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <Button type="button" variant="outline" size="sm" onClick={() => setRows([...rows, emptyTerm()])}>
          <Plus className="h-3.5 w-3.5" />
          Add payment
        </Button>
        <span className={cn("text-sm font-medium tabular-nums", sum === 100 ? "text-emerald-700" : "text-amber-700")}>
          {sum}% of 100%
          {sum !== 100 && (sum > 100 ? ` (${sum - 100}% over)` : ` (${100 - sum}% left)`)}
        </span>
      </div>
    </div>
  );
}
