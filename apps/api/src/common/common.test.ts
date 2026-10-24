import { describe, expect, it } from "vitest";
import { Types } from "mongoose";
import { AppError } from "./errors";
import { toErrorResponse } from "./error.filter";
import { ctx } from "./context";
import { plain } from "./plain";
import { ZodPipe } from "./zod";
import { leadInput } from "@veenix/shared";

describe("common", () => {
  it("refuses to give a context outside a request", () => {
    expect(() => ctx()).toThrow("No request context");
  });
  it("maps errors to the API error shape", () => {
    expect(toErrorResponse(new AppError("RULE", "Only a draft can be sent"))).toEqual({ status: 422, body: { error: { code: "RULE", message: "Only a draft can be sent" } } });
    expect(toErrorResponse({ code: 11000 }).status).toBe(409);
    expect(toErrorResponse(new Error("boom"))).toEqual({ status: 500, body: { error: { code: "INTERNAL", message: "Something went wrong. Try again." } } });
  });
  it("turns documents into DTO-shaped plain objects", () => {
    const id = new Types.ObjectId();
    expect(plain({ _id: id, orgId: id, __v: 3, items: [{ _id: id, at: new Date(0) }] })).toEqual({ id: id.toHexString(), items: [{ id: id.toHexString(), at: new Date(0) }] });
  });
  it("validates bodies with the schema's own message", () => {
    expect(() => new ZodPipe(leadInput).transform({ name: "", phone: "1" })).toThrow("Lead name is required");
  });
});
