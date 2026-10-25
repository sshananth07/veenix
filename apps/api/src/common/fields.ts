export { orgIdField, sen, senOrNull, findSub, tenantPlugin } from "./tenant.plugin";

/** A nullable text field (Prisma's `String?`). */
export const text = () => ({ type: String, default: null }) as const;
