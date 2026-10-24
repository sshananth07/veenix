import { Types } from "mongoose";
import { runWithCtx, type RequestContext } from "../src/common/context";

export const newId = () => new Types.ObjectId();

export function asOrg<T>(orgId: Types.ObjectId, fn: () => Promise<T>, over: Partial<RequestContext> = {}) {
  return runWithCtx({ userId: newId(), orgId, role: "owner", projectScope: "all", inTx: false, afterCommit: [], ...over }, fn);
}
