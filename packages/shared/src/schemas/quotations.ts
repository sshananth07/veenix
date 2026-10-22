import { z } from "zod";
import { optText } from "./common";
import { sumIs100 } from "./procurement";

export const clientTerms = z
  .array(
    z.strictObject({
      name: z.string().trim().min(1, "Every payment term needs a name").max(120),
      trigger: z.string().trim().max(200).transform((v) => v || "-"),
      pct: z.int({ error: "Each term needs a percentage between 1 and 100" }).min(1, "Each term needs a percentage between 1 and 100").max(100, "Each term needs a percentage between 1 and 100"),
    }),
  )
  .min(1, "Add at least one payment term")
  .max(20)
  .superRefine(sumIs100);

export const buildQuotationInput = z.strictObject({
  markupPct: z.int({ error: "Enter a markup of 0% or more" }).min(0, "Enter a markup of 0% or more").max(500, "Enter a markup between 0% and 500%"),
});
export const markupInput = z.strictObject({
  markupPct: z.int({ error: "Enter a markup between 0% and 500%" }).min(0, "Enter a markup between 0% and 500%").max(500, "Enter a markup between 0% and 500%"),
});
export const termsInput = z.strictObject({ terms: clientTerms });
export const clientQuestionInput = z.strictObject({ comment: z.string().trim().min(3, "Write what the client asked or commented").max(4000) });
export const replyInput = z.strictObject({ reply: z.string().trim().min(3, "Write the reply you gave the client").max(4000) });
export const clientSignedInput = z.strictObject({ signedBy: optText(120) });