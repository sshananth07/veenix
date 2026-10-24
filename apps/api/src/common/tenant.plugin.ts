import { Schema, Types } from "mongoose";
import { ctx } from "./context";
import { forbidden } from "./errors";

export const orgIdField = { type: Schema.Types.ObjectId, required: true, immutable: true } as const;

const isSen = (v: unknown) => v == null || Number.isSafeInteger(v);
const senValidator = { validator: isSen, message: "{PATH} must be a whole number of sen" };

/** A required money field in sen, default 0. */
export const sen = () => ({ type: Number, required: true, default: 0, validate: senValidator }) as const;
/** An optional money field in sen. */
export const senOrNull = () => ({ type: Number, default: null, validate: senValidator }) as const;

/** Finds an embedded subdocument by id. */
export function findSub<T extends { _id?: unknown }>(items: T[], id: Types.ObjectId | string): T | undefined {
  const target = String(id);
  return items.find((i) => String(i._id) === target);
}

const QUERY_OPS = [
  "countDocuments", "deleteMany", "deleteOne", "distinct", "find", "findOne", "findOneAndDelete",
  "findOneAndReplace", "findOneAndUpdate", "replaceOne", "updateMany", "updateOne",
] as const;

/**
 * Scopes every query on a tenant collection to the request's organization and,
 * for project managers and site staff, to their assigned projects. Throws
 * without a request context so a forgotten context never becomes an
 * unscoped query.
 */
export function tenantPlugin(schema: Schema, opts: { projectField?: "_id" | "projectId" } = {}) {
  const scope = () => {
    const c = ctx();
    const filter: Record<string, unknown> = { orgId: c.orgId };
    if (opts.projectField && c.projectScope !== "all") filter[opts.projectField] = { $in: c.projectScope };
    return filter;
  };

  schema.pre([...QUERY_OPS], function () {
    this.and([scope()]);
  });

  schema.pre("aggregate", function () {
    const pipeline = this.pipeline();
    const first = pipeline[0];
    // $search must stay the first stage; filter right after it.
    if (first && "$search" in first) pipeline.splice(1, 0, { $match: scope() });
    else pipeline.unshift({ $match: scope() });
  });

  schema.pre("validate", function () {
    if (this.isNew && this.get("orgId") == null) this.set("orgId", ctx().orgId);
  });

  schema.pre("save", function () {
    const c = ctx();
    if (!c.orgId.equals(this.get("orgId") as Types.ObjectId)) throw new Error("Cross-tenant write blocked");
    if (opts.projectField && c.projectScope !== "all") {
      const projectId = this.get(opts.projectField) as Types.ObjectId;
      if (!c.projectScope.some((id) => id.equals(projectId))) throw forbidden("This project is not assigned to you");
    }
  });

  const refuse = (name: string) => () => {
    throw new Error(`${name} is not allowed on tenant models; use Model.create([...]) or filtered updates`);
  };
  schema.pre("insertMany", refuse("insertMany"));
  schema.pre("estimatedDocumentCount", refuse("estimatedDocumentCount"));
  schema.pre("bulkWrite" as "insertMany", refuse("bulkWrite"));
}
