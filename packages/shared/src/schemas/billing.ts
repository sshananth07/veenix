import { z } from "zod";
import { CLIENT_PAYMENT_METHODS } from "../enums";
import { optText, positiveSen } from "./common";
import { clientTerms } from "./quotations";

export const scheduleInput = z.strictObject({ terms: clientTerms });

/** A payment the client made against an invoice: the whole balance or part of it. */
export const clientPaymentInput = z.strictObject({
  amount: positiveSen,
  receivedAt: z.coerce.date({ error: "Enter the date the payment came in" }),
  method: z.enum(CLIENT_PAYMENT_METHODS, { error: "Choose how the client paid" }),
  reference: optText(80),
});
