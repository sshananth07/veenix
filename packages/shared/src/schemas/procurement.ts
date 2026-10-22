import { z } from "zod";
import { dateOrNull, objectId, optText, uploadRef } from "./common";

const sumIs100 = (rows: { pct: number }[], ctx: z.RefinementCtx) => {
  const sum = rows.reduce((s, r) => s + r.pct, 0);
  if (sum !== 100) ctx.addIssue({ code: "custom", message: `Payment terms add up to ${sum}%. They must total 100%.` });
};

const termPct = (label: string) => z.int({ error: `${label} needs a percentage between 1 and 100` }).min(1, `${label} needs a percentage between 1 and 100`).max(100, `${label} needs a percentage between 1 and 100`);

export const poTerms = z
  .array(z.strictObject({ label: z.string().trim().min(1, "Every payment term needs a name").max(120), pct: termPct("Each term") }))
  .min(1, "Add at least one payment term")
  .max(20)
  .superRefine(sumIs100);

export const requestQuotesInput = z.strictObject({
  vendorIds: z.array(objectId).min(1, "Pick at least one vendor").max(20),
  respondBy: dateOrNull,
  note: optText(1000),
});

const nonNeg = z.int().min(0, "Lead time and warranty cannot be negative").max(3650).default(0);

export const quoteInput = z.strictObject({
  quotedPrice: z.int({ error: "Enter the quoted price" }).positive("Enter the quoted price"),
  leadTimeDays: nonNeg,
  warrantyMonths: nonNeg,
  notes: optText(4000),
  file: uploadRef.nullable().default(null),
});
export type QuoteInput = z.infer<typeof quoteInput>;

export const acceptQuoteInput = z.strictObject({ terms: poTerms, deliveryBy: dateOrNull, remarks: optText(2000) });
export const poTermsInput = z.strictObject({ terms: poTerms });

export const vendorInvoiceInput = z.strictObject({
  invoiceNo: z.string().trim().min(1, "Enter the vendor's invoice number").max(60),
  invoiceDate: dateOrNull,
  file: uploadRef.nullable().default(null),
});

export const vendorPaymentInput = z.strictObject({
  paidAmount: z.int({ error: "Enter the amount paid" }).positive("Enter the amount paid"),
  paidDate: dateOrNull,
  method: z.string().trim().max(40).default("Bank Transfer"),
  bankRef: optText(80),
  paidFrom: optText(80),
});

export { sumIs100 };