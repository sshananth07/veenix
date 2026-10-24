import "server-only";
import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { nextCookies } from "better-auth/next-js";
import { haveIBeenPwned, jwt, twoFactor } from "better-auth/plugins";
import { hash, verify } from "@node-rs/argon2";
import { mongo, redis } from "./server-clients";
import { sendMail } from "./mail";

const ARGON2 = { memoryCost: 19456, timeCost: 2, parallelism: 1 }; // Argon2id is the library default

export const auth = betterAuth({
  appName: "Veenix",
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: [process.env.BETTER_AUTH_URL!],
  database: mongodbAdapter(mongo.db(), { client: mongo }),
  secondaryStorage: {
    get: (key) => redis.get(key),
    getAndDelete: (key) => redis.getdel(key),
    set: async (key, value, ttl) => {
      if (ttl) await redis.set(key, value, "EX", ttl);
      else await redis.set(key, value);
    },
    delete: async (key) => {
      await redis.del(key);
    },
    // Atomic, and the TTL is set only when the key is created (a fixed window).
    increment: async (key, ttl) => {
      const res = await redis.multi().incr(key).expire(key, ttl, "NX").exec();
      return Number(res![0][1]);
    },
  },
  session: {
    expiresIn: 60 * 60 * 12, // 12 h idle
    updateAge: 60 * 15, // slide the expiry at most every 15 min
    storeSessionInDatabase: true,
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    revokeSessionsOnPasswordReset: true,
    password: {
      hash: (password) => hash(password, ARGON2),
      verify: ({ hash: stored, password }) => verify(stored, password),
    },
    sendResetPassword: async ({ user, url }) => {
      await sendMail({ to: user.email, subject: "Reset your Veenix password", text: `Reset your password: ${url}\n\nThis link expires in 1 hour. If you didn't ask for it, ignore this email.` });
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendMail({ to: user.email, subject: "Verify your Veenix email", text: `Confirm your email address: ${url}` });
    },
  },
  rateLimit: {
    enabled: true,
    storage: "secondary-storage",
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/two-factor/verify-totp": { window: 60, max: 5 },
      "/two-factor/verify-backup-code": { window: 60, max: 5 },
      "/request-password-reset": { window: 300, max: 3 },
      "/sign-up/email": { window: 3600, max: 5 },
    },
  },
  plugins: [
    twoFactor({ issuer: "Veenix" }),
    jwt({
      jwt: {
        issuer: process.env.BETTER_AUTH_URL,
        audience: "veenix-api",
        expirationTime: "10m",
        definePayload: ({ user, session }) => ({
          email: user.email,
          name: user.name,
          ev: user.emailVerified === true,
          mfa: (user as { twoFactorEnabled?: boolean }).twoFactorEnabled === true,
          sct: new Date(session.createdAt).getTime(),
        }),
      },
    }),
    haveIBeenPwned(),
    nextCookies(), // keep last
  ],
});
