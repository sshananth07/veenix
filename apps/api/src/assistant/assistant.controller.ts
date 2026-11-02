import { Controller, Post } from "@nestjs/common";
import { Types } from "mongoose";
import { z } from "zod";
import { Can } from "../common/decorators";
import { OidParam } from "../common/oid";
import { ZBody } from "../common/zod";
import { approve, reject, undoToolCall } from "./pending";

const approveInput = z.strictObject({ edits: z.record(z.string(), z.unknown()).default({}) });

// Every route is open to any member; the permission of the action itself is checked inside.
@Controller("assistant")
export class AssistantController {
  @Can() @Post("actions/:id/approve") approve(@OidParam("id") id: Types.ObjectId, @ZBody(approveInput) b: { edits: Record<string, unknown> }) { return approve(id, b.edits); }
  @Can() @Post("actions/:id/reject") reject(@OidParam("id") id: Types.ObjectId) { return reject(id); }
  @Can() @Post("tool-calls/:id/undo") undo(@OidParam("id") id: Types.ObjectId) { return undoToolCall(id); }
}
