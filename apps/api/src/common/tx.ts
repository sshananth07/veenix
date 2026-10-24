import { Logger } from "@nestjs/common";
import mongoose from "mongoose";
import { ctx } from "./context";

const log = new Logger("afterCommit");

async function runHooks(hooks: (() => unknown)[]) {
  for (const hook of hooks) {
    try {
      await hook();
    } catch (e) {
      log.error(e instanceof Error ? e.stack : String(e));
    }
  }
}

/**
 * Runs fn in a MongoDB transaction. Every Mongoose operation inside picks up
 * the session automatically (transactionAsyncLocalStorage). Nested calls join
 * the outer transaction. Hooks registered with afterCommit run once, after the
 * commit, never after a rollback.
 */
export async function tx<T>(fn: () => Promise<T>): Promise<T> {
  const c = ctx();
  if (c.inTx) return fn();
  let result!: T;
  c.inTx = true;
  try {
    await mongoose.connection.transaction(async () => {
      c.afterCommit = []; // reset on each retry of a transient error
      result = await fn();
    });
  } catch (e) {
    c.afterCommit = [];
    throw e;
  } finally {
    c.inTx = false;
  }
  const hooks = c.afterCommit;
  c.afterCommit = [];
  await runHooks(hooks);
  return result;
}

/** Defers side effects (events, search updates, job kicks, file deletes) until the data is committed. */
export function afterCommit(fn: () => unknown) {
  const c = ctx();
  if (c.inTx) c.afterCommit.push(fn);
  else void runHooks([fn]);
}
