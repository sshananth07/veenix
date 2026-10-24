import { Param, PipeTransform } from "@nestjs/common";
import { Types } from "mongoose";
import { notFound } from "./errors";

/** A 24-hex id or a 404. An invalid id is reported as "not found" so it reveals nothing. */
export function oid(value: unknown, what = "Record"): Types.ObjectId {
  if (typeof value !== "string" || !/^[a-f\d]{24}$/i.test(value)) throw notFound(what);
  return new Types.ObjectId(value);
}

class ParseOid implements PipeTransform<string, Types.ObjectId> {
  transform(value: string) {
    return oid(value);
  }
}

export const OidParam = (name: string) => Param(name, new ParseOid());
