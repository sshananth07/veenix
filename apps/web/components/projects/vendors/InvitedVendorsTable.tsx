import { Download, ExternalLink, History, Paperclip, Pencil, Plus, RefreshCw, X } from "lucide-react";
import type { ProjectDetail } from "@/lib/projectQuery";
import { removeVendorRequest } from "@/actions/vendors";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { FormDialog } from "@/components/FormDialog";
import { Button } from "@/components/ui/button";
import { AcceptQuoteDialog, QuoteReceivedDialog, RequestQuotesDialog, RevisedQuoteDialog } from "@/components/projects/vendors/VendorDialogs";
import { SendDocumentButtons } from "@/components/SendDocumentButtons";

type Bom = ProjectDetail["bomItems"][number];
type Rfq = ProjectDetail["rfqs"][number];
type Vendor = { id: string; name: string; type: string | null; jobsCount: number };

export const warrantyLabel = (months: number) => {
  if (months <= 0) return "-";
  if (months % 12 === 0) return `${months / 12} ${months === 12 ? "year" : "years"}`;
  return `${months} months`;
};

// Every package that has RFQs out but no vendor awarded yet, one block per
// package, one row per invited vendor.
export function InvitedVendorsTable({ items, vendors }: { items: { bom: Bom; rfq: Rfq }[]; vendors: Vendor[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border bg-card shadow-xs">
      <table className="w-full min-w-[1080px] text-sm">
        <thead>
          <tr className="border-b bg-muted/30 text-left text-xs font-medium text-muted-foreground">
            <th className="px-5 py-3 font-medium">Vendor</th>
            <th className="px-3 py-3 font-medium">RFQ</th>
            <th className="px-3 py-3 font-medium">Quote amount</th>
            <th className="px-3 py-3 font-medium">Lead time</th>
            <th className="px-3 py-3 font-medium">Warranty</th>
            <th className="px-3 py-3 font-medium">Documents</th>
            <th className="px-5 py-3 text-right font-medium">Actions</th>
          </tr>
        </thead>
        {items.map(({ bom, rfq }) => {
          const quotes = rfq.quotes;
          const received = quotes.filter((q) => q.receivedAt);
          const lowest = received.length > 1 ? Math.min(...received.map((q) => q.quotedPrice)) : null;
          const invited = new Set(quotes.map((q) => q.vendorId));
          const invitable = vendors.filter((v) => !invited.has(v.id));
          return (
            <tbody key={rfq.id} className="divide-y border-t first:border-t-0">
              <tr id={`pkg-${bom.id}`} className="scroll-mt-24 bg-muted/20">
                <td colSpan={7} className="px-5 py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm">
                      <span className="font-semibold">{bom.workPackage}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {rfq.code} · budget {formatCurrency(bom.estTotal)}
                        {rfq.respondBy ? ` · respond by ${formatDate(rfq.respondBy)}` : ""}
                      </span>
                    </div>
                    <RequestQuotesDialog
                      bomItemId={bom.id}
                      workPackage={bom.workPackage}
                      vendors={invitable}
                      firstRequest={false}
                      trigger={
                        <Button size="sm" variant="ghost" disabled={invitable.length === 0} className="h-8 text-primary">
                          <Plus className="h-3.5 w-3.5" />
                          Invite vendor
                        </Button>
                      }
                    />
                  </div>
                </td>
              </tr>
              {quotes.map((q) => (
                <tr key={q.id}>
                  <td className="px-5 py-3.5">
                    <div className="font-semibold">{q.vendor.name}</div>
                    <div className="text-xs text-muted-foreground">{q.vendor.type ?? bom.workPackage}</div>
                    {q.revisions.length > 0 && (
                      <details className="mt-1.5 text-xs">
                        <summary className="inline-flex cursor-pointer items-center gap-1 font-medium text-primary hover:underline">
                          <History className="h-3 w-3" />
                          {q.revisions.length + 1} quotes
                        </summary>
                        <ol className="mt-1.5 space-y-1 border-l pl-3">
                          {q.revisions.map((r) => (
                            <li key={r.id} className="text-muted-foreground">
                              <span className="font-medium text-foreground tabular-nums">{formatCurrency(r.quotedPrice)}</span> · round {r.round} · {formatDate(r.receivedAt)}
                              {r.attachmentPath && (
                                <a href={`/api/uploads/quoterev/${r.id}`} target="_blank" rel="noreferrer" className="ml-1.5 text-primary hover:underline">
                                  document
                                </a>
                              )}
                            </li>
                          ))}
                          <li className="text-foreground">
                            <span className="font-semibold tabular-nums">{formatCurrency(q.quotedPrice)}</span> · current
                          </li>
                        </ol>
                      </details>
                    )}
                  </td>
                  <td className="px-3 py-3.5">
                    <Button size="sm" variant="outline" asChild>
                      <a href={`/api/documents/rfq/${rfq.id}?vendorId=${q.vendorId}&download=1`} title={`Download the RFQ addressed to ${q.vendor.name}`}>
                        <Download className="h-3.5 w-3.5" />
                        RFQ PDF
                      </a>
                    </Button>
                    <SendDocumentButtons type="rfq" id={rfq.id} defaultEmail={q.vendor.email} defaultPhone={q.vendor.phone} />
                  </td>
                  <td className="px-3 py-3.5">
                    {q.receivedAt ? (
                      <div className="flex items-center gap-2">
                        <span className="font-semibold tabular-nums">{formatCurrency(q.quotedPrice)}</span>
                        {lowest === q.quotedPrice && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">Lowest</span>}
                        {q.revisions.length > 0 && (
                          <span className={cn("text-xs tabular-nums", q.quotedPrice <= q.revisions[q.revisions.length - 1].quotedPrice ? "text-emerald-700" : "text-red-700")}>
                            {q.quotedPrice <= q.revisions[q.revisions.length - 1].quotedPrice ? "▼" : "▲"} {formatCurrency(Math.abs(q.quotedPrice - q.revisions[q.revisions.length - 1].quotedPrice))}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">Awaiting quote</span>
                    )}
                  </td>
                  <td className="px-3 py-3.5 tabular-nums">{q.leadTimeDays > 0 ? `${q.leadTimeDays} days` : "-"}</td>
                  <td className="px-3 py-3.5">{warrantyLabel(q.warrantyMonths)}</td>
                  <td className="px-3 py-3.5">
                    {q.attachmentPath ? (
                      <a href={`/api/uploads/quote/${q.id}`} target="_blank" rel="noreferrer" title={q.attachmentName ?? undefined} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
                        <Paperclip className="h-3.5 w-3.5 shrink-0" />
                        <span className="max-w-[150px] truncate">{q.attachmentName ?? "View"}</span>
                        <ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                    ) : (
                      <span className="text-muted-foreground">{q.receivedAt ? "None attached" : "-"}</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center justify-end gap-2">
                      {q.receivedAt ? (
                        <>
                          <QuoteReceivedDialog
                            quote={q}
                            vendorName={q.vendor.name}
                            trigger={
                              <button className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Edit quote" title="Edit quote">
                                <Pencil className="h-4 w-4" />
                              </button>
                            }
                          />
                          <RevisedQuoteDialog
                            quoteId={q.id}
                            vendorName={q.vendor.name}
                            round={q.revisions.length + 2}
                            previous={{ quotedPrice: q.quotedPrice, leadTimeDays: q.leadTimeDays, warrantyMonths: q.warrantyMonths }}
                            trigger={
                              <Button size="sm" variant="outline" title="The vendor sent another quote after negotiation">
                                <RefreshCw className="h-3.5 w-3.5" />
                                Revised quote
                              </Button>
                            }
                          />
                          <AcceptQuoteDialog
                            quoteId={q.id}
                            vendorName={q.vendor.name}
                            packageName={bom.workPackage}
                            price={q.quotedPrice}
                            lowest={lowest === q.quotedPrice}
                            trigger={<Button size="sm">Accept quote</Button>}
                          />
                        </>
                      ) : (
                        <>
                          <QuoteReceivedDialog quote={q} vendorName={q.vendor.name} trigger={<Button size="sm" variant="outline">Quote received</Button>} />
                          <FormDialog
                            destructive
                            title={`Remove ${q.vendor.name}?`}
                            description="They will no longer be asked to quote on this package."
                            submitLabel="Remove"
                            action={removeVendorRequest.bind(null, q.id)}
                            trigger={
                              <button className={cn("flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-red-50 hover:text-red-600")} aria-label={`Remove ${q.vendor.name}`} title="Remove vendor">
                                <X className="h-4 w-4" />
                              </button>
                            }
                          />
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}
