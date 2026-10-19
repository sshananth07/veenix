"use client";

import { useState } from "react";
import { Calculator, CheckCircle2, ChevronDown, Lightbulb, Plus, Trash2, User, Users } from "lucide-react";
import { saveBomItem } from "@/actions/bom";
import { FormDialog } from "@/components/FormDialog";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { calcBomTotal } from "@/lib/bom-math";
import { MATERIAL_UNITS, WORK_UNITS, WORK_UNIT_GROUPS } from "@/lib/types";
import { cn, formatCurrency, formatMoney2, formatNumber } from "@/lib/utils";

export type BomFormItem = {
  id: string;
  workItemId: string | null;
  workPackage: string;
  description: string | null;
  qty: number;
  unit: string;
  unitCost: number;
  performedBy: string;
  materials: { name: string; qty: number; unit: string; unitCost: number }[];
};

type MaterialRow = { name: string; qty: string; unit: string; cost: string };

const unitHint = (unit: string) => WORK_UNIT_GROUPS.flatMap((g) => g.units).find((u) => u.value === unit)?.hint;
// "Area (sq ft)": the measure and the unit together, as shown in the picker.
const unitLabel = (unit: string) => {
  const group = WORK_UNIT_GROUPS.find((g) => g.units.some((u) => u.value === unit));
  return group ? `${group.label} (${unit})` : unit;
};

export function BomFormDialog({
  projectId,
  workItems,
  item,
  defaultWorkItemId,
  hasDraftQuotation,
  inSignedQuotation,
  trigger,
}: {
  projectId: string;
  workItems: { id: string; name: string }[];
  item?: BomFormItem;
  defaultWorkItemId?: string;
  hasDraftQuotation?: boolean;
  inSignedQuotation?: boolean;
  trigger: React.ReactNode;
}) {
  const [workItemId, setWorkItemId] = useState(item?.workItemId ?? defaultWorkItemId ?? "");
  const [performedBy, setPerformedBy] = useState<"OUTSOURCED" | "SELF">(item?.performedBy === "SELF" ? "SELF" : "OUTSOURCED");
  const [unit, setUnit] = useState(item?.unit ?? "sq ft");
  const [qty, setQty] = useState(item ? String(item.qty) : "");
  const [unitCost, setUnitCost] = useState(item ? String(Math.round(item.unitCost * 100) / 100) : "");
  const [materials, setMaterials] = useState<MaterialRow[]>(
    item?.materials.length ? item.materials.map((m) => ({ name: m.name, qty: String(m.qty), unit: m.unit, cost: String(m.unitCost) })) : []
  );
  const [crew, setCrew] = useState({ workers: "", days: "", wage: "" });
  const [crewOpen, setCrewOpen] = useState(true);

  const self = performedBy === "SELF";
  const lump = unit === "lot";
  const qtyNum = lump ? 1 : Number(qty) || 0;
  const rateNum = Number(unitCost) || 0;
  const materialRows = self ? materials.map((m) => ({ ...m, qtyNum: Number(m.qty) || 0, costNum: Number(m.cost) || 0 })) : [];
  const totals = calcBomTotal({
    qty: qtyNum,
    unitCost: rateNum,
    materials: materialRows.map((m) => ({ qty: m.qtyNum, unitCost: m.costNum })),
  });
  const canSave = workItemId !== "" && qtyNum > 0 && totals.total > 0;

  const workers = Number(crew.workers) || 0;
  const days = Number(crew.days) || 0;
  const wage = Number(crew.wage) || 0;
  const crewTotal = workers * days * wage;
  const crewRate = qtyNum > 0 ? Math.round((crewTotal / qtyNum) * 100) / 100 : 0;

  const rateLabel = lump
    ? self
      ? "Labour cost, whole job (RM)"
      : "Budget, whole job (RM)"
    : self
      ? `Labour rate per ${unit} (RM)`
      : `Budget rate per ${unit} (RM)`;

  const updateMaterial = (i: number, patch: Partial<MaterialRow>) => setMaterials((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addMaterial = () =>
    setMaterials((rows) => [
      ...rows,
      { name: "", qty: qtyNum > 0 && !lump ? String(qtyNum) : "", unit: !lump && MATERIAL_UNITS.includes(unit) ? unit : "nos", cost: "" },
    ]);

  const customUnit = !WORK_UNITS.includes(unit) ? unit : null;

  return (
    <FormDialog
      trigger={trigger}
      presentation="drawer"
      title={item ? "Edit BOM line" : "Add BOM line"}
      description={
        inSignedQuotation
          ? "This line is in the signed quotation. Changing it updates your costs but not what the client signed. Use a Variation Order for scope or price changes."
          : hasDraftQuotation
            ? "The draft quotation updates automatically once this line is saved."
            : undefined
      }
      submitLabel={item ? "Save changes" : "Save BOM line"}
      action={(fd) => saveBomItem(projectId, item?.id ?? null, fd)}
      disabled={!canSave}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Work item" htmlFor="workItemId" required hint={workItems.length === 0 ? "Create a work item first" : undefined}>
          <Select name="workItemId" value={workItemId} onValueChange={setWorkItemId} required>
            <SelectTrigger id="workItemId" aria-invalid={workItemId === ""}>
              <SelectValue placeholder="Choose a work item" />
            </SelectTrigger>
            <SelectContent>
              {workItems.map((w) => (
                <SelectItem key={w.id} value={w.id}>
                  {w.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Job name" htmlFor="workPackage" required>
          <Input id="workPackage" name="workPackage" defaultValue={item?.workPackage} placeholder="e.g. Kitchen cabinets" required />
        </Field>
      </div>

      <fieldset>
        <legend className="sr-only">Who does this work</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              ["OUTSOURCED", User, "Outsourced to a vendor", "Engage a vendor for this job."],
              ["SELF", Users, "Self-performed", "Your own team will do this job."],
            ] as const
          ).map(([value, Icon, title, sub]) => {
            const selected = performedBy === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setPerformedBy(value)}
                className={cn(
                  "relative flex items-start gap-3 rounded-xl border p-4 text-left transition-colors",
                  selected ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/50"
                )}
              >
                <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full", selected ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")}>
                  <Icon className="h-5 w-5" />
                </span>
                <span className="min-w-0 pr-6">
                  <span className="block text-sm font-semibold">{title}</span>
                  <span className="block text-xs text-muted-foreground">{sub}</span>
                </span>
                <span className={cn("absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full border-2", selected ? "border-primary" : "border-muted-foreground/40")}>
                  {selected && <span className="h-2.5 w-2.5 rounded-full bg-primary" />}
                </span>
              </button>
            );
          })}
        </div>
        <input type="hidden" name="performedBy" value={performedBy} />
      </fieldset>

      <div className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Quantity" htmlFor="qty" required>
            <Input
              id="qty"
              name="qty"
              type="number"
              min={0}
              step="any"
              value={lump ? "1" : qty}
              readOnly={lump}
              onChange={(e) => setQty(e.target.value)}
              placeholder="e.g. 200"
              required
              className={lump ? "bg-muted text-muted-foreground" : undefined}
            />
          </Field>
          <Field label="Measured in" htmlFor="unit" required>
            <Select
              name="unit"
              value={unit}
              onValueChange={(v) => {
                setUnit(v);
                if (v === "lot") setQty("1");
              }}
            >
              <SelectTrigger id="unit">
                <SelectValue>{unitLabel(unit)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {customUnit && (
                  <SelectGroup>
                    <SelectLabel>Current value</SelectLabel>
                    <SelectItem value={customUnit}>{customUnit}</SelectItem>
                  </SelectGroup>
                )}
                {WORK_UNIT_GROUPS.map((g) => (
                  <SelectGroup key={g.label}>
                    <SelectLabel>{g.label}</SelectLabel>
                    {g.units.map((u) => (
                      <SelectItem key={u.value} value={u.value}>
                        {u.value}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={rateLabel} htmlFor="unitCost" required>
            <Input
              id="unitCost"
              name="unitCost"
              type="number"
              min={0}
              step="any"
              value={unitCost}
              onChange={(e) => setUnitCost(e.target.value)}
              placeholder={lump ? "e.g. 7280" : "e.g. 4.50"}
              required
            />
          </Field>
        </div>
        {customUnit ? (
          <p className="-mt-2 text-xs text-amber-700">&quot;{customUnit}&quot; is not a standard unit. Pick one from the list so quantities stay meaningful.</p>
        ) : (
          unitHint(unit) && <p className="-mt-2 text-xs text-muted-foreground">{unitHint(unit)}</p>
        )}

        <div className="flex items-center gap-3 rounded-lg bg-primary/5 px-4 py-2.5 text-sm">
          <Calculator className="h-4 w-4 shrink-0 text-primary" />
          <span className="tabular-nums text-muted-foreground">
            <span className="font-medium text-foreground">Formula:</span>{" "}
            {lump ? "Lump sum" : `${formatNumber(qtyNum)} ${unit} × ${formatMoney2(rateNum)}`} = <span className="font-semibold text-foreground">{formatCurrency(totals.base)}</span>
          </span>
        </div>
      </div>

      {self && !lump && (
        <section className="rounded-xl border">
          <button type="button" className="flex w-full items-center gap-3 px-4 py-3.5 text-left" onClick={() => setCrewOpen((o) => !o)} aria-expanded={crewOpen}>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <CheckCircle2 className="h-5 w-5" />
            </span>
            <span className="flex-1">
              <span className="block text-sm font-semibold">Labour cost helper</span>
              <span className="block text-xs text-muted-foreground">Work out the labour rate from workers × days × daily wage.</span>
            </span>
            <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", crewOpen && "rotate-180")} />
          </button>
          {crewOpen && (
            <div className="grid gap-3 border-t px-4 py-4">
              <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_1.1fr]">
                <Field label="Workers" htmlFor="crewWorkers">
                  <Input id="crewWorkers" type="number" min={0} step="any" value={crew.workers} onChange={(e) => setCrew({ ...crew, workers: e.target.value })} placeholder="e.g. 2" />
                </Field>
                <Field label="Days" htmlFor="crewDays">
                  <Input id="crewDays" type="number" min={0} step="any" value={crew.days} onChange={(e) => setCrew({ ...crew, days: e.target.value })} placeholder="e.g. 5" />
                </Field>
                <Field label="Daily wage (RM)" htmlFor="crewWage">
                  <Input id="crewWage" type="number" min={0} step="any" value={crew.wage} onChange={(e) => setCrew({ ...crew, wage: e.target.value })} placeholder="e.g. 90" />
                </Field>
                <div className="rounded-lg bg-primary/5 px-3 py-2">
                  <div className="text-[11px] text-muted-foreground">Labour cost</div>
                  <div className="text-lg font-semibold tabular-nums">{formatCurrency(crewTotal)}</div>
                  <div className="text-[11px] tabular-nums text-muted-foreground">
                    {workers} × {days} × {wage}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground tabular-nums">
                  {crewTotal > 0 ? (qtyNum > 0 ? `Spread over ${formatNumber(qtyNum)} ${unit} that is ${formatMoney2(crewRate)} per ${unit}.` : "Enter the quantity above to get a rate.") : "Fill in the crew to get a suggested rate."}
                </span>
                <Button type="button" size="sm" variant="outline" disabled={crewRate <= 0} onClick={() => setUnitCost(String(crewRate))}>
                  Use {formatMoney2(crewRate)} per {unit}
                </Button>
              </div>
            </div>
          )}
        </section>
      )}

      {self && (
        <section className="rounded-xl border">
          <div className="flex items-center justify-between gap-3 px-4 py-3.5">
            <div>
              <h3 className="text-sm font-semibold">Materials</h3>
              <p className="text-xs text-muted-foreground">What you buy for this job. Add wastage to the quantity (5 to 10% for tiles).</p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={addMaterial}>
              <Plus className="h-3.5 w-3.5" />
              Add material
            </Button>
          </div>
          {materials.length > 0 && (
            <div className="border-t">
              <div className="hidden grid-cols-[1.7fr_0.7fr_0.95fr_0.95fr_0.85fr_28px] gap-2 bg-muted/40 px-4 py-2 text-[11px] font-medium text-muted-foreground sm:grid">
                <span>Name</span>
                <span>Qty</span>
                <span>Unit</span>
                <span>Cost per unit (RM)</span>
                <span className="text-right">Total (RM)</span>
                <span />
              </div>
              <div className="divide-y">
                {materials.map((m, i) => {
                  const rowTotal = Math.round((Number(m.qty) || 0) * (Number(m.cost) || 0));
                  const units = MATERIAL_UNITS.includes(m.unit) ? MATERIAL_UNITS : [m.unit, ...MATERIAL_UNITS];
                  return (
                    <div key={i} className="grid grid-cols-2 items-center gap-2 px-4 py-2.5 sm:grid-cols-[1.7fr_0.7fr_0.95fr_0.95fr_0.85fr_28px]">
                      <Input name="matName" aria-label="Material name" value={m.name} onChange={(e) => updateMaterial(i, { name: e.target.value })} placeholder="e.g. Porcelain tiles" className="col-span-2 h-9 sm:col-span-1" />
                      <Input name="matQty" aria-label="Material quantity" type="number" min={0} step="any" value={m.qty} onChange={(e) => updateMaterial(i, { qty: e.target.value })} placeholder="220" className="h-9" />
                      <Select name="matUnit" value={m.unit} onValueChange={(v) => updateMaterial(i, { unit: v })}>
                        <SelectTrigger aria-label="Material unit" className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {units.map((u) => (
                            <SelectItem key={u} value={u}>
                              {u}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input name="matCost" aria-label="Material cost per unit" type="number" min={0} step="any" value={m.cost} onChange={(e) => updateMaterial(i, { cost: e.target.value })} placeholder="5.00" className="h-9" />
                      <span className="text-right text-sm tabular-nums">{formatMoney2(rowTotal)}</span>
                      <button
                        type="button"
                        aria-label="Remove material"
                        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-red-50 hover:text-red-600"
                        onClick={() => setMaterials((rows) => rows.filter((_, idx) => idx !== i))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center justify-between border-t bg-muted/30 px-4 py-2.5 text-sm">
                <span className="text-muted-foreground">Materials total</span>
                <span className="font-semibold tabular-nums">{formatCurrency(totals.materials)}</span>
              </div>
            </div>
          )}
        </section>
      )}

      <section className="rounded-xl border px-4 py-3.5">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Calculator className="h-5 w-5" />
          </span>
          <h3 className="text-sm font-semibold">{self ? "Direct cost breakdown" : "Budget"}</h3>
        </div>
        <dl className="mt-3 grid gap-1.5 text-sm tabular-nums">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{self ? "Labour cost" : "Budget estimate"}</dt>
            <dd>{formatCurrency(totals.base)}</dd>
          </div>
          {self && (
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Materials cost</dt>
              <dd>{formatCurrency(totals.materials)}</dd>
            </div>
          )}
          <div className="mt-1 flex items-baseline justify-between border-t pt-2">
            <dt className="font-medium">{self ? "Total direct cost" : "Total budget"}</dt>
            <dd className="text-lg font-semibold">{formatCurrency(totals.total)}</dd>
          </div>
        </dl>
      </section>

      <Field label="Spec / notes" htmlFor="description" hint={self ? undefined : "Brand, finish, size. For outsourced work this goes on the RFQ."}>
        <Textarea id="description" name="description" defaultValue={item?.description ?? ""} rows={2} placeholder="e.g. Water-proof, navy green finish" />
      </Field>

      <details className="group rounded-xl border">
        <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3.5 [&::-webkit-details-marker]:hidden">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
            <Lightbulb className="h-5 w-5" />
          </span>
          <span className="flex-1">
            <span className="block text-sm font-semibold">Worked example</span>
            <span className="block text-xs text-muted-foreground">See how the calculation is done.</span>
          </span>
          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <div className="grid gap-4 border-t px-4 py-4 text-xs text-muted-foreground">
          <div>
            <p className="font-medium text-foreground">Tiling a 200 sq ft hall (own crew)</p>
            <ul className="mt-1 space-y-0.5">
              <li>Labour: 200 sq ft × RM 4.50 = RM 900</li>
              <li>Tiles: 220 sq ft (200 + 10% wastage) × RM 5.00 = RM 1,100</li>
              <li>Adhesive: 8 bags × RM 22 = RM 176</li>
              <li>Grout: 4 kg × RM 12 = RM 48</li>
              <li className="font-medium text-foreground">Direct cost RM 2,224. At 40% markup the client pays RM 3,114 (RM 15.57 per sq ft).</li>
            </ul>
          </div>
          <div>
            <p className="font-medium text-foreground">Painting 1,200 sq ft of walls (own crew)</p>
            <ul className="mt-1 space-y-0.5">
              <li>Labour: 1,200 sq ft × RM 1.20 = RM 1,440</li>
              <li>Paint: 6 pails × RM 165 = RM 990</li>
              <li>Putty and sealer: 1 lot × RM 260 = RM 260</li>
              <li className="font-medium text-foreground">Direct cost RM 2,690.</li>
            </ul>
          </div>
          <div>
            <p className="font-medium text-foreground">Kitchen cabinets (outsourced)</p>
            <p className="mt-1">
              Measured by length along the wall, so use <span className="font-medium text-foreground">ft run</span>: 14 ft run × RM 520 = RM 7,280 as your budget. Or choose{" "}
              <span className="font-medium text-foreground">lot</span> and enter one lump sum. Either way the vendor&apos;s accepted quote replaces the budget.
            </p>
          </div>
        </div>
      </details>
    </FormDialog>
  );
}
