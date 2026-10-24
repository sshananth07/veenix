import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from "@nestjs/common";
import type { Response } from "express";
import mongoose from "mongoose";
import { AppError } from "./errors";

type Body = { error: { code: string; message: string; details?: unknown } };

export function toErrorResponse(e: unknown): { status: number; body: Body } {
  if (e instanceof AppError) {
    const error: Body["error"] = { code: e.code, message: e.message };
    if (e.details !== undefined) error.details = e.details;
    return { status: e.status, body: { error } };
  }
  if (e instanceof mongoose.Error.VersionError)
    return { status: 409, body: { error: { code: "CONFLICT", message: "Someone else changed this just now. Refresh and try again." } } };
  if (typeof e === "object" && e !== null && (e as { code?: unknown }).code === 11000)
    return { status: 409, body: { error: { code: "DUPLICATE", message: "That already exists." } } };
  if (e instanceof HttpException) {
    const status = e.getStatus();
    return { status, body: { error: { code: status === 404 ? "NOT_FOUND" : "HTTP", message: e.message } } };
  }
  return { status: 500, body: { error: { code: "INTERNAL", message: "Something went wrong. Try again." } } };
}

@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly log = new Logger("Error");

  catch(e: unknown, host: ArgumentsHost) {
    const { status, body } = toErrorResponse(e);
    if (status >= 500) this.log.error(e instanceof Error ? e.stack : String(e));
    host.switchToHttp().getResponse<Response>().status(status).json(body);
  }
}
