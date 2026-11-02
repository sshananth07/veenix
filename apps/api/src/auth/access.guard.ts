import { CanActivate, ExecutionContext, Injectable, Logger } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Types } from "mongoose";
import type { Request } from "express";
import { can, type Permission, type Role } from "@veenix/shared";
import { IS_PUBLIC, NO_ORG, PERMISSIONS, RATE_LIMIT } from "../common/decorators";
import { AppError, forbidden, unauthenticated } from "../common/errors";
import { setCtx, setUser } from "../common/context";
import { rateLimit } from "../common/rate-limit";
import { verifyIdentity } from "./identity";
import { userFor } from "../users/users";
import { memberCtx } from "./member-ctx";

@Injectable()
export class AccessGuard implements CanActivate {
  private readonly log = new Logger("AccessGuard");
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const meta = <T>(key: string) => this.reflector.getAllAndOverride<T | undefined>(key, [context.getHandler(), context.getClass()]);
    if (meta<boolean>(IS_PUBLIC)) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const header = req.header("authorization") ?? "";
    if (!header.startsWith("Bearer ")) throw unauthenticated();
    const user = await userFor(await verifyIdentity(header.slice(7)));
    setUser(user);
    await rateLimit(`u:${user.id}`, meta<number>(RATE_LIMIT) ?? 600);

    if (meta<boolean>(NO_ORG)) return true;

    const required = meta<Permission[]>(PERMISSIONS);
    if (!required) {
      this.log.error(`Route ${req.method} ${req.path} has no @Can(); refusing`);
      throw new AppError("INTERNAL", "Something went wrong. Try again.", 500);
    }

    const orgHeader = req.header("x-org-id") ?? "";
    if (!/^[a-f\d]{24}$/i.test(orgHeader)) throw forbidden("Choose an organization first");
    const orgId = new Types.ObjectId(orgHeader);
    const c = await memberCtx(orgId, user.id);
    if (!c) throw forbidden("You are not a member of this organization");
    for (const p of required) if (!can(c.role as Role, p)) throw forbidden();
    setCtx(c);
    return true;
  }
}
