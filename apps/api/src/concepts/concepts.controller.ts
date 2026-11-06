import { Controller, Get, Patch, Post } from "@nestjs/common";
import { Types } from "mongoose";
import { conceptPatchInput, type ConceptPatchInput } from "@veenix/shared";
import { Can } from "../common/decorators";
import { OidParam } from "../common/oid";
import { ZBody } from "../common/zod";
import { ConceptsService } from "./concepts.service";

@Controller()
export class ConceptsController {
  constructor(private readonly concepts: ConceptsService) {}

  @Can("project:read") @Get("concepts/:id") get(@OidParam("id") id: Types.ObjectId) { return this.concepts.get(id); }
  @Can("concept:generate") @Patch("concepts/:id") update(@OidParam("id") id: Types.ObjectId, @ZBody(conceptPatchInput) b: ConceptPatchInput) { return this.concepts.update(id, b); }
  @Can("concept:generate") @Post("concepts/:id/render") render(@OidParam("id") id: Types.ObjectId) { return this.concepts.render(id); }
  @Can("project:read") @Get("projects/:id/concepts") forProject(@OidParam("id") id: Types.ObjectId) { return this.concepts.list({ projectId: id }); }
  @Can("lead:read") @Get("leads/:id/concepts") forLead(@OidParam("id") id: Types.ObjectId) { return this.concepts.list({ leadId: id }); }
}
