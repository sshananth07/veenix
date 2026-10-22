import { z } from "zod";
import { LEAD_STATUSES, PROJECT_STAGES } from "../enums";
import { addressParts, dateOrNull, optText, requiredAddress, sen } from "./common";

export const leadInput = z 
    .strictObject({
        name: z.string().trim().min(1, "Lead name is required").max(200), 
        phone: z.string().trim().min(1, "Phone / WhatsApp is required").max(40),
        email: z.email({ error: "Enter a valid email" }).nullable().default(null),
        source: z.string().trim().max(60).default("Other"),
        campaign: optText(),
        propertyType: optText(), 
        builtUpArea: optText(60), 
        budgetMin: sen.nullable().default(null), 
        budgetMax: sen.nullable().default(null),
        ...addressParts,
        targetStart: optText(60),
        assignedTo: optText(120),
        surveyAt: dateOrNull,
        status: z.enum(LEAD_STATUSES).optional(),  

    })
    .refine((d) => d.budgetMin == null || d.budgetMax == null || d.budgetMax > d.budgetMin, {
        error: "Max budget must be greater than min budget",
        path: ["budgetMax"],
    });
export type LeadInput = z.infer<typeof leadInput>;

export const leadActivityInput = z.strictObject({
    note: z.string().trim().min(1, "Write a note").max(400),
    author: optText(120),
});

export const convertLeadInput = z 
    .strictObject({
        projectName: z.string().trim().min(1, "Project name is required").max(200),
        targetStart: dateOrNull,
        targetHandover: dateOrNull,
        projectOwner: optText(120),
        nextStage: z.enum(PROJECT_STAGES).default("SITE_VISIT"), 
        /** sent only when the lead has no full address yet */
        address: z.strictObject(requiredAddress).nullable().default(null),
    })
    .refine((d) => !d.targetStart || !d.targetHandover || d.targetHandover
    >= d.targetStart, {
        error: "Target handover must be after the target start", 
        path: ["targetHandover"],
    });
export type ConvertLeadInput = z.infer<typeof convertLeadInput>;

export const leadListQuery = z.strictObject({
    view: z.enum(["open", "converted", "all"]).default("open"),
    q: z.string().trim().max(100).default(""), 
    source: z.string().trim().max(60).optional(),
    status: z.enum(LEAD_STATUSES).optional(),
    page: z.coerce.number().int().min(1).default(1), 
});