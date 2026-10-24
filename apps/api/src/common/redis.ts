import Redis from "ioredis";
import { env } from "../config/env";

const g = globalThis as unknown as { __veenixRedis?: Redis };
export const redis = (g.__veenixRedis ??= new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2, enableOfflineQueue: true }));
