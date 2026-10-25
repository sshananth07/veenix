import { Controller, Delete, Patch, Post, Put } from "@nestjs/common";
import { Types } from "mongoose";
import { bomItemInput, workItemInput, type BomItemInput } from "@veenix/shared";
import { Can } from "../common/decorators";
import { OidParam } from "../common/oid";
import { ZBody } from "../common/zod";
import { BomService } from "./bom.service";

type WorkItemBody = { name: string; description: string | null };

@Controller()
export class BomController {
  constructor(private readonly bom: BomService) {}

  @Can("bom:write") @Post("projects/:id/work-items") createWork(@OidParam("id") id: Types.ObjectId, @ZBody(workItemInput) b: WorkItemBody) { return this.bom.createWorkItem(id, b); }
  @Can("bom:write") @Patch("work-items/:workItemId") updateWork(@OidParam("workItemId") wid: Types.ObjectId, @ZBody(workItemInput) b: WorkItemBody) { return this.bom.updateWorkItem(wid, b); }
  @Can("bom:write") @Delete("work-items/:workItemId") deleteWork(@OidParam("workItemId") wid: Types.ObjectId) { return this.bom.deleteWorkItem(wid); }
  @Can("bom:write") @Post("projects/:id/bom-items") createLine(@OidParam("id") id: Types.ObjectId, @ZBody(bomItemInput) b: BomItemInput) { return this.bom.saveBomItem(id, null, b); }
  @Can("bom:write") @Put("projects/:id/bom-items/:bomItemId") updateLine(@OidParam("id") id: Types.ObjectId, @OidParam("bomItemId") bid: Types.ObjectId, @ZBody(bomItemInput) b: BomItemInput) { return this.bom.saveBomItem(id, bid, b); }
  @Can("bom:write") @Delete("bom-items/:bomItemId") deleteLine(@OidParam("bomItemId") bid: Types.ObjectId) { return this.bom.deleteBomItem(bid); }
}
