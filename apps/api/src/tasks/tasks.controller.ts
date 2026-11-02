import { Controller, Delete, Get, Post, Query } from "@nestjs/common";
import { Types } from "mongoose";
import { taskInput, type TaskInput } from "@veenix/shared";
import { Can } from "../common/decorators";
import { OidParam, oid } from "../common/oid";
import { ZBody } from "../common/zod";
import { TasksService } from "./tasks.service";

@Controller("tasks")
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  /** My tasks, or a project's tasks with ?projectId=. */
  @Can() @Get() list(@Query("projectId") projectId?: string) { return projectId ? this.tasks.listForProject(oid(projectId)) : this.tasks.listMine(); }
  @Can("task:write") @Post() create(@ZBody(taskInput) b: TaskInput) { return this.tasks.create(b); }
  @Can() @Post(":id/complete") complete(@OidParam("id") id: Types.ObjectId) { return this.tasks.complete(id); }
  @Can("task:write") @Delete(":id") remove(@OidParam("id") id: Types.ObjectId) { return this.tasks.remove(id); }
}
