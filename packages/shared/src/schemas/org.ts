import { z } from "zod";
import { ROLES } from "../permissions";
import { optText, uploadRef } from "./common";

export const createOrgInput = z.strictObject({ companyName: z.string().trim().min(2, "Enter your company name").max(160) });

export const letterheadInput = z.strictObject({
  companyName: z.string().trim().min(1, "Company name is required").max(160),
  companyReg: z.string().trim().max(160).default(""),
  companyAddress: z.string().trim().max(400).default(""),
  companyPhone: z.string().trim().max(60).default(""),
  logo: z.union([uploadRef, z.literal("remove")]).nullable().default(null),
});

export const bankInput = z.strictObject({
  bankName: z.string().trim().min(1, "Bank name is required").max(120),
  bankAccountName: z.string().trim().max(160).default(""),
  bankAccount: z.string().trim().min(1, "Account number is required").max(40),
  swiftCode: optText(20),
});

export const pricingInput = z.strictObject({
  defaultMarkupPct: z.int({ error: "Enter a default markup of 0% or more" }).min(0, "Enter a default markup of 0% or more").max(500),
  minMarkupPct: z.int({ error: "Enter a minimum markup of 0% or more" }).min(0, "Enter a minimum markup of 0% or more").max(500),
});

export const taxInput = z.strictObject({ sstBps: z.int().min(0).max(2000) });

export const einvoiceSettingsInput = z.strictObject({
  enabled: z.boolean(),
  environment: z.enum(["preprod", "prod"]).default("preprod"),
  tin: z.string().trim().min(1, "Enter your company's TIN").max(20),
  brn: z.string().trim().min(1, "Enter your business registration number").max(30),
  sstNo: optText(30),
  msicCode: z.string().trim().regex(/^\d{5}$/, "MSIC code is 5 digits"),
  businessActivity: z.string().trim().min(1, "Describe your business activity").max(300),
  clientId: z.string().trim().min(1, "Enter the MyInvois client ID").max(100),
  /** Omit to keep the stored value. */
  clientSecret: z.string().min(1).max(500).optional(),
  certificateBase64: z.string().min(1).max(20_000).optional(), // the .p12 file, base64
  certificatePassword: z.string().min(1).max(200).optional(),
});
export type EinvoiceSettingsInput = z.infer<typeof einvoiceSettingsInput>;

export const inviteInput = z.strictObject({ email: z.email({ error: "Enter a valid email" }).transform((e) => e.toLowerCase()), role: z.enum(ROLES) });
export const roleInput = z.strictObject({ role: z.enum(ROLES) });
export const acceptInviteInput = z.strictObject({ token: z.string().min(20).max(200) });

export const searchQuery = z.strictObject({ q: z.string().trim().min(2, "Type at least 2 characters").max(100) });

export const documentEmailInput = z.strictObject({ to: z.email({ error: "Enter a valid email" }), message: optText(2000) });
export const documentShareInput = z.strictObject({ phone: optText(30) });
