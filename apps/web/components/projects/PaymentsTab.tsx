import Link from "next/link";
import { AlertCircle, Building2, CheckCircle2, CircleDollarSign, Download, ExternalLink, Hourglass, QrCode, Smartphone } from "lucide-react";
import type { ProjectDetail } from "@/lib/projectQuery";
import { milestoneCollected, mytStartOfDay } from "@veenix/shared";
import { cn, formatCurrency, formatDate, formatMoney2 } from "@/lib/utils";
import { ActionButton } from "@/components/ActionButton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MilestoneScheduleDialog } from "@/components/projects/payments/MilestoneScheduleDialog";
import { RaiseInvoiceDialog, RecordPaymentDialog, ReversePaymentDialog } from "@/components/projects/payments/PaymentDialogs";
import { submitEinvoice } from "@/actions/milestones";
import { SendDocumentButtons } from "@/components/SendDocumentButtons";

type Milestone = ProjectDetail["milestones"][number];

const PILL = {
  NOT_YET_DUE: { label: "Not yet due", pill: "bg-muted text-muted-foreground" },
  AWAITING_INVOICE: { label: "Awaiting invoice", pill: "bg-amber-100 text-amber-800" },
  AWAITING_PAYMENT: { label: "Awaiting payment", pill: "bg-amber-100 text-amber-800" },
  OVERDUE: { label: "Overdue", pill: "bg-red-100 text-red-800" },
  PART_PAID: { label: "Part paid", pill: "bg-sky-100 text-sky-800" },
  PAID: { label: "Paid", pill: "bg-emerald-100 text-emerald-800" },
  HELD: { label: "Held", pill: "bg-slate-200 text-slate-800" },
  PENDING_SIGNOFF: { label: "Pending sign-off", pill: "bg-amber-100 text-amber-800" },
};

/** The row's status, read from the invoice once there is one. */
function rowStatus(m: Milestone) {
  const inv = m.invoice;
  if (!inv) return m.status === "AWAITING_PAYMENT" ? PILL.AWAITING_INVOICE : (PILL[m.status as keyof typeof PILL] ?? PILL.NOT_YET_DUE);
  if (inv.status === "PAID") return PILL.PAID;
  if (inv.dueDate && new Date(inv.dueDate) < mytStartOfDay()) return PILL.OVERDUE;
  return inv.paidAmount > 0 ? PILL.PART_PAID : PILL.AWAITING_PAYMENT;
}

export function PaymentsTab({ project, selectedInvoiceId }: { project: ProjectDetail; selectedInvoiceId: string | null }) {
  const collected = project.milestones.reduce((s, m) => s + milestoneCollected(m), 0);
  const outstanding = project.milestones.filter((m) => m.status === "AWAITING_PAYMENT").reduce((s, m) => s + m.amount - milestoneCollected(m), 0);
  const notYetDue = project.milestones.filter((m) => m.status === "NOT_YET_DUE" || m.status === "HELD" || m.status === "PENDING_SIGNOFF").reduce((s, m) => s + m.amount, 0);
  const contract = project.contractValue || collected + outstanding + notYetDue;
  const pct = (n: number) => (contract > 0 ? Math.round((n / contract) * 100) : 0);

  if (project.milestones.length === 0) {
    const signed = project.quotations.find((q) => q.status === "ACCEPTED");
    if (!signed) {
      return (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Payment milestones are set up once the client has signed a quotation. Head to the Quotation tab first.
          </CardContent>
        </Card>
      );
    }
    const contractSum = signed.totals.total;
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-sm text-muted-foreground">
            The signed quotation has no payment terms, so there is no schedule yet. Define what triggers each invoice (deposit, progress stages, retention) and what
            share of the contract it collects.
          </p>
          <MilestoneScheduleDialog projectId={project.id} contractSum={contractSum} initial={signed.terms} />
        </CardContent>
      </Card>
    );
  }

  // The most useful invoice to show on the right: whichever one the address
  // bar asked for, else the newest one still awaiting payment, else the
  // newest invoice of any status.
  const milestonesWithInvoice = project.milestones.filter((m) => m.invoice);
  const selected =
    (selectedInvoiceId && milestonesWithInvoice.find((m) => m.invoice!.id === selectedInvoiceId)) ||
    [...milestonesWithInvoice].reverse().find((m) => m.invoice!.status !== "PAID") ||
    milestonesWithInvoice[milestonesWithInvoice.length - 1];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard icon={CheckCircle2} tint="bg-emerald-100 text-emerald-700" label="Collected" value={formatCurrency(collected)} sub={`${pct(collected)}% of contract`} />
        <StatCard icon={Hourglass} tint="bg-amber-100 text-amber-700" label="Outstanding" value={formatCurrency(outstanding)} sub={`${pct(outstanding)}% of contract`} />
        <StatCard icon={CircleDollarSign} tint="bg-slate-100 text-slate-700" label="Not yet due" value={formatCurrency(notYetDue)} sub={`${pct(notYetDue)}% of contract`} />
      </div>

      <div className="grid gap-5 @5xl:grid-cols-[1.5fr_1fr]">
        <section className="overflow-hidden rounded-xl border bg-card shadow-xs">
          <div className="border-b px-5 py-4">
            <h3 className="font-semibold">Payment milestones</h3>
            <p className="text-xs text-muted-foreground">From the payment terms on the signed quotation. Each milestone raises its own invoice.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="bg-muted/30 text-left text-xs font-medium text-muted-foreground">
                  <th className="px-5 py-2.5 font-medium">Milestone</th>
                  <th className="px-2 py-2.5 font-medium">Trigger</th>
                  <th className="px-2 py-2.5 text-right font-medium">%</th>
                  <th className="px-2 py-2.5 text-right font-medium">Amount (RM)</th>
                  <th className="px-2 py-2.5 font-medium">Invoice No.</th>
                  <th className="px-2 py-2.5 font-medium">Status</th>
                  <th className="px-5 py-2.5 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {project.milestones.map((m) => (
                  <MilestoneRow key={m.id} m={m} projectId={project.id} active={selected?.id === m.id} einvoice={project.einvoiceEnabled} />
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div>{selected?.invoice ? <TaxInvoiceCard project={project} milestone={selected} /> : <NoInvoiceCard />}</div>
      </div>
    </div>
  );
}

function MilestoneRow({ m, projectId, active, einvoice }: { m: Milestone; projectId: string; active: boolean; einvoice: boolean }) {
  const status = rowStatus(m);
  const paid = milestoneCollected(m);
  return (
    <tr className={active ? "bg-primary/5" : undefined}>
      <td className="px-5 py-3 font-medium">{m.name}</td>
      <td className="px-2 py-3 text-xs text-muted-foreground">{m.trigger}</td>
      <td className="px-2 py-3 text-right tabular-nums">{m.pct != null ? `${m.pct}%` : "-"}</td>
      <td className="px-2 py-3 text-right tabular-nums">
        {formatCurrency(m.amount).replace("RM ", "")}
        {paid > 0 && paid < m.amount && <div className="text-xs text-muted-foreground">{formatCurrency(paid).replace("RM ", "")} paid</div>}
      </td>
      <td className="px-2 py-3">
        {m.invoice ? (
          <Link href={`/projects/${projectId}?tab=payments&invoice=${m.invoice.id}`} replace scroll={false} className="font-medium text-primary hover:underline">
            {m.invoice.code}
          </Link>
        ) : (
          <span className="text-muted-foreground">-</span>
        )}
      </td>
      <td className="px-2 py-3">
        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${status.pill}`}>{status.label}</span>
      </td>
      <td className="px-5 py-3 text-right">
        {!m.invoice && m.status !== "HELD" && <RaiseInvoiceDialog milestone={m} einvoice={einvoice} primary={m.status === "AWAITING_PAYMENT"} />}
        {m.invoice && m.invoice.status !== "PAID" && (
          <RecordPaymentDialog invoice={m.invoice} milestoneName={m.name} trigger={<Button size="sm">Record payment</Button>} />
        )}
        {m.invoice && m.invoice.status === "PAID" && (
          <Link href={`/projects/${projectId}?tab=payments&invoice=${m.invoice.id}`} replace scroll={false} className="text-sm font-medium text-primary hover:underline">
            View
          </Link>
        )}
      </td>
    </tr>
  );
}

function TaxInvoiceCard({ project, milestone }: { project: ProjectDetail; milestone: Milestone }) {
  const invoice = milestone.invoice!;
  const total = invoice.amount + invoice.sstAmount;
  const balance = total - invoice.paidAmount;
  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
      <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tax Invoice</div>
          <div className="text-lg font-bold">{invoice.code}</div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" asChild aria-label="Download PDF" title="Download PDF">
            <a href={`/api/documents/invoice/${invoice.id}`} target="_blank" rel="noreferrer">
              <Download className="h-4 w-4" />
            </a>
          </Button>
          <SendDocumentButtons type="invoice" id={invoice.id} defaultEmail={project.clientEmail} defaultPhone={project.clientPhone} />
        </div>
      </div>

      <div className="space-y-4 px-5 py-4 text-sm">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Invoice No." value={invoice.code} />
          <Field label="Issue date" value={formatDate(invoice.invoiceDate)} />
          <Field label="Due date" value={formatDate(invoice.dueDate)} />
          <Field label="Milestone" value={milestone.name} />
        </div>

        <EinvoiceStatus invoice={invoice} enabled={project.einvoiceEnabled} />

        <div>
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">SST breakdown</div>
          <dl className="space-y-1.5">
            <Row label="Taxable amount (RM)" value={formatCurrency(invoice.amount).replace("RM ", "")} />
            <Row label={`SST ${project.pricing.sstBps / 100}% (RM)`} value={formatCurrency(invoice.sstAmount).replace("RM ", "")} />
            <Row label="Total amount (RM)" value={formatCurrency(total).replace("RM ", "")} bold />
          </dl>
        </div>

        <PaymentHistory invoice={invoice} balance={balance} />

        {balance > 0 && (
          <>
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">How the client pays</div>
              <div className="grid grid-cols-3 gap-2">
                <PayMethod icon={QrCode} label="DuitNow QR" sub="Scan and pay" />
                <PayMethod icon={Smartphone} label="FPX" sub="Online banking" />
                <PayMethod icon={Building2} label="Bank transfer" sub="RHB / Maybank / CIMB" />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Bank transfer to {project.name.split(",")[0]}&apos;s account, quoting {invoice.code} as the reference.
              </p>
            </div>
            <RecordPaymentDialog invoice={invoice} milestoneName={milestone.name} trigger={<Button className="w-full">Record payment</Button>} />
          </>
        )}
      </div>
    </div>
  );
}

function PaymentHistory({ invoice, balance }: { invoice: NonNullable<Milestone["invoice"]>; balance: number }) {
  if (invoice.payments.length === 0 && invoice.status !== "PAID") return null;
  return (
    <div>
      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Payments received</div>
      {invoice.payments.length === 0 ? (
        <p className="text-muted-foreground">Marked paid in full before payment details were recorded.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {invoice.payments.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-3 py-2">
              <div className={cn("min-w-0 flex-1", p.reversedAt && "text-muted-foreground")}>
                <div className="font-medium">
                  {formatDate(p.receivedAt)} · {p.method}
                  {p.reversedAt && <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs font-medium">Reversed</span>}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {[p.reference, p.recordedByName && `Recorded by ${p.recordedByName}`].filter(Boolean).join(" · ") || "No reference"}
                </div>
              </div>
              <span className={cn("tabular-nums", p.reversedAt ? "text-muted-foreground line-through" : "font-medium")}>{formatMoney2(p.amount).replace("RM ", "")}</span>
              {p.reversedAt ? <span className="w-7" aria-hidden /> : <ReversePaymentDialog invoiceId={invoice.id} payment={p} />}
            </li>
          ))}
        </ul>
      )}
      <dl className="mt-2 space-y-1.5">
        <Row label="Received (RM)" value={formatCurrency(invoice.paidAmount).replace("RM ", "")} />
        <Row label="Balance (RM)" value={formatCurrency(balance).replace("RM ", "")} bold />
      </dl>
    </div>
  );
}

function EinvoiceStatus({ invoice, enabled }: { invoice: NonNullable<Milestone["invoice"]>; enabled: boolean }) {
  const submit = (label: string) => (
    <ActionButton size="sm" variant="outline" className="mt-2" action={submitEinvoice.bind(null, invoice.id)} pendingLabel="Submitting...">
      {label}
    </ActionButton>
  );
  switch (invoice.eInvoiceStatus) {
    case "VALID":
      return (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-emerald-800">
          <div className="flex items-center gap-2 text-sm font-medium">
            <CheckCircle2 className="h-4 w-4" />
            MyInvois Validated
          </div>
          <div className="mt-1 break-all text-xs">UUID {invoice.eInvoiceUuid}</div>
          {invoice.eInvoiceUrl && (
            <a href={invoice.eInvoiceUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs font-medium underline">
              View on MyInvois <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      );
    case "SUBMITTED":
      return (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
          <Hourglass className="h-4 w-4" />
          Submitted to LHDN, waiting for validation
        </div>
      );
    case "INVALID":
      return (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-red-800">
          <div className="flex items-center gap-2 text-sm font-medium">
            <AlertCircle className="h-4 w-4" />
            LHDN did not accept this e-invoice
          </div>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
            {(invoice.eInvoiceErrors ?? ["No reason was given"]).map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
          {submit("Fix the details above, then resubmit")}
        </div>
      );
    case "NOT_SUBMITTED":
      return enabled ? (
        <div className="rounded-lg border bg-muted/30 px-3 py-2.5 text-sm text-muted-foreground">
          Not submitted to LHDN yet.
          <div>{submit("Submit to LHDN")}</div>
        </div>
      ) : null;
    default:
      return null;
  }
}

function NoInvoiceCard() {
  return (
    <div className="flex h-full flex-col items-center justify-center rounded-xl border border-dashed bg-card px-6 py-10 text-center">
      <CircleDollarSign className="h-8 w-8 text-muted-foreground" />
      <p className="mt-2 text-sm font-medium">No invoice generated yet</p>
      <p className="mt-1 text-xs text-muted-foreground">Generate an invoice for a due milestone to see it here.</p>
    </div>
  );
}

function StatCard({ icon: Icon, tint, label, value, sub }: { icon: typeof CheckCircle2; tint: string; label: string; value: string; sub: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3.5 shadow-xs">
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${tint}`}>
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="whitespace-nowrap text-xl font-bold tabular-nums">{value}</div>
        <div className="text-xs text-muted-foreground">{sub}</div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={bold ? "font-semibold tabular-nums" : "tabular-nums"}>{value}</dd>
    </div>
  );
}

function PayMethod({ icon: Icon, label, sub }: { icon: typeof QrCode; label: string; sub: string }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-lg border bg-muted/30 px-2 py-3 text-center">
      <Icon className="h-4 w-4 text-primary" />
      <span className="text-xs font-medium">{label}</span>
      <span className="text-[10px] text-muted-foreground">{sub}</span>
    </div>
  );
}
