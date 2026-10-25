import Link from "next/link";
import { Briefcase, Building2, ExternalLink, FileText, Mail, MapPin, Paperclip, Phone, Receipt, Store, User } from "lucide-react";
import type { VendorDetailDto } from "@veenix/shared";
import { api } from "@/lib/api";
import { BackButton } from "@/components/BackButton";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/StatusBadge";
import { VendorFormDialog } from "@/components/vendors/VendorFormDialog";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "details", label: "Details" },
  { key: "jobs", label: "Jobs" },
  { key: "pos", label: "POs" },
  { key: "documents", label: "Documents" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export default async function VendorDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { tab?: string } }) {
  const vendor = await api<VendorDetailDto>(`/vendors/${params.id}`);
  vendor.rfqQuotes.sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime()); // newest first, as before

  const tab: TabKey = TABS.find((t) => t.key === searchParams.tab)?.key ?? "details";
  const trades = (vendor.type ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  const activePOs = vendor.purchaseOrders.filter((po) => po.status !== "PAID").length;

  const quoteDocs = vendor.rfqQuotes.flatMap((q) => [
    ...q.revisions.filter((r) => r.attachmentPath).map((r) => ({ key: r.id, href: `/api/uploads/quoterev/${r.id}`, name: r.attachmentName, label: `Round ${r.round}`, q })),
    ...(q.attachmentPath ? [{ key: q.id, href: `/api/uploads/quote/${q.id}`, name: q.attachmentName, label: q.revisions.length > 0 ? "Latest" : null, q }] : []),
  ]);
  const invoiceDocs = vendor.purchaseOrders.flatMap((po) => po.milestones.filter((m) => m.invoicePath).map((m) => ({ po, milestone: m })));

  return (
    <div className="space-y-5">
      <BackButton fallbackHref="/vendors" label="Vendors" />

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card p-5 shadow-sm">
        <div className="flex items-center gap-4">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Store className="h-6 w-6" />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight">{vendor.name}</h1>
              <Badge variant={vendor.active ? "success" : "outline"}>{vendor.active ? "Active" : "Inactive"}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">{vendor.type || "No trade set"}</p>
          </div>
        </div>
        <VendorFormDialog vendor={vendor} />
      </div>

      <nav aria-label="Vendor sections" className="overflow-x-auto rounded-xl border bg-card p-1 shadow-sm">
        <ul className="flex min-w-max gap-1">
          {TABS.map((t) => (
            <li key={t.key}>
              <Link
                href={`/vendors/${vendor.id}?tab=${t.key}`}
                replace
                scroll={false}
                aria-current={tab === t.key ? "page" : undefined}
                className={`flex items-center rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${tab === t.key ? "bg-primary/10 font-semibold text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
              >
                {t.label}
                {t.key === "jobs" && vendor.purchaseOrders.length > 0 && <span className="ml-1.5 text-xs text-muted-foreground">({vendor.purchaseOrders.length})</span>}
                {t.key === "pos" && activePOs > 0 && <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 text-[11px] font-semibold text-amber-800">{activePOs}</span>}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {tab === "details" && (
        <div className="grid gap-5 lg:grid-cols-2">
          <section className="rounded-xl border bg-card p-5 shadow-sm">
            <h2 className="mb-4 flex items-center gap-2 font-semibold">
              <Building2 className="h-4 w-4 text-primary" />
              Company details
            </h2>
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <Detail label="Company name" value={vendor.name} />
              <Detail label="Registration no." value={vendor.registrationNo} />
              <Detail label="Contact person" value={vendor.contactPerson} icon={User} />
              <Detail label="Phone" value={vendor.phone} icon={Phone} />
              <Detail label="Email" value={vendor.email} icon={Mail} />
            </dl>
            {vendor.notes && (
              <div className="mt-4 border-t pt-4">
                <div className="text-xs text-muted-foreground">Notes</div>
                <p className="mt-1 text-sm">{vendor.notes}</p>
              </div>
            )}
          </section>

          <section className="rounded-xl border bg-card p-5 shadow-sm">
            <h2 className="mb-4 font-semibold">Trade &amp; specialisation</h2>
            {trades.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {trades.map((t) => (
                  <span key={t} className="rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary">
                    {t}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No trade set.</p>
            )}
            <div className="mt-5 grid grid-cols-2 gap-4 border-t pt-4 text-sm">
              <Detail label="Experience" value={vendor.experienceYears != null ? `${vendor.experienceYears}+ years` : null} icon={Briefcase} />
              <Detail label="Location" value={vendor.location} icon={MapPin} />
            </div>
          </section>
        </div>
      )}

      {tab === "jobs" && (
        <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
          {vendor.purchaseOrders.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-muted-foreground">No jobs with this vendor yet.</p>
          ) : (
            <ul className="divide-y">
              {vendor.purchaseOrders.map((po) => (
                <li key={po.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                  <div className="min-w-0">
                    <Link href={`/projects/${po.projectId}?tab=vendors`} className="font-medium hover:text-primary hover:underline">
                      {po.rfq?.bomItem?.workPackage ?? po.description}
                    </Link>
                    <div className="truncate text-xs text-muted-foreground">{po.project.name}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold tabular-nums">RM {new Intl.NumberFormat("en-MY").format(po.amount)}</span>
                    <StatusBadge status={po.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === "pos" && (
        <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
          {vendor.purchaseOrders.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-muted-foreground">No purchase orders yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="bg-muted/30 text-left text-xs font-medium text-muted-foreground">
                    <th className="px-5 py-2.5 font-medium">PO No.</th>
                    <th className="px-2 py-2.5 font-medium">Project</th>
                    <th className="px-2 py-2.5 text-right font-medium">Amount (RM)</th>
                    <th className="px-2 py-2.5 font-medium">Status</th>
                    <th className="px-5 py-2.5 text-right font-medium">PDF</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {vendor.purchaseOrders.map((po) => (
                    <tr key={po.id}>
                      <td className="px-5 py-3 font-medium">{po.code}</td>
                      <td className="px-2 py-3">{po.project.name}</td>
                      <td className="px-2 py-3 text-right tabular-nums">{new Intl.NumberFormat("en-MY").format(po.amount)}</td>
                      <td className="px-2 py-3">
                        <StatusBadge status={po.status} />
                      </td>
                      <td className="px-5 py-3 text-right">
                        <a href={`/api/documents/po/${po.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                          <FileText className="h-3.5 w-3.5" />
                          View
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {tab === "documents" && (
        <section className="space-y-4">
          <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
            <div className="border-b px-5 py-3 text-sm font-semibold">Quotes submitted</div>
            {quoteDocs.length === 0 ? (
              <p className="px-5 py-6 text-center text-sm text-muted-foreground">No quote documents on file.</p>
            ) : (
              <ul className="divide-y">
                {quoteDocs.map((d) => (
                  <li key={d.key} className="flex items-center justify-between gap-3 px-5 py-3">
                    <a href={d.href} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-2 font-medium text-primary hover:underline">
                      <Paperclip className="h-4 w-4 shrink-0" />
                      <span className="truncate">{d.name ?? "Quote document"}</span>
                      {d.label && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{d.label}</span>}
                      <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                    </a>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {d.q.rfq.project.name} · {d.q.rfq.bomItem?.workPackage ?? ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
            <div className="border-b px-5 py-3 text-sm font-semibold">Invoices received</div>
            {invoiceDocs.length === 0 ? (
              <p className="px-5 py-6 text-center text-sm text-muted-foreground">No vendor invoices on file.</p>
            ) : (
              <ul className="divide-y">
                {invoiceDocs.map(({ po, milestone }) => (
                  <li key={milestone.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <a href={`/api/uploads/invoice/${milestone.id}`} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-2 font-medium text-primary hover:underline">
                      <Receipt className="h-4 w-4 shrink-0" />
                      <span className="truncate">{milestone.invoiceName ?? `Invoice ${milestone.invoiceNo}`}</span>
                      <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                    </a>
                    <span className="shrink-0 text-xs text-muted-foreground">{po.code}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function Detail({ label, value, icon: Icon }: { label: string; value: string | null | undefined; icon?: typeof User }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {Icon && <Icon className="h-3.5 w-3.5" />}
        {label}
      </div>
      <div className="font-medium">{value || <span className="font-normal text-muted-foreground">Not set</span>}</div>
    </div>
  );
}
