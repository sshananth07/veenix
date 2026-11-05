"use client";

import { useState } from "react";
import { Banknote, Building2, FileText, QrCode, Smartphone, Undo2 } from "lucide-react";
import { CLIENT_PAYMENT_METHODS, parseRinggit, senToInput, type ClientPaymentDto } from "@veenix/shared";
import { raiseInvoice, recordClientPayment, reverseClientPayment } from "@/actions/milestones";
import { FormDialog } from "@/components/FormDialog";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn, formatDate, formatMoney2, toDateInput } from "@/lib/utils";

const METHOD_ICON = { "Bank transfer": Building2, "DuitNow QR": QrCode, FPX: Smartphone, Cheque: FileText, Cash: Banknote } as const;

export function RaiseInvoiceDialog({ milestone, einvoice, primary }: { milestone: { id: string; name: string; amount: number }; einvoice: boolean; primary: boolean }) {
  return (
    <FormDialog
      trigger={
        <Button size="sm" variant={primary ? "default" : "outline"}>
          Raise invoice
        </Button>
      }
      title={`Raise the invoice for "${milestone.name}"?`}
      description={
        <>
          Issues the next tax invoice number for <strong className="font-semibold text-foreground">{formatMoney2(milestone.amount)}</strong> (SST included), due in 7
          days.{einvoice && " It is also submitted to LHDN MyInvois."} Invoice numbers run in sequence, so a raised invoice stays on record.
        </>
      }
      submitLabel="Raise invoice"
      pendingLabel="Raising..."
      action={() => raiseInvoice(milestone.id)}
    />
  );
}

type PayableInvoice = { id: string; code: string; amount: number; sstAmount: number; paidAmount: number; dueDate: Date | string | null };

/** Keyed on what is still owed, so each opening starts from the current balance. */
export function RecordPaymentDialog(props: { invoice: PayableInvoice; milestoneName: string; trigger: React.ReactNode }) {
  const balance = props.invoice.amount + props.invoice.sstAmount - props.invoice.paidAmount;
  return <RecordPaymentForm key={balance} balance={balance} {...props} />;
}

function RecordPaymentForm({ invoice, milestoneName, trigger, balance }: { invoice: PayableInvoice; milestoneName: string; trigger: React.ReactNode; balance: number }) {
  const [amountText, setAmountText] = useState(senToInput(balance));
  const amount = parseRinggit(amountText);
  const over = amount !== null && amount > balance;
  const valid = amount !== null && amount > 0 && !over;
  const today = toDateInput(new Date());
  const partPaid = invoice.paidAmount > 0;

  return (
    <FormDialog
      trigger={trigger}
      title={`Record payment · ${invoice.code}`}
      description={`${milestoneName}${invoice.dueDate ? `, due ${formatDate(invoice.dueDate)}` : ""}. ${formatMoney2(balance)} ${partPaid ? "still owed after earlier payments" : "owed"}.`}
      submitLabel={valid ? `Confirm ${formatMoney2(amount)} received` : "Record payment"}
      pendingLabel="Recording..."
      disabled={!valid}
      action={(fd) => recordClientPayment(invoice.id, fd)}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Amount received (RM)" htmlFor="amount" required hint={amount === balance ? "The full balance" : "Enter less for a part payment"}>
          <Input
            id="amount"
            name="amount"
            inputMode="decimal"
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            aria-invalid={over || undefined}
            className="tabular-nums"
            required
          />
        </Field>
        <Field label="Date received" htmlFor="receivedAt" required>
          <Input id="receivedAt" name="receivedAt" type="date" defaultValue={today} max={today} required />
        </Field>
      </div>

      <fieldset className="grid gap-1.5">
        <legend className="mb-1.5 text-sm font-medium">
          Method<span className="ml-0.5 text-red-600">*</span>
        </legend>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {CLIENT_PAYMENT_METHODS.map((m, i) => {
            const Icon = METHOD_ICON[m];
            return (
              <label
                key={m}
                className="relative flex cursor-pointer flex-col items-center gap-1 rounded-lg border px-1.5 py-2.5 text-center text-xs font-medium transition-colors hover:bg-muted/50 has-checked:border-primary has-checked:bg-primary/5 has-checked:text-primary has-focus-visible:ring-2 has-focus-visible:ring-ring"
              >
                <input type="radio" name="method" value={m} defaultChecked={i === 0} className="sr-only" />
                <Icon className="h-4 w-4" />
                {m}
              </label>
            );
          })}
        </div>
      </fieldset>

      <Field label="Reference" htmlFor="reference" hint="Optional. Helps match the payment to the bank statement.">
        <Input id="reference" name="reference" maxLength={80} placeholder="Bank ref, cheque no. or FPX transaction ID" />
      </Field>

      <p
        aria-live="polite"
        className={cn("rounded-md border px-3 py-2 text-sm", over ? "border-red-200 bg-red-50 text-red-800" : "bg-muted/40 text-muted-foreground")}
      >
        {over
          ? `That is more than the ${formatMoney2(balance)} owed on this invoice.`
          : !valid
            ? "Enter the amount the client paid."
            : amount === balance
              ? `Settles ${invoice.code} in full and marks "${milestoneName}" paid.`
              : `Leaves ${formatMoney2(balance - amount)} owed. ${invoice.code} shows as part paid until the rest comes in.`}
      </p>
    </FormDialog>
  );
}

export function ReversePaymentDialog({ invoiceId, payment }: { invoiceId: string; payment: ClientPaymentDto }) {
  return (
    <FormDialog
      trigger={
        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" aria-label="Reverse this payment" title="Reverse this payment">
          <Undo2 className="h-3.5 w-3.5" />
        </Button>
      }
      title="Reverse this payment?"
      description={`${formatMoney2(payment.amount)} by ${payment.method} on ${formatDate(payment.receivedAt)}. Use this when a payment was recorded by mistake or a cheque bounced. The amount goes back onto the balance, and the payment stays in the history marked reversed.`}
      submitLabel="Reverse payment"
      pendingLabel="Reversing..."
      destructive
      action={() => reverseClientPayment(invoiceId, payment.id)}
    />
  );
}
