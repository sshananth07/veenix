import { ArrowDownToLine, Check, CheckCircle2, ExternalLink, FileText, Pencil, Store, TriangleAlert } from "lucide-react";
import type { ProjectDetail } from "@/lib/projectQuery";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { AttachInvoiceDialog, EditTermsDialog, RecordPaymentDialog } from "@/components/projects/vendors/VendorDialogs";
import { SendDocumentButtons } from "@/components/SendDocumentButtons";

type Bom = ProjectDetail["bomItems"][number];
type Rfq = ProjectDetail["rfqs"][number];
type Po = ProjectDetail["purchaseOrders"][number];

const MILESTONE_STATUS: Record<string, { label: string; pill: string }> = {
  PENDING: { label: "Awaiting invoice", pill: "bg-amber-100 text-amber-800" },
  INVOICED: { label: "Invoice in", pill: "bg-blue-100 text-blue-800" },
  PAID: { label: "Paid", pill: "bg-emerald-100 text-emerald-800" },
};

export function AwardedVendors({ items }: { items: { bom: Bom; rfq: Rfq | undefined; po: Po }[] }) {
  return (
    <div className="space-y-4">
      {items.map(({ bom, rfq, po }) => {
        const paid = po.milestones.filter((m) => m.status === "PAID").reduce((s, m) => s + (m.paidAmount ?? 0), 0);
        const fullyPaid = po.milestones.length > 0 && po.milestones.every((m) => m.status === "PAID");
        const over = po.amount > bom.estTotal;
        const diff = Math.abs(po.amount - bom.estTotal);
        const status = over ? { label: "Over budget", pill: "bg-red-100 text-red-800" } : fullyPaid ? { label: "Fully paid", pill: "bg-emerald-100 text-emerald-800" } : { label: "On track", pill: "bg-emerald-100 text-emerald-800" };

        return (
          <article key={po.id} id={`pkg-${bom.id}`} className="scroll-mt-24 grid overflow-hidden rounded-xl border bg-card shadow-sm lg:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)]">
            <div className="space-y-4 p-5 lg:border-r">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Store className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <div className="truncate font-semibold">{po.vendor.name}</div>
                  <div className="truncate text-sm text-muted-foreground">{bom.workPackage}</div>
                </div>
              </div>

              <div>
                <div className="text-xs text-muted-foreground">PO #{po.code}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-2">
                  <span className="text-2xl font-bold tabular-nums">{formatCurrency(po.amount)}</span>
                  <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", status.pill)}>{status.label}</span>
                </div>
                <div className={cn("mt-1 flex items-center gap-1.5 text-xs", over ? "text-red-700" : "text-emerald-700")}>
                  {over ? <TriangleAlert className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                  {over ? `${formatCurrency(diff)} over budget` : diff > 0 ? `Within budget, ${formatCurrency(diff)} under` : "On budget"}
                </div>
                {po.deliveryBy && <div className="mt-1 text-xs text-muted-foreground">Due {formatDate(po.deliveryBy)}</div>}
                {po.remarks && <p className="mt-2 text-xs text-muted-foreground">{po.remarks}</p>}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button variant="outline" size="sm" asChild>
                  <a href={`/api/documents/po/${po.id}`} target="_blank" rel="noreferrer">
                    <FileText className="h-3.5 w-3.5" />
                    PO PDF
                  </a>
                </Button>
                <SendDocumentButtons type="po" id={po.id} defaultEmail={po.vendor.email} defaultPhone={po.vendor.phone} />
                {rfq && rfq.quotes.length > 0 && (
                  <details className="text-xs">
                    <summary className="cursor-pointer font-medium text-muted-foreground hover:text-foreground">RFQs and quotes ({rfq.quotes.length})</summary>
                    <ul className="mt-2 space-y-1.5">
                      {rfq.quotes.map((q) => (
                        <li key={q.id} className="flex items-center justify-between gap-3">
                          <span className={q.selected ? "font-medium" : "text-muted-foreground"}>
                            {q.vendor.name}
                            {q.selected ? " (accepted)" : ""}
                          </span>
                          <span className="flex items-center gap-2.5 tabular-nums text-muted-foreground">
                            <a href={`/api/documents/rfq/${rfq.id}?vendorId=${q.vendorId}&download=1`} className="text-primary hover:underline">
                              RFQ
                            </a>
                            {q.attachmentPath && (
                              <a href={`/api/uploads/quote/${q.id}`} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                                Quote
                              </a>
                            )}
                            {q.receivedAt ? formatCurrency(q.quotedPrice) : "No quote"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            </div>

            <div className="bg-muted/10 p-5">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h4 className="text-sm font-semibold">Payment milestones</h4>
                {po.milestones.length > 0 && (
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {formatCurrency(paid)} paid of {formatCurrency(po.amount)}
                  </span>
                )}
              </div>

              {po.milestones.length === 0 ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed bg-card px-4 py-4">
                  <p className="text-sm text-muted-foreground">No payment terms yet. Set them to track each vendor invoice and payment.</p>
                  <EditTermsDialog poId={po.id} poCode={po.code} amount={po.amount} terms={[]} trigger={<Button size="sm">Set payment terms</Button>} />
                </div>
              ) : (
                <>
                  <ul className="divide-y rounded-lg border bg-card">
                    {po.milestones.map((m) => {
                      const st = MILESTONE_STATUS[m.status] ?? MILESTONE_STATUS.PENDING;
                      return (
                        <li key={m.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                          <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2", m.status === "PAID" ? "border-emerald-500 bg-emerald-500 text-white" : m.status === "INVOICED" ? "border-blue-500" : "border-muted-foreground/40")}>
                            {m.status === "PAID" && <Check className="h-3 w-3" strokeWidth={3} />}
                          </span>
                          <div className="min-w-[140px] flex-1">
                            <div className="text-sm font-medium">
                              <span className="tabular-nums">{m.pct}%</span> {m.label}
                            </div>
                            {m.status === "PAID" ? (
                              <div className="text-xs text-muted-foreground">
                                Paid {formatDate(m.paidDate)}
                                {m.method ? ` · ${m.method}` : ""}
                                {m.bankRef ? ` · ${m.bankRef}` : ""}
                              </div>
                            ) : (
                              m.invoiceNo && <div className="text-xs text-muted-foreground">Invoice {m.invoiceNo}</div>
                            )}
                          </div>
                          <span className="w-24 text-right text-sm font-semibold tabular-nums">{formatCurrency(m.amount)}</span>
                          <span className={cn("w-32 rounded-full px-2.5 py-0.5 text-center text-xs font-medium", st.pill)}>{st.label}</span>
                          <div className="flex min-w-[150px] items-center justify-end gap-1.5">
                            {m.invoicePath && (
                              <a href={`/api/uploads/invoice/${m.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                                <ExternalLink className="h-3 w-3" />
                                View invoice
                              </a>
                            )}
                            {m.status === "PENDING" && (
                              <AttachInvoiceDialog
                                milestone={m}
                                vendorName={po.vendor.name}
                                trigger={
                                  <Button size="sm" variant="outline">
                                    <ArrowDownToLine className="h-3.5 w-3.5" />
                                    Attach invoice
                                  </Button>
                                }
                              />
                            )}
                            {m.status === "INVOICED" && (
                              <>
                                <AttachInvoiceDialog
                                  milestone={m}
                                  vendorName={po.vendor.name}
                                  trigger={
                                    <button className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted" aria-label="Edit invoice" title="Edit invoice">
                                      <Pencil className="h-4 w-4" />
                                    </button>
                                  }
                                />
                                <RecordPaymentDialog milestone={m} payee={po.vendor.name} trigger={<Button size="sm">Record payment</Button>} />
                              </>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  {po.milestones.every((m) => m.status === "PENDING") && (
                    <div className="mt-2 text-right">
                      <EditTermsDialog
                        poId={po.id}
                        poCode={po.code}
                        amount={po.amount}
                        terms={po.milestones.map((m) => ({ label: m.label, pct: m.pct }))}
                        trigger={<button className="text-xs font-medium text-primary hover:underline">Edit payment terms</button>}
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
