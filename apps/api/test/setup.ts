import mongoose from "mongoose";
import { afterAll, beforeAll } from "vitest";
import { connectDb } from "../src/common/db";

// Each test file gets its own throwaway database on the local Docker Mongo.
beforeAll(async () => {
  await connectDb(process.env.MONGODB_URI, `veenix_test_${process.pid}_${Date.now()}`);
  await Promise.all(mongoose.modelNames().map((n) => mongoose.model(n).init()));
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
