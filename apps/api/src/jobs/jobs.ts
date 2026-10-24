import { Logger } from "@nestjs/common";
import { waitUntil } from "@vercel/functions";
import { ctx, runWithCtx, systemCtx } from "../common/context";
import { afterCommit } from "../common/tx";
import { JobModel } from "./job.model";

export type JobType = "mail.send" | "document.snapshot" | "einvoice.submit" | "einvoice.poll";

const MAX_ATTEMPTS = 8;
const LOCK_MS = 120_000;
const log = new Logger("Jobs");
const handlers = new Map<JobType, (payload: never) => Promise<void>>();

export function registerJob<P>(type: JobType, handler: (payload: P) => Promise<void>) {
  handlers.set(type, handler as (payload: never) => Promise<void>);
}

/** Adds a job inside the caller's transaction. It only exists if that transaction commits. */
export async function enqueue(type: JobType, payload: object, runAt = new Date()) {
  await JobModel.create([{ orgId: ctx().orgId, type, payload, runAt }]);
  afterCommit(kick);
}

/** Runs due jobs without holding up the response. */
export function kick() {
  const work = runDue().catch((e) => log.error(e instanceof Error ? e.stack : String(e)));
  try {
    waitUntil(work);
  } catch {
    // not running on Vercel; the promise still runs
  }
}

let lastSweep = 0;
// ponytail: on the Hobby plan, cron only runs daily, so traffic drives retries. A failed job waits for the next request after its backoff. Use a per-minute Vercel Cron on Pro.
export function sweepIfIdle() {
  if (Date.now() - lastSweep < 60_000) return;
  lastSweep = Date.now();
  kick();
}

async function claimNext() {
  const now = new Date();
  return JobModel.findOneAndUpdate(
    { $or: [{ status: "pending", runAt: { $lte: now } }, { status: "running", lockedUntil: { $lt: now } }] },
    { $set: { status: "running", lockedUntil: new Date(now.getTime() + LOCK_MS) }, $inc: { attempts: 1 } },
    { sort: { runAt: 1 }, new: true, lean: true },
  );
}

// One runner at a time per instance: each call queues behind the one in progress, so a caller
// that awaits runDue() sees every job it kicked finished. Other instances still claim atomically.
let running: Promise<unknown> = Promise.resolve();

export function runDue(max = 20): Promise<number> {
  const run = running.then(() => runBatch(max));
  running = run.catch(() => undefined);
  return run;
}

async function runBatch(max: number): Promise<number> {
  let ran = 0;
  for (; ran < max; ran++) {
    const job = await claimNext();
    if (!job) break;
    try {
      const handler = handlers.get(job.type as JobType);
      if (!handler) throw new Error(`No handler for ${job.type}`);
      await runWithCtx(systemCtx(job.orgId), () => handler(job.payload as never));
      await JobModel.updateOne({ _id: job._id }, { $set: { status: "done", doneAt: new Date(), lastError: null } });
    } catch (e) {
      const message = (e instanceof Error ? e.message : String(e)).slice(0, 2000);
      await JobModel.updateOne(
        { _id: job._id },
        { $set: { status: job.attempts >= MAX_ATTEMPTS ? "failed" : "pending", runAt: new Date(Date.now() + 2 ** job.attempts * 60_000), lastError: message } },
      );
      log.warn(`${job.type} ${job._id} attempt ${job.attempts} failed: ${message}`);
    }
  }
  return ran;
}
