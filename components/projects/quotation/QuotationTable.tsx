"use client";

import { useState } from "react";
import { AlertTriangle, ChevronDown, Pencil } from "lucide-react";
import type { ProjectDetail } from "@/lib/projectQuery";
import { unitPrice } from "@/lib/quotation";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";
import { LineMarkupDialog } from "@/components/projects/quotation/QuotationDialogs";

type Line = ProjectDetail["quotations"][number]["lineItems"][number];
type Group = { name: string; lines: Line[]; subtotal: number; cost: number };

// "RM 1,400" -> "1,400": the column header already says (RM), so the RM
// prefix would just repeat itself on every row.
const num = (v: number) => formatCurrency(v).replace(/^RM\s*/, "");

export function QuotationTable({
  groups,
  clientView,
  editable,
  minMarkupPct,
}: {
  groups: Group[];
  clientView: boolean;
  editable: boolean;
  minMarkupPct: number;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  return (
    <div className="overflow-x-auto">
      <table className={cn("w-full text-sm", clientView ? "min-w-[560px]" : "min-w-[920px]")}>
        <thead>
          <tr className="border-b text-left text-xs font-medium text-muted-foreground">
            <th className="w-8 px-3 py-2.5" />
            <th className="px-2 py-2.5 font-medium">Item</th>
            <th className="px-2 py-2.5 font-medium">Qty</th>
            {!clientView && <th className="px-2 py-2.5 font-medium">Your cost (RM)</th>}
            {!clientView && <th className="px-2 py-2.5 font-medium">Markup</th>}
            <th className="px-2 py-2.5 font-medium">Unit price (RM)</th>
            <th className="px-2 py-2.5 font-medium">Amount (RM)</th>
            {!clientView && <th className="px-2 py-2.5 font-medium">Profit (RM / %)</th>}
            {editable && <th className="w-10 px-3 py-2.5" />}
          </tr>
        </thead>
        {groups.map((g) => {
          const isCollapsed = collapsed[g.name];
          const cols = 3 + (clientView ? 0 : 3) + (editable ? 1 : 0);
          return (
            <tbody key={g.name} className="border-b last:border-b-0">
              <tr>
                <td colSpan={cols} className="p-0">
                  <button
                    type="button"
                    onClick={() => setCollapsed((c) => ({ ...c, [g.name]: !c[g.name] }))}
                    aria-expanded={!isCollapsed}
                    className="flex w-full items-center gap-2 bg-primary/5 px-3 py-2.5 text-left transition-colors hover:bg-primary/10"
                  >
                    <ChevronDown className={cn("h-4 w-4 shrink-0 text-primary transition-transform", isCollapsed && "-rotate-90")} />
                    <span className="flex-1 text-sm font-semibold">{g.name}</span>
                    <span className="text-sm font-semibold tabular-nums">Subtotal: {formatCurrency(g.subtotal)}</span>
                  </button>
                </td>
              </tr>
              {!isCollapsed &&
                g.lines.map((l) => {
                  const profit = l.clientPrice - l.bomCost;
                  const profitPct = l.clientPrice > 0 ? Math.round((profit / l.clientPrice) * 100) : 0;
                  const low = l.markupPct < minMarkupPct;
                  return (
                    <tr key={l.id} className="border-t border-dashed">
                      <td />
                      <td className="px-2 py-2.5 pl-2">{l.workPackage}</td>
                      <td className="px-2 py-2.5 tabular-nums text-muted-foreground">
                        {formatNumber(l.qty)} {l.unit}
                      </td>
                      {!clientView && <td className="px-2 py-2.5 tabular-nums text-muted-foreground">{num(l.bomCost)}</td>}
                      {!clientView && (
                        <td className="px-2 py-2.5 tabular-nums">
                          <span className="inline-flex items-center gap-1.5">
                            {low && (
                              <span title={`Below your minimum markup of ${minMarkupPct}%`} className="text-amber-600">
                                <AlertTriangle className="h-3.5 w-3.5" />
                              </span>
                            )}
                            {l.markupPct}%
                          </span>
                        </td>
                      )}
                      <td className="px-2 py-2.5 tabular-nums text-muted-foreground">{num(unitPrice(l.clientPrice, l.qty))}</td>
                      <td className="px-2 py-2.5 font-medium tabular-nums">{num(l.clientPrice)}</td>
                      {!clientView && (
                        <td className="px-2 py-2.5 tabular-nums">
                          {num(profit)} <span className="text-muted-foreground">({profitPct}%)</span>
                        </td>
                      )}
                      {editable && (
                        <td className="px-3 py-2.5 text-right">
                          <LineMarkupDialog
                            lineId={l.id}
                            workPackage={l.workPackage}
                            cost={l.bomCost}
                            markupPct={l.markupPct}
                            trigger={
                              <button className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Edit markup for ${l.workPackage}`} title="Edit markup">
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                            }
                          />
                        </td>
                      )}
                    </tr>
                  );
                })}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}
