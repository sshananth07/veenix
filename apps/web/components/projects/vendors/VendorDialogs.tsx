"use client";

import { senToInput } from "@veenix/shared";
import { useState } from "react";
import { Store } from "lucide-react";
import { acceptQuote, attachVendorInvoice, quoteReceived, recordMilestonePayment, requestQuotes, reviseQuote, setPoTerms } from "@/actions/vendors";
import { FormDialog } from "@/components/FormDialog";
import { PaymentTermsEditor } from "@/components/projects/vendors/PaymentTermsEditor";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency } from "@/lib/utils";

export function RequestQuotesDialog({
  bomItemId,
  workPackage,
  vendors,
  firstRequest,
  trigger,
}: {
  bomItemId: string;
  workPackage: string;
  vendors: { id: string; name: string; type: string | null; jobsCount: number }[];
  firstRequest: boolean;
  trigger: React.ReactNode;
}) {
  const [picked, setPicked] = useState<string[]>([]);

  return (
    <FormDialog
      trigger={trigger}
      title={firstRequest ? `Request quotes: ${workPackage}` : `Invite more vendors: ${workPackage}`}
      description="Ask as many vendors as you like. Their quotes land side by side so you can compare price, lead time and warranty."
      submitLabel={picked.length > 1 ? `Request from ${picked.length} vendors` : "Request quote"}
      pendingLabel="Sending..."
      action={(fd) => requestQuotes(bomItemId, fd)}
      disabled={picked.length === 0}
    >
      <Field label="Vendors" required hint={vendors.length === 0 ? "Every vendor has already been asked. Add a new one on the Vendors page." : undefined}>
        <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border bg-background p-1">
          {vendors.map((v) => (
            <label key={v.id} className="flex cursor-pointer items-start gap-3 rounded-md px-3 py-2 hover:bg-muted/60">
              <input
                type="checkbox"
                name="vendorIds"
                value={v.id}
                className="mt-1 h-4 w-4 accent-[hsl(var(--primary))]"
                checked={picked.includes(v.id)}
                onChange={(e) => setPicked((p) => (e.target.checked ? [...p, v.id] : p.filter((id) => id !== v.id)))}
              />
              <span className="text-sm">
                <span className="font-medium">{v.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {v.type ?? "Vendor"} · {v.jobsCount > 0 ? `${v.jobsCount} jobs with us` : "new vendor"}
                </span>
              </span>
            </label>
          ))}
        </div>
      </Field>
      {firstRequest && (
        <>
          <Field label="Respond by" htmlFor="respondBy">
            <Input id="respondBy" name="respondBy" type="date" />
          </Field>
          <Field label="Note to vendors" htmlFor="note">
            <Textarea id="note" name="note" rows={2} placeholder="Please quote supply and installation. Site access 8am to 6pm." />
          </Field>
        </>
      )}
    </FormDialog>
  );
}

export function QuoteReceivedDialog({
  quote,
  vendorName,
  trigger,
}: {
  quote: { id: string; quotedPrice: number; leadTimeDays: number; warrantyMonths: number; notes: string | null; attachmentName: string | null };
  vendorName: string;
  trigger: React.ReactNode;
}) {
  const editing = quote.quotedPrice > 0;
  return (
    <FormDialog
      trigger={trigger}
      title={`Quote received: ${vendorName}`}
      description="Enter what the vendor quoted and attach their document as proof."
      submitLabel={editing ? "Save changes" : "Save quote"}
      action={(fd) => quoteReceived(quote.id, fd)}
      uploadPurpose="quotes"
    >
      <Field label="Quoted price (RM)" htmlFor="quotedPrice" required>
        <Input id="quotedPrice" name="quotedPrice" inputMode="decimal" defaultValue={editing ? senToInput(quote.quotedPrice) : undefined} required />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Lead time (days)" htmlFor="leadTimeDays">
          <Input id="leadTimeDays" name="leadTimeDays" type="number" min={0} defaultValue={quote.leadTimeDays || undefined} />
        </Field>
        <Field label="Warranty (months)" htmlFor="warrantyMonths">
          <Input id="warrantyMonths" name="warrantyMonths" type="number" min={0} defaultValue={quote.warrantyMonths || undefined} />
        </Field>
      </div>
      <Field
        label="Vendor's quotation"
        htmlFor="file"
        hint={quote.attachmentName ? `Currently attached: ${quote.attachmentName}. Choose a file to replace it.` : "PDF, PNG, JPG or WEBP, up to 10 MB"}
      >
        <Input id="file" name="file" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/*" className="h-auto py-1.5" />
      </Field>
      <Field label="Notes" htmlFor="notes">
        <Textarea id="notes" name="notes" rows={2} defaultValue={quote.notes ?? ""} placeholder="Premium hardware, 14 jobs with us, on time" />
      </Field>
    </FormDialog>
  );
}

// The vendor sent another quote after negotiation. The previous one is kept
// in the history; this one becomes the current offer.
export function RevisedQuoteDialog({
  quoteId,
  vendorName,
  previous,
  round,
  trigger,
}: {
  quoteId: string;
  vendorName: string;
  previous: { quotedPrice: number; leadTimeDays: number; warrantyMonths: number };
  round: number;
  trigger: React.ReactNode;
}) {
  return (
    <FormDialog
      trigger={trigger}
      title={`Revised quote: ${vendorName}`}
      description={`Round ${round}. Their earlier quote of ${formatCurrency(previous.quotedPrice)} stays in the history; this one replaces it as the current offer.`}
      submitLabel="Save revised quote"
      action={(fd) => reviseQuote(quoteId, fd)}
      uploadPurpose="quotes"
    >
      <Field label="Revised price (RM)" htmlFor="quotedPrice" required hint={`Previous: ${formatCurrency(previous.quotedPrice)}`}>
        <Input id="quotedPrice" name="quotedPrice" inputMode="decimal" required />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Lead time (days)" htmlFor="leadTimeDays">
          <Input id="leadTimeDays" name="leadTimeDays" type="number" min={0} defaultValue={previous.leadTimeDays || undefined} />
        </Field>
        <Field label="Warranty (months)" htmlFor="warrantyMonths">
          <Input id="warrantyMonths" name="warrantyMonths" type="number" min={0} defaultValue={previous.warrantyMonths || undefined} />
        </Field>
      </div>
      <Field label="Vendor's revised quotation" htmlFor="file" hint="PDF, PNG, JPG or WEBP, up to 10 MB">
        <Input id="file" name="file" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/*" className="h-auto py-1.5" />
      </Field>
      <Field label="What changed" htmlFor="notes">
        <Textarea id="notes" name="notes" rows={2} placeholder="e.g. Agreed a 5% discount for a faster payment term" />
      </Field>
    </FormDialog>
  );
}

export function AcceptQuoteDialog({
  quoteId,
  vendorName,
  packageName,
  price,
  lowest,
  trigger,
}: {
  quoteId: string;
  vendorName: string;
  packageName: string;
  price: number;
  lowest?: boolean;
  trigger: React.ReactNode;
}) {
  return (
    <FormDialog
      trigger={trigger}
      presentation="drawer"
      title="Accept quote"
      submitLabel="Accept quote"
      pendingLabel="Issuing PO..."
      action={(fd) => acceptQuote(quoteId, fd)}
    >
      <div className="flex items-center justify-between gap-4 rounded-xl border bg-muted/20 p-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Store className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <div className="truncate font-semibold">{vendorName}</div>
            <div className="truncate text-sm text-muted-foreground">{packageName}</div>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-xs text-muted-foreground">Quote amount</div>
          <div className="flex items-center justify-end gap-2">
            <span className="text-lg font-semibold tabular-nums">{formatCurrency(price)}</span>
            {lowest && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">Lowest</span>}
          </div>
        </div>
      </div>

      <PaymentTermsEditor amount={price} />

      <Field label="Delivery / completion by" htmlFor="deliveryBy">
        <Input id="deliveryBy" name="deliveryBy" type="date" />
      </Field>
      <Field label="Remarks (optional)" htmlFor="remarks" hint="Printed on the purchase order. Issuing it fixes the price.">
        <Textarea id="remarks" name="remarks" rows={4} placeholder="e.g. Include warranty, delivery terms, etc." />
      </Field>
    </FormDialog>
  );
}

export function EditTermsDialog({
  poId,
  poCode,
  amount,
  terms,
  trigger,
}: {
  poId: string;
  poCode: string;
  amount: number;
  terms: { label: string; pct: number }[];
  trigger: React.ReactNode;
}) {
  return (
    <FormDialog
      trigger={trigger}
      title={`Payment terms: ${poCode}`}
      description="Each term becomes a payment milestone that needs the vendor's invoice before you pay."
      submitLabel="Save terms"
      action={(fd) => setPoTerms(poId, fd)}
      size="lg"
    >
      <PaymentTermsEditor amount={amount} initial={terms} />
    </FormDialog>
  );
}

export function AttachInvoiceDialog({
  milestone,
  vendorName,
  trigger,
}: {
  milestone: { id: string; label: string; amount: number; invoiceNo: string | null; invoiceName: string | null; invoiceDate: Date | null };
  vendorName: string;
  trigger: React.ReactNode;
}) {
  return (
    <FormDialog
      trigger={trigger}
      title={`Vendor invoice: ${milestone.label}`}
      description={`${vendorName} bills ${formatCurrency(milestone.amount)} for this milestone. Attach the invoice you received.`}
      submitLabel={milestone.invoiceNo ? "Save invoice" : "Attach invoice"}
      action={(fd) => attachVendorInvoice(milestone.id, fd)}
      uploadPurpose="invoices"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Invoice number" htmlFor="invoiceNo" required>
          <Input id="invoiceNo" name="invoiceNo" defaultValue={milestone.invoiceNo ?? ""} required />
        </Field>
        <Field label="Invoice date" htmlFor="invoiceDate">
          <Input id="invoiceDate" name="invoiceDate" type="date" defaultValue={(milestone.invoiceDate ?? new Date()).toISOString().slice(0, 10)} />
        </Field>
      </div>
      <Field
        label="Invoice document"
        htmlFor="file"
        required={!milestone.invoiceName}
        hint={milestone.invoiceName ? `Currently attached: ${milestone.invoiceName}` : "PDF, PNG, JPG or WEBP, up to 10 MB"}
      >
        <Input id="file" name="file" type="file" required={!milestone.invoiceName} accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/*" className="h-auto py-1.5" />
      </Field>
    </FormDialog>
  );
}

export function RecordPaymentDialog({
  milestone,
  payee,
  trigger,
}: {
  milestone: { id: string; label: string; amount: number; invoiceNo: string | null };
  payee: string;
  trigger: React.ReactNode;
}) {
  const [method, setMethod] = useState("Bank Transfer");
  return (
    <FormDialog
      trigger={trigger}
      title={`Record payment: ${milestone.label}`}
      description={`Paying ${payee} against invoice ${milestone.invoiceNo ?? ""}.`}
      submitLabel="Record payment"
      pendingLabel="Recording..."
      action={(fd) => recordMilestonePayment(milestone.id, fd)}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Amount paid (RM)" htmlFor="paidAmount" required>
          <Input id="paidAmount" name="paidAmount" inputMode="decimal" defaultValue={senToInput(milestone.amount)} required />
        </Field>
        <Field label="Payment date" htmlFor="paidDate" required>
          <Input id="paidDate" name="paidDate" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required />
        </Field>
        <Field label="Method" htmlFor="method" required>
          <Select name="method" value={method} onValueChange={setMethod}>
            <SelectTrigger id="method">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["Bank Transfer", "Cheque", "Cash", "DuitNow"].map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Bank reference" htmlFor="bankRef">
          <Input id="bankRef" name="bankRef" placeholder="TXN-8829104" />
        </Field>
      </div>
      <Field label="Paid from" htmlFor="paidFrom">
        <Input id="paidFrom" name="paidFrom" placeholder="Company account, Maybank 5123 4567 8901" />
      </Field>
    </FormDialog>
  );
}

