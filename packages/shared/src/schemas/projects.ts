import { z } from "zod";
import { PERFORMED_BY, PROJECT_STAGES } from "../enums";
import { ASSIGNABLE_ROLES } from "../permissions";
import { dateOrNull, objectId, optText, qty, requiredAddress, sen, uploadRef } from "./common";

export const projectUpdateInput = z
  .strictObject({
    name: z.string().trim().min(1, "Project name is required").max(200),
    clientName: z.string().trim().min(1, "Client name is required").max(200),
    clientPhone: optText(40),
    clientEmail: z.email({ error: "Enter a valid email" }).nullable().default(null),
    ...requiredAddress,
    propertyType: optText(),
    builtUpArea: optText(60),
    budgetMin: sen.nullable().default(null),
    budgetMax: sen.nullable().default(null),
    pmName: optText(120),
    siteName: optText(120),
    targetStart: dateOrNull,
    targetHandover: dateOrNull,
    stage: z.enum(PROJECT_STAGES),
    cancelReason: optText(500),
    /** A new photo, "remove", or null to keep the current one. */
    photo: z.union([uploadRef, z.literal("remove")]).nullable().default(null),
  })
  .refine((d) => !d.targetStart || !d.targetHandover || d.targetHandover >= d.targetStart, {
    error: "Target handover must be after the site start",
    path: ["targetHandover"],
  })
  .refine((d) => d.budgetMin == null || d.budgetMax == null || d.budgetMax > d.budgetMin, {
    error: "Max budget must be greater than min budget",
    path: ["budgetMax"],
  });
export type ProjectUpdateInput = z.infer<typeof projectUpdateInput>;

export const assigneesInput = z.strictObject({
  assignees: z.array(z.strictObject({ userId: objectId, role: z.enum(ASSIGNABLE_ROLES) })).max(50),
});

export const workItemInput = z.strictObject({
  name: z.string().trim().min(1, "Work item name is required").max(120),
  description: optText(1000),
});

const materialInput = z.strictObject({
  name: z.string().trim().min(1, "Every material needs a name").max(120),
  qty,
  unit: z.string().trim().max(20).default("nos"),
  unitCost: z.int({ error: "Every material needs a quantity and a unit cost" }).positive("Every material needs a quantity and a unit cost"),
});

export const bomItemInput = z.strictObject({
  workItemId: z.string().regex(/^[a-f\d]{24}$/i, "Choose the work item this line belongs to"),
  workPackage: z.string().trim().min(1, "Job name is required").max(200),
  description: optText(1000),
  unit: z.string().trim().min(1, "Choose what the quantity is measured in").max(20),
  qty,
  unitCost: sen,
  performedBy: z.enum(PERFORMED_BY),
  materials: z.array(materialInput).max(100).default([]),
});
export type BomItemInput = z.infer<typeof bomItemInput>;
