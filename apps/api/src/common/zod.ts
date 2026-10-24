import { Body, PipeTransform, Query } from "@nestjs/common";
import type { ZodType } from "zod";
import { AppError } from "./errors";

export class ZodPipe implements PipeTransform {
  constructor(private readonly schema: ZodType) {}

  transform(value: unknown) {
    const r = this.schema.safeParse(value);
    if (r.success) return r.data;
    const issues = r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    throw new AppError("VALIDATION", issues[0]?.message ?? "Invalid input", 400, issues);
  }
}

export const ZBody = (schema: ZodType) => Body(new ZodPipe(schema));
export const ZQuery = (schema: ZodType) => Query(new ZodPipe(schema));
