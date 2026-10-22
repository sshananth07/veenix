import { z } from "zod";
import { objectId, optText, uploadRef } from "./common";

export const voInput = z.strictObject({
  title: z.string().trim().min(1, "Give the variation a short title").max(200),
  description: z.string().trim().min(1, "Describe the additional work").max(4000),
  reason: optText(120),
  raisedBy: optText(120),
  amount: z.int({ error: "Enter the additional cost" }).positive("Enter the additional cost"),
  bomItemId: objectId.nullable().default(null),
  programmeImpact: optText(500),
  file: uploadRef.nullable().default(null),
});
export type VoInput = z.infer<typeof voInput>;