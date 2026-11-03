import { Controller, Delete, Get, Patch, Post } from "@nestjs/common";
import { z } from "zod";
import { Can, RateLimit } from "../common/decorators";
import { ZBody } from "../common/zod";
import { myLink, setNotify, startLink, unlink } from "./links.service";

const notifyInput = z.strictObject({ notify: z.boolean() });

// Any member links their own phone; what the assistant may do is decided by their role at each message.
@Controller("whatsapp/link")
export class WhatsAppLinksController {
  @Can() @RateLimit(10) @Post() start() { return startLink(); }
  @Can() @Delete() remove() { return unlink(); }
  @Can() @Get() get() { return myLink(); }
  @Can() @Patch() notify(@ZBody(notifyInput) b: { notify: boolean }) { return setNotify(b.notify); }
}
