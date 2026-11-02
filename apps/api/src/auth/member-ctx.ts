import mongoose, { Types } from "mongoose";
import { isProjectScoped, type Role } from "@veenix/shared";
import { runWithCtx, type RequestContext } from "../common/context";
import { MembershipModel } from "../orgs/membership.model";

/** Project ids where this user is an assignee. The raw driver is used because no tenant context exists yet. */
export async function assignedProjectIds(orgId: Types.ObjectId, userId: Types.ObjectId): Promise<Types.ObjectId[]> {
  const ids = await mongoose.connection.collection("projects").distinct("_id", { orgId, "assignees.userId": userId });
  return ids as Types.ObjectId[];
}

/** The context a member acts in, read fresh: role and project scope as they are now. Null without an active membership. */
export async function memberCtx(orgId: Types.ObjectId, userId: Types.ObjectId): Promise<RequestContext | null> {
  const membership = await MembershipModel.findOne({ orgId, userId, status: "active" }).lean();
  if (!membership) return null;
  const role = membership.role as Role;
  return { userId, orgId, role, projectScope: isProjectScoped(role) ? await assignedProjectIds(orgId, userId) : "all", inTx: false, afterCommit: [] };
}

/** Runs background work as the member who asked for it, so it can do only what they could do in the app. */
export async function runAsMember<T>(orgId: Types.ObjectId, userId: Types.ObjectId, fn: () => Promise<T>): Promise<T | "not_a_member"> {
  const c = await memberCtx(orgId, userId);
  return c ? runWithCtx(c, fn) : "not_a_member";
}
