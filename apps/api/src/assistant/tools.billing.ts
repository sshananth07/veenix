import { Types } from "mongoose";
import { z } from "zod";
import { CLIENT_PAYMENT_METHODS, clientPaymentInput, formatMoney2, invoicePaid, senToInput, toDateInput } from "@veenix/shared";
import { notFound, rule } from "../common/errors";
import { BillingService } from "../billing/billing.service";
import { InvoiceModel } from "../billing/invoice.model";
import { ProjectModel } from "../projects/project.model";
import { defineApprovalAction } from "./pending";

const billing = new BillingService();
const id = z.string().regex(/^[a-f\d]{24}$/i, "Use an id from a tool result");

// What the model may fill in. The payment reference is left out on purpose: it is typed on the web card only,
// so bank references never pass through the model or WhatsApp.
const proposal = z.strictObject({
  invoiceId: id,
  amountSen: z.int().positive().nullable(),
  receivedAt: z.iso.date().nullable(),
  method: z.enum(CLIENT_PAYMENT_METHODS).nullable(),
});
const input = proposal.extend({ reference: z.string().trim().max(80).nullable().default(null) });

defineApprovalAction({
  name: "client_payment",
  description:
    "Record money a client paid against one of their invoices (invoiceId from get_project or search_records). Use only the amount, date and method the user stated; leave the rest null for the card. Never ask for bank account numbers or payment references.",
  input,
  proposal,
  permission: "billing:mark_paid",
  deferred: false,
  validate: async ({ invoiceId, amountSen, receivedAt, method, reference }) => {
    const invoice = await InvoiceModel.findById(invoiceId).lean();
    if (!invoice) throw notFound("Invoice");
    const project = await ProjectModel.findById(invoice.projectId).select("name milestones").lean();
    const milestone = project?.milestones.find((m) => m._id.equals(invoice.milestoneId));
    const balance = invoice.amount + invoice.sstAmount - invoicePaid(invoice);
    if (balance <= 0) throw rule(`${invoice.code} is already paid in full`);
    if (amountSen && amountSen > balance) throw rule(`That's more than the ${formatMoney2(balance)} still owed on ${invoice.code}`);
    if (receivedAt && receivedAt > toDateInput(new Date())) throw rule("The payment date can't be in the future");
    return {
      title: `Record a client payment on ${invoice.code}`,
      lines: [
        { label: "Invoice", value: milestone ? `${invoice.code} · ${milestone.name}` : invoice.code },
        ...(project ? [{ label: "Project", value: project.name }] : []),
        { label: "Owed", value: formatMoney2(balance) },
      ],
      changes: [],
      missing: [!amountSen && "Amount received", !receivedAt && "Date received", !method && "Method"].filter((m): m is string => !!m),
      inputs: [
        { key: "amountSen", label: "Amount received", kind: "money", value: amountSen ? senToInput(amountSen) : null },
        { key: "receivedAt", label: "Date received", kind: "date", value: receivedAt },
        { key: "method", label: "Method", kind: "choice", options: [...CLIENT_PAYMENT_METHODS], value: method },
        { key: "reference", label: "Reference", kind: "text", value: reference, webOnly: true },
      ],
      link: `/projects/${invoice.projectId}?tab=payments&invoice=${invoiceId}`,
    };
  },
  apply: async ({ invoiceId, amountSen, receivedAt, method, reference }) => {
    const oid = new Types.ObjectId(invoiceId);
    await billing.recordPayment(oid, clientPaymentInput.parse({ amount: amountSen, receivedAt, method, reference }));
    const invoice = (await InvoiceModel.findById(oid).lean())!;
    const left = invoice.amount + invoice.sstAmount - invoicePaid(invoice);
    // Goes back to the model and the chat: amounts only, never the reference.
    return {
      done: `Recorded ${formatMoney2(amountSen!)} on ${invoice.code}. ${left > 0 ? `${formatMoney2(left)} still owed.` : "Paid in full."}`,
      link: `/projects/${invoice.projectId}?tab=payments&invoice=${invoiceId}`,
    };
  },
});
