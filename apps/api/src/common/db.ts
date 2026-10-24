import mongoose from "mongoose";
import { env } from "../config/env";

// Reused across invocations: Vercel's Fluid compute keeps instances warm.
const g = globalThis as unknown as { __veenixDb?: Promise<typeof mongoose> };

export function connectDb(uri: string = env.MONGODB_URI, dbName?: string) {
  mongoose.set("strictQuery", "throw");
  // Operations inside connection.transaction() pick up the session automatically.
  mongoose.set("transactionAsyncLocalStorage", true);
  g.__veenixDb ??= mongoose.connect(uri, {
    dbName,
    autoIndex: env.NODE_ENV !== "production",
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
  });
  return g.__veenixDb;
}
