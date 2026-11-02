import { existsSync } from "node:fs";
import { z } from "zod";

// Local only. On Vercel the variables come from the project settings.
if (process.env.NODE_ENV !== "production" && existsSync(".env")) process.loadEnvFile(".env");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(4000),
  WEB_ORIGIN: z.url(),
  MONGODB_URI: z.string().min(1),
  REDIS_URL: z.string().min(1),
  AUTH_JWKS_URL: z.url(),
  AUTH_ISSUER: z.string().min(1),
  AUTH_AUDIENCE: z.string().min(1),
  SIGNUP_MODE: z.enum(["open", "invite_only"]).default("open"),
  LIVE_TICKET_SECRET: z.string().min(32),
  CRON_SECRET: z.string().min(32),
  FIELD_ENCRYPTION_KEY: z.string().refine((v) => Buffer.from(v, "base64").length === 32, "must be 32 bytes, base64"),
  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z.stringbool().default(false),
  SMTP_URL: z.string().min(1),
  MAIL_FROM: z.string().min(3),
  // The assistant. Optional so the API boots without it; the assistant then replies that it is off.
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-6.1-sol"),
});

export const env = schema.parse(process.env);
