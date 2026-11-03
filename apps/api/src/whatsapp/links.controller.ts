import { Controller, Delete, Get, Post } from "@nestjs/common";
import { Can, RateLimit } from "../common/decorators";
import { myLink, startLink, unlink } from "./links.service";

// Any member links their own phone; what the assistant may do is decided by their role at each message.
@Controller("whatsapp/link")
export class WhatsAppLinksController {
  @Can() @RateLimit(10) @Post() start() { return startLink(); }
  @Can() @Delete() remove() { return unlink(); }
  @Can() @Get() get() { return myLink(); }
}
