import { Controller, Get, Patch, Post } from "@nestjs/common";
import { Types } from "mongoose";
import { convertLeadInput, leadActivityInput, leadInput, leadListQuery, type ConvertLeadInput, type LeadInput } from "@veenix/shared";
import { Can } from "../common/decorators";
import { OidParam } from "../common/oid";
import { ZBody, ZQuery } from "../common/zod";
import { LeadsService } from "./leads.service";

@Controller("leads")
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Can("lead:read") @Get() list(@ZQuery(leadListQuery) q: Parameters<LeadsService["list"]>[0]) { return this.leads.list(q); }
  @Can("lead:read") @Get(":id") get(@OidParam("id") id: Types.ObjectId) { return this.leads.get(id); }
  @Can("lead:write") @Post() create(@ZBody(leadInput) b: LeadInput) { return this.leads.create(b); }
  @Can("lead:write") @Patch(":id") update(@OidParam("id") id: Types.ObjectId, @ZBody(leadInput) b: LeadInput) { return this.leads.update(id, b); }
  @Can("lead:write") @Post(":id/activities") activity(@OidParam("id") id: Types.ObjectId, @ZBody(leadActivityInput) b: { note: string; author: string | null }) { return this.leads.addActivity(id, b); }
  @Can("lead:write") @Post(":id/convert") convert(@OidParam("id") id: Types.ObjectId, @ZBody(convertLeadInput) b: ConvertLeadInput) { return this.leads.convert(id, b); }
}
