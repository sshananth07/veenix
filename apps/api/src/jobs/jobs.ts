import { Logger } from "@nestjs/common";
import { waitUntil } from "@vercel/functions";
import { ctx, runWithCtx, systemCtx } from "../common/context";
import { afterCommit } from "../common/tx";
import { JobModel } from "./job.model";

export type JobType = "mail.send" | "document.snapshot" | "einvoice.submit" | "einvoice.poll" | "assistant.turn" | "whatsapp.inbound" | "assistant.morning" | "assistant.reminder";

type JobOpts<P> = {
  lockMs?: number;
  retryDelayMs?: (attempts: number) => number;
  maxAttempts?: number;
  /** Runs once, after the last attempt fails. */
  onGiveUp?: (payload: P, error: string) => Promise<void>;
};
type Registered = Required<Omit<JobOpts<never>, "onGiveUp">> & { handler: (payload: never) => Promise<void>; onGiveUp?: (payload: never, error: string) => Promise<void> };

const log = new Logger("Jobs");
const handlers = new Map<JobType, Registered>();

export function registerJob<P>(type: JobType, handler: (payload: P) => Promise<void>, opts: JobOpts<P> = {}) {
  handlers.set(type, {
    handler: handler as (payload: never) => Promise<void>,
    lockMs: opts.lockMs ?? 120_000,
    retryDelayMs: opts.retryDelayMs ?? ((attempts) => 2 ** attempts * 60_000),
    maxAttempts: opts.maxAttempts ?? 8,
    onGiveUp: opts.onGiveUp as Registered["onGiveUp"],
  });
}

/** Adds a job inside the caller's transaction. It only exists if that transaction commits. Jobs in one lane run one at a time, in order. */
export async function enqueue(type: JobType, payload: object, runAt = new Date(), lane: string | null = null) {
  await JobModel.create([{ orgId: ctx().orgId, type, payload, runAt, lane }]);
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

const due = (now: Date) => ({ $or: [{ status: "pending", runAt: { $lte: now } }, { status: "running", lockedUntil: { $lt: now } }] });

/** Claims the oldest due job. A lane with an older unfinished job, or a job already running, is skipped without spending attempts. */
async function claimNext(skipLanes: Set<string>) {
  for (;;) {
    const now = new Date();
    let job = await JobModel.findOne({ ...due(now), lane: { $nin: [...skipLanes] } }).sort({ runAt: 1, _id: 1 }).lean();
    if (!job) return null;
    if (job.lane) {
      // The lane's oldest pending job goes first; if it isn't due yet, the whole lane waits.
      const oldest = await JobModel.findOne({ lane: job.lane, _id: { $lt: job._id }, status: "pending" }).sort({ _id: 1 }).lean();
      if (oldest && oldest.runAt > now) {
        skipLanes.add(job.lane);
        continue;
      }
      if (oldest) job = oldest;
    }
    const lockMs = handlers.get(job.type as JobType)?.lockMs ?? 120_000;
    try {
      const claimed = await JobModel.findOneAndUpdate(
        { _id: job._id, ...due(now) },
        { $set: { status: "running", lockedUntil: new Date(now.getTime() + lockMs) }, $inc: { attempts: 1 } },
        { new: true, lean: true },
      );
      if (claimed) return claimed;
    } catch (e) {
      if ((e as { code?: number }).code !== 11000 || !job.lane) throw e;
      skipLanes.add(job.lane); // another job in this lane is running
    }
  }
}

// One runner at a time per instance: each call queues behind the one in progress, so a caller
// that awaits runDue() sees every job it kicked finished. Other instances still claim atomically.
// ponytail: one runner per instance, so a slow assistant turn delays mail on that instance; run assistant jobs on their own kick if this shows up.
let running: Promise<unknown> = Promise.resolve();

export function runDue(max = 20): Promise<number> {
  const run = running.then(() => runBatch(max));
  running = run.catch(() => undefined);
  return run;
}

async function runBatch(max: number): Promise<number> {
  let ran = 0;
  const skipLanes = new Set<string>();
  for (; ran < max; ran++) {
    const job = await claimNext(skipLanes);
    if (!job) break;
    const reg = handlers.get(job.type as JobType);
    try {
      if (!reg) throw new Error(`No handler for ${job.type}`);
      await runWithCtx(systemCtx(job.orgId), () => reg.handler(job.payload as never));
      await JobModel.updateOne({ _id: job._id }, { $set: { status: "done", doneAt: new Date(), lastError: null } });
    } catch (e) {
      const message = (e instanceof Error ? e.message : String(e)).slice(0, 2000);
      const giveUp = job.attempts >= (reg?.maxAttempts ?? 8);
      const delay = reg ? reg.retryDelayMs(job.attempts) : 2 ** job.attempts * 60_000;
      await JobModel.updateOne({ _id: job._id }, { $set: { status: giveUp ? "failed" : "pending", runAt: new Date(Date.now() + delay), lastError: message } });
      log.warn(`${job.type} ${job._id} attempt ${job.attempts} failed: ${message}`);
      if (giveUp && reg?.onGiveUp) {
        await runWithCtx(systemCtx(job.orgId), () => reg.onGiveUp!(job.payload as never, message)).catch((err) => log.error(err instanceof Error ? err.stack : String(err)));
      }
    }
  }
  return ran;
}
