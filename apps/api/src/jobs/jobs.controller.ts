import { timingSafeEqual } from "node:crypto";
import { Controller, Get, Headers, Logger } from "@nestjs/common";
import { Public } from "../common/decorators";
import { unauthenticated } from "../common/errors";
import { env } from "../config/env";
import { purgeOldAudio, scheduleDaily } from "../assistant/proactive";
import { runDue } from "./jobs";

const log = new Logger("Cron");
const logError = (e: unknown) => log.error(e instanceof Error ? e.stack : String(e));

@Controller("internal/jobs")
export class JobsController {
  // Vercel Cron sends "Authorization: Bearer <CRON_SECRET>".
  @Public() @Get("run")
  async run(@Headers("authorization") header = "") {
    const expected = Buffer.from(`Bearer ${env.CRON_SECRET}`);
    const given = Buffer.from(header);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw unauthenticated();
    // Logged, not thrown: a failure here mustn't stop due jobs from running.
    await scheduleDaily().catch(logError);
    await purgeOldAudio().catch(logError);
    return { ran: await runDue(100) };
  }
}
