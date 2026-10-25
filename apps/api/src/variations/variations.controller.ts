import { Controller, Post } from "@nestjs/common";
import { Types } from "mongoose";
import { voInput, type VoInput } from "@veenix/shared";
import { Can } from "../common/decorators";
import { OidParam } from "../common/oid";
import { ZBody } from "../common/zod";
import { VariationsService } from "./variations.service";

type Id = Types.ObjectId;

@Controller()
export class VariationsController {
  constructor(private readonly vos: VariationsService) {}

  @Can("vo:write") @Post("projects/:id/variation-orders") create(@OidParam("id") id: Id, @ZBody(voInput) b: VoInput) { return this.vos.create(id, b); }
  @Can("vo:record") @Post("variation-orders/:id/send") send(@OidParam("id") id: Id) { return this.vos.send(id); }
  @Can("vo:record") @Post("variation-orders/:id/accept") accept(@OidParam("id") id: Id) { return this.vos.accept(id); }
}
