"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { allocate } from "@/lib/paymentTerms";
import { cn, formatCurrency } from "@/lib/utils";

type Row = { label: string; pct: string };

const TEMPLATE: Row[] = [
  { label: "Deposit", pct: "30" },
  { label: "On completion", pct: "70" },
];

// Vendor payment terms: a numbered table of term, percentage and computed
// amount. Each row becomes a payment milestone on the purchase order.
export function PaymentTermsEditor({ amount, initial }: { amount: number; initial?: { label: string; pct: number }[] }) {
  const [rows, setRows] = useState<Row[]>(
    initial && initial.length > 0 ? initial.map((r) => ({ label: r.label, pct: String(r.pct) })) : [{ label: "", pct: "" }]
  );
  const total = rows.reduce((s, r) => s + (Number(r.pct) || 0), 0);
  const balanced = total === 100;
  const pcts = rows.map((r) => ({ pct: Number(r.pct) || 0 }));
  // Only true up the last row's rounding once the terms are complete.
  const amounts = balanced ? allocate(amount, pcts) : pcts.map((r) => Math.round((amount * r.pct) / 100));
  const allocated = amounts.reduce((s, a) => s + a, 0);

  const update = (i: number, patch: Partial<Row>) => setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  return (
    <div className="grid gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">Payment terms</h3>
          <p className="text-sm text-muted-foreground">Total must equal 100%</p>
        </div>
        <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => setRows(TEMPLATE)}>
          Use 30% deposit, 70% completion
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border">
        <div className="grid grid-cols-[28px_1fr_72px_110px_32px] gap-2 bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
          <span>#</span>
          <span>Payment term</span>
          <span>%</span>
          <span>Amount (RM)</span>
          <span />
        </div>
        <div className="divide-y">
          {rows.map((row, i) => (
            <div key={i} className="grid grid-cols-[28px_1fr_72px_110px_32px] items-center gap-2 px-3 py-2.5">
              <span className="text-sm text-muted-foreground">{i + 1}</span>
              <Input
                name="termLabel"
                aria-label={`Term ${i + 1} name`}
                value={row.label}
                onChange={(e) => update(i, { label: e.target.value })}
                placeholder={i === 0 ? "e.g. Deposit" : "e.g. Delivery"}
                className="h-9"
              />
              <Input
                name="termPct"
                aria-label={`Term ${i + 1} percentage`}
                type="number"
                min={1}
                max={100}
                value={row.pct}
                onChange={(e) => update(i, { pct: e.target.value })}
                placeholder="30"
                className="h-9"
              />
              <span className="flex h-9 items-center justify-end rounded-md border bg-muted/40 px-3 text-sm tabular-nums">{formatCurrency(amounts[i] ?? 0).replace("RM ", "")}</span>
              <button
                type="button"
                aria-label="Remove term"
                disabled={rows.length === 1}
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                onClick={() => setRows((prev) => prev.filter((_, idx) => idx !== i))}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
        <div className="border-t px-3 py-2.5">
          <Button type="button" variant="outline" size="sm" onClick={() => setRows((prev) => [...prev, { label: "", pct: "" }])}>
            <Plus className="h-3.5 w-3.5" />
            Add payment term
          </Button>
        </div>
        <div className="flex items-center justify-between border-t bg-muted/30 px-3 py-2.5 text-sm">
          <span className="text-muted-foreground">Total</span>
          <span className="flex items-center gap-6 tabular-nums">
            <span className={cn("font-semibold", balanced ? "text-emerald-700" : "text-amber-700")}>
              {total}%{!balanced && (total > 100 ? ` (${total - 100}% over)` : ` (${100 - total}% left)`)}
            </span>
            <span className="font-semibold">{formatCurrency(balanced ? amount : allocated)}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
