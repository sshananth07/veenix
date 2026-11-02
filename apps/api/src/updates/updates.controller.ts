import { Controller, Delete, Get, Post } from "@nestjs/common";
import { Types } from "mongoose";
import { siteUpdateInput, type SiteUpdateInput } from "@veenix/shared";
import { Can } from "../common/decorators";
import { OidParam } from "../common/oid";
import { ZBody } from "../common/zod";
import { UpdatesService } from "./updates.service";

@Controller()
export class UpdatesController {
  constructor(private readonly updates: UpdatesService) {}

  @Can("project:read") @Get("projects/:id/updates") list(@OidParam("id") id: Types.ObjectId) { return this.updates.list(id); }
  @Can("update:write") @Post("updates") add(@ZBody(siteUpdateInput) b: SiteUpdateInput) { return this.updates.add(b); }
  @Can("update:write") @Delete("updates/:id") remove(@OidParam("id") id: Types.ObjectId) { return this.updates.remove(id); }
}
