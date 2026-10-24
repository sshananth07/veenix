import { AppError } from "./errors";
import { redis } from "./redis";

// ponytail: fixed one-minute window shared through Redis; allows up to 2x the limit across a window boundary. Switch to a sliding window if that matters.
export async function rateLimit(key: string, perMinute: number) {
  const bucket = `rl:${key}:${Math.floor(Date.now() / 60_000)}`;
  const count = await redis.incr(bucket);
  if (count === 1) await redis.expire(bucket, 65);
  if (count > perMinute) throw new AppError("RATE_LIMITED", "Too many requests. Wait a minute and try again.", 429);
}
