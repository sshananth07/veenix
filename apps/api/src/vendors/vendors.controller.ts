import { Controller, Get, Patch, Post, Put } from "@nestjs/common";
import { Types } from "mongoose";
import { vendorActiveInput, vendorInput, vendorListQuery, type VendorInput } from "@veenix/shared";
import { Can } from "../common/decorators";
import { OidParam } from "../common/oid";
import { ZBody, ZQuery } from "../common/zod";
import { VendorsService } from "./vendors.service";

@Controller("vendors")
export class VendorsController {
  constructor(private readonly vendors: VendorsService) {}

  @Can("vendor:read") @Get() list(@ZQuery(vendorListQuery) q: { q: string; trade?: string; status?: "active" | "inactive" }) { return this.vendors.list(q); }
  @Can("vendor:read") @Get(":id") get(@OidParam("id") id: Types.ObjectId) { return this.vendors.get(id); }
  @Can("vendor:write") @Post() create(@ZBody(vendorInput) body: VendorInput) { return this.vendors.create(body); }
  @Can("vendor:write") @Patch(":id") update(@OidParam("id") id: Types.ObjectId, @ZBody(vendorInput) body: VendorInput) { return this.vendors.update(id, body); }
  @Can("vendor:write") @Put(":id/active") active(@OidParam("id") id: Types.ObjectId, @ZBody(vendorActiveInput) body: { active: boolean }) { return this.vendors.setActive(id, body.active); }
}
