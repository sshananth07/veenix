import { z } from "zod";
import { optText } from "./common";

export const vendorInput = z.strictObject({
    name: z.string().trim().min(1, "Vendor name is required").max(120),
    type: optText(200),
    registrationNo: optText(60), 
    contactPerson: optText(60),
    phone: optText(40),
    email: z.email({ error: "Enter a valid email"}).nullable().default(null),
    location: optText(120), 
    experienceYears: z.int().min(0).max(100).nullable().default(null),
    notes: optText(4000), 
});
export type VendorInput = z.infer<typeof vendorInput>;

export const vendorActiveInput = z.strictObject({ active: z.boolean() });

export const vendorListQuery = z.strictObject({
    q: z.string().trim().max(100).default(""),
    trade: z.string().trim().max(60).optional(), 
    status: z.enum(["active", "inactive"]).optional(),
});