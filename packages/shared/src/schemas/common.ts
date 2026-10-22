import { z } from "zod";
import { MY_STATES } from "../address";

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");

/** A non-negative whole number of sen. */
export const sen = z.int({ error: "Enter an amount in whole sen" }).nonnegative("Amount cannot be negative");
export const positiveSen = z.int({ error: "Enter an amount in whole sen" }).positive("Enter an amount greater than zero");

/** A quantity: positive, at most 3 decimals. */
export const qty = z
  .number({ error: "Quantity must be greater than zero" })
  .positive("Quantity must be greater than zero")
  .refine((v) => /^\d+(\.\d{1,3})?$/.test(String(v)), "Quantity can have at most 3 decimals");

/** Optional text. Blank becomes null. */
export const optText = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .default(null);

export const dateOrNull = z.coerce.date().nullable().default(null);

/** A file already PUT to storage via a presigned URL (plan 05). */
export const uploadRef = z.strictObject({
  key: z.string().min(1).max(300),
  name: z.string().trim().min(1).max(120),
});

const postcode = z
  .string()
  .regex(/^\d{5}$/, "Postcode must be 5 digits, e.g. 47300")
  .nullable()
  .default(null);
const state = z.enum(MY_STATES, { error: "Choose a valid state" }).nullable().default(null);

/** Address fields for leads: anything may be missing. */
export const addressParts = {
  addressLine1: optText(160),
  addressLine2: optText(160),
  addressLine3: optText(160),
  postcode,
  city: optText(80),
  state,
};

/** Address fields for projects: line 1, postcode, city and state are required. */
export const requiredAddress = {
  addressLine1: z.string().trim().min(1, "Address line 1 is required (unit or house number, building)").max(160),
  addressLine2: optText(160),
  addressLine3: optText(160),
  postcode: z.string().regex(/^\d{5}$/, "Postcode must be 5 digits, e.g. 47300"),
  city: z.string().trim().min(1, "City is required").max(80),
  state: z.enum(MY_STATES, { error: "Choose a state" }),
};

