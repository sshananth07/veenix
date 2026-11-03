import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { connectDb } from "./common/db";
import { env } from "./config/env";
import { sweepIfIdle } from "./jobs/jobs";

export async function createApp() {
  await connectDb();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true }); // req.rawBody: the WhatsApp signature covers the exact bytes
  app.setGlobalPrefix("v1");
  app.use(helmet());
  app.use((_req: unknown, _res: unknown, next: () => void) => {
    sweepIfIdle();
    next();
  });
  app.useBodyParser("json", { limit: "1mb" });
  // The browser calls the API directly only for the SSE stream.
  app.enableCors({ origin: env.WEB_ORIGIN, methods: ["GET"] });
  app.enableShutdownHooks();
  return app;
}
