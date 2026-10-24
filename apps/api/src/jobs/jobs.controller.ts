import { timingSafeEqual } from "node:crypto";
import { Controller, Get, Headers } from "@nestjs/common";
import { Public } from "../common/decorators";
import { unauthenticated } from "../common/errors";
import { env } from "../config/env";
import { runDue } from "./jobs";

@Controller("internal/jobs")
export class JobsController {
  // Vercel Cron sends "Authorization: Bearer <CRON_SECRET>".
  @Public() @Get("run")
  async run(@Headers("authorization") header = "") {
    const expected = Buffer.from(`Bearer ${env.CRON_SECRET}`);
    const given = Buffer.from(header);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw unauthenticated();
    return { ran: await runDue(100) };
  }
}
