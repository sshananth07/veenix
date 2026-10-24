import { Controller, Post } from "@nestjs/common";
import { can, presignInput, type PresignInput, type Role } from "@veenix/shared";
import { Can, RateLimit } from "../common/decorators";
import { ctx } from "../common/context";
import { forbidden } from "../common/errors";
import { ZBody } from "../common/zod";
import { presignUpload } from "./storage";

@Controller("uploads")
export class UploadsController {
  // Any member may upload. The action that claims the file checks the real permission.
  @Can() @RateLimit(30) @Post()
  presign(@ZBody(presignInput) body: PresignInput) {
    if (body.purpose === "logos" && !can(ctx().role as Role, "org:manage")) throw forbidden();
    return presignUpload(body);
  }
}
