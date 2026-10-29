import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "../config/env";

const KEY = Buffer.from(env.FIELD_ENCRYPTION_KEY, "base64"); // 32 bytes, checked in env.ts

/** AES-256-GCM with a random 96-bit IV. The auth tag makes any tampering fail on decrypt. */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function decrypt(token: string): string {
  const [v, iv, tag, data] = token.split(".");
  if (v !== "v1") throw new Error("Unknown encryption format");
  const decipher = createDecipheriv("aes-256-gcm", KEY, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}
