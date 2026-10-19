"use client";

import { useState } from "react";
import { ChevronRight, Pencil, Trash2 } from "lucide-react";
import { deleteBomItem } from "@/actions/bom";
import { FormDialog } from "@/components/FormDialog";
import { BOM_GRID } from "@/components/projects/bom/grid";
import { BomFormDialog } from "@/components/projects/bom/BomFormDialog";
import { WORK_UNITS } from "@/lib/types";
import { cn, formatCurrency, formatMoney2, formatNumber } from "@/lib/utils";

export type BomRowData = {
  id: string;
  workItemId: string | null;
  workPackage: string;
  description: string | null;
  qty: number;
  unit: string;
  unitCost: number;
  estTotal: number;
  performedBy: string;
  materials: { id: string; name: string; qty: number; unit: string; unitCost: number; total: number }[];
};


const iconButton =
  "flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40";

export function BomRow({
  bom,
  cost,
  source,
  locked,
  inSigned,
  hasDraft,
  projectId,
  workItems,
}: {
  bom: BomRowData;
  cost: number;
  source: "PO" | "SELF" | "ESTIMATE" | undefined;
  locked: boolean;
  inSigned: boolean;
  hasDraft: boolean;
  projectId: string;
  workItems: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const self = bom.performedBy === "SELF";
  const materialsTotal = bom.materials.reduce((s, m) => s + m.total, 0);
  const labour = bom.estTotal - materialsTotal;
  const lump = bom.unit === "lot";

  return (
    <li className="px-4 py-3.5">
      <div className={cn("grid items-center gap-x-4 gap-y-2", BOM_GRID)}>
        <div className="min-w-0">
          <div className="font-medium">{bom.workPackage}</div>
          {bom.description && <p className="truncate text-xs text-muted-foreground">{bom.description}</p>}
        </div>

        <div>
          <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium", self ? "bg-emerald-100 text-emerald-800" : "bg-blue-100 text-blue-800")}>
            {self ? "Self-performed" : "Outsourced"}
          </span>
        </div>

        <div className="text-sm tabular-nums">
          {lump ? (
            "Lump sum"
          ) : (
            <>
              {formatNumber(bom.qty)} {bom.unit} × {formatMoney2(bom.unitCost)} per {bom.unit}
              {!WORK_UNITS.includes(bom.unit) && (
                <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-800" title="Not a standard unit. Edit the line and pick what the quantity is measured in.">
                  Check unit
                </span>
              )}
            </>
          )}
        </div>

        <div className="text-sm font-semibold tabular-nums">{formatCurrency(cost)}</div>

        <div className="text-sm tabular-nums text-muted-foreground">
          {self ? (
            bom.materials.length > 0 ? (
              `${formatCurrency(labour)} + ${formatCurrency(materialsTotal)}`
            ) : (
              `${formatCurrency(labour)} labour only`
            )
          ) : source === "PO" ? (
            <span className="text-emerald-700">Awarded to vendor</span>
          ) : (
            "Awaiting vendor quote"
          )}
        </div>

        <div className="flex items-center justify-end gap-1">
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="mr-1 inline-flex items-center gap-0.5 whitespace-nowrap text-xs font-medium text-primary hover:underline">
            Show calculation
            <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-90")} />
          </button>
          <BomFormDialog
            projectId={projectId}
            workItems={workItems}
            hasDraftQuotation={hasDraft}
            inSignedQuotation={inSigned}
            item={{
              id: bom.id,
              workItemId: bom.workItemId,
              workPackage: bom.workPackage,
              description: bom.description,
              qty: bom.qty,
              unit: bom.unit,
              unitCost: bom.unitCost,
              performedBy: bom.performedBy,
              materials: bom.materials.map((m) => ({ name: m.name, qty: m.qty, unit: m.unit, unitCost: m.unitCost })),
            }}
            trigger={
              <button className={iconButton} aria-label={`Edit ${bom.workPackage}`} title="Edit BOM line">
                <Pencil className="h-4 w-4" />
              </button>
            }
          />
          <FormDialog
            destructive
            title={`Delete "${bom.workPackage}"?`}
            description="It is removed from the BOM and from the draft quotation."
            submitLabel="Delete line"
            pendingLabel="Deleting..."
            action={deleteBomItem.bind(null, bom.id)}
            trigger={
              <button
                className={cn(iconButton, "hover:bg-red-50 hover:text-red-600")}
                aria-label={`Delete ${bom.workPackage}`}
                disabled={locked}
                title={locked ? "Has a purchase order, so it can't be deleted" : "Delete BOM line"}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            }
          />
        </div>
      </div>

      {open && (
        <dl className="mt-3 grid max-w-xl gap-1 rounded-lg bg-muted/40 px-4 py-3 text-xs tabular-nums">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">
              {self ? "Labour" : "Budget estimate"}
              {!lump && (
                <>
                  {" "}
                  ({formatNumber(bom.qty)} {bom.unit} × {formatMoney2(bom.unitCost)})
                </>
              )}
            </dt>
            <dd>{formatCurrency(labour)}</dd>
          </div>
          {bom.materials.map((m) => (
            <div key={m.id} className="flex justify-between gap-4">
              <dt className="text-muted-foreground">
                {m.name} ({formatNumber(m.qty)} {m.unit} × {formatMoney2(m.unitCost)})
              </dt>
              <dd>{formatCurrency(m.total)}</dd>
            </div>
          ))}
          <div className="flex justify-between gap-4 border-t pt-1.5 font-medium">
            <dt>{self ? "Direct cost" : source === "PO" ? "Awarded vendor price" : "Budget"}</dt>
            <dd>{formatCurrency(cost)}</dd>
          </div>
        </dl>
      )}
    </li>
  );
}
