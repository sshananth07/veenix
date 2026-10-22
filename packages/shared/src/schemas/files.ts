import { z } from "zod";
import { MAX_UPLOAD_BYTES, UPLOAD_PURPOSES } from "../enums";
import { uploadRef } from "./common";

export const presignInput = z.strictObject({
  purpose: z.enum(UPLOAD_PURPOSES),
  filename: z.string().trim().min(1).max(200),
  contentType: z.string().trim().max(120),
  size: z.int().positive("The file is empty").max(MAX_UPLOAD_BYTES, "File is larger than 10 MB"),
});
export type PresignInput = z.infer<typeof presignInput>;

export const projectFilesInput = z.strictObject({ files: z.array(uploadRef).min(1, "Choose at least one file").max(20) });
