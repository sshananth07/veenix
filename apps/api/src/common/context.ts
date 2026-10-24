import { ClsServiceManager } from "nestjs-cls";
import { Types } from "mongoose";
import type { Role } from "@veenix/shared";

export type ProjectScope = "all" | Types.ObjectId[];

export interface RequestContext {
  userId: Types.ObjectId | null; // null for system work (jobs, migration)
  orgId: Types.ObjectId;
  role: Role | "system";
  projectScope: ProjectScope;
  inTx: boolean;
  afterCommit: (() => unknown)[];
}

export interface CurrentUser {
  id: Types.ObjectId;
  email: string;
  name: string;
  platformRole: "superadmin" | null;
}

const CTX = "veenix:ctx";
const USER = "veenix:user";
const cls = () => ClsServiceManager.getClsService();

export function getCtx(): RequestContext | undefined {
  return cls().isActive() ? cls().get(CTX) : undefined;
}

export function ctx(): RequestContext {
  const c = getCtx();
  if (!c) throw new Error("No request context");
  return c;
}

export function setCtx(c: RequestContext) {
  cls().set(CTX, c);
}

export function setUser(u: CurrentUser) {
  cls().set(USER, u);
}

export function currentUser(): CurrentUser {
  const u = cls().isActive() ? (cls().get(USER) as CurrentUser | undefined) : undefined;
  if (!u) throw new Error("No signed-in user");
  return u;
}

export function runWithCtx<T>(c: RequestContext, fn: () => Promise<T>): Promise<T> {
  return cls().run(() => {
    setCtx(c);
    return fn();
  });
}

export function systemCtx(orgId: Types.ObjectId): RequestContext {
  return { userId: null, orgId, role: "system", projectScope: "all", inTx: false, afterCommit: [] };
}
