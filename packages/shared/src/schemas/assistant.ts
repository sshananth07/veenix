import { z } from "zod";
import { dateOrNull, objectId, uploadRef } from "./common";

export const SITE_UPDATE_KINDS = ["progress", "issue", "material_request", "delivery"] as const;
export type SiteUpdateKind = (typeof SITE_UPDATE_KINDS)[number];

export const siteUpdateInput = z.strictObject({
  projectId: objectId,
  kind: z.enum(SITE_UPDATE_KINDS),
  text: z.string().trim().min(1, "Write what happened").max(4000),
  photos: z.array(uploadRef).max(10).default([]),
});
export type SiteUpdateInput = z.infer<typeof siteUpdateInput>;

export const taskInput = z.strictObject({
  title: z.string().trim().min(1, "Give the task a title").max(200),
  assigneeId: objectId.nullable().default(null),
  dueAt: dateOrNull,
  projectId: objectId.nullable().default(null),
  leadId: objectId.nullable().default(null),
});
export type TaskInput = z.infer<typeof taskInput>;
