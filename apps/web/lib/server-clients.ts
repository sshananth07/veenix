import "server-only";
import { MongoClient } from "mongodb";
import Redis from "ioredis";

const g = globalThis as unknown as { __mongo?: MongoClient; __redis?: Redis };

export const mongo = (g.__mongo ??= new MongoClient(process.env.MONGODB_URI!));
export const redis = (g.__redis ??= new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: 2 }));
