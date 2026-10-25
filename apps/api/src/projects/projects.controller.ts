import { Controller, Get, Patch, Put } from "@nestjs/common";
import { Types } from "mongoose";
import { assigneesInput, projectUpdateInput, type ProjectUpdateInput } from "@veenix/shared";
import { Can } from "../common/decorators";
import { OidParam } from "../common/oid";
import { ZBody } from "../common/zod";
import { ProjectsService } from "./projects.service";

@Controller("projects")
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Can("project:read") @Get() list() { return this.projects.list(); }
  @Can("project:read") @Get(":id") detail(@OidParam("id") id: Types.ObjectId) { return this.projects.detail(id); }
  @Can("project:write") @Patch(":id") update(@OidParam("id") id: Types.ObjectId, @ZBody(projectUpdateInput) b: ProjectUpdateInput) { return this.projects.update(id, b); }
  @Can("project:assign") @Put(":id/assignees") assign(@OidParam("id") id: Types.ObjectId, @ZBody(assigneesInput) b: Parameters<ProjectsService["setAssignees"]>[1]) { return this.projects.setAssignees(id, b); }
}
