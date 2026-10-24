import { Controller, Delete, Get, Patch, Post } from "@nestjs/common";
import { Types } from "mongoose";
import { acceptInviteInput, createOrgInput, inviteInput, roleInput, type Role } from "@veenix/shared";
import { Can, NoOrg } from "../common/decorators";
import { OidParam } from "../common/oid";
import { ZBody } from "../common/zod";
import { OrgsService } from "./orgs.service";

@Controller()
export class OrgsController {
  constructor(private readonly orgs: OrgsService) {}

  @NoOrg() @Get("me") me() { return this.orgs.me(); }
  @NoOrg() @Post("orgs") create(@ZBody(createOrgInput) body: { companyName: string }) { return this.orgs.create(body); }
  @NoOrg() @Post("invitations/accept") accept(@ZBody(acceptInviteInput) body: { token: string }) { return this.orgs.acceptInvitation(body.token); }

  @Can("member:manage") @Get("org/members") members() { return this.orgs.members(); }
  @Can("member:manage") @Patch("org/members/:id") role(@OidParam("id") id: Types.ObjectId, @ZBody(roleInput) body: { role: Role }) { return this.orgs.changeRole(id, body.role); }
  @Can("member:manage") @Delete("org/members/:id") remove(@OidParam("id") id: Types.ObjectId) { return this.orgs.remove(id); }
  @Can("member:manage") @Get("org/invitations") invitations() { return this.orgs.invitations(); }
  @Can("member:manage") @Post("org/invitations") invite(@ZBody(inviteInput) body: { email: string; role: Role }) { return this.orgs.invite(body); }
  @Can("member:manage") @Delete("org/invitations/:id") revoke(@OidParam("id") id: Types.ObjectId) { return this.orgs.revokeInvitation(id); }
}
