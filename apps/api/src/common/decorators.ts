import { SetMetadata } from "@nestjs/common";
import type { Permission } from "@veenix/shared";

export const IS_PUBLIC = "veenix:public";
export const NO_ORG = "veenix:no-org";
export const PERMISSIONS = "veenix:permissions";
export const RATE_LIMIT = "veenix:rate-limit";

/** No sign-in needed (health, cron with its own secret, the SSE stream with its ticket). */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Signed in, but no organization needed (/me, create organization, accept invitation). */
export const NoOrg = () => SetMetadata(NO_ORG, true);
/** Org route permissions. `@Can()` with no arguments means "any member". Routes without @Can are refused (fail closed). */
export const Can = (...permissions: Permission[]) => SetMetadata(PERMISSIONS, permissions);
/** Per-user requests per minute for this route (the default is 600). */
export const RateLimit = (perMinute: number) => SetMetadata(RATE_LIMIT, perMinute);
