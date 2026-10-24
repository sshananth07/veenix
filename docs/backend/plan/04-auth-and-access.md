# 04: Auth and access

> For whoever implements this (you or Claude): work task by task and tick each one off in [../README.md](../README.md).

**Goal:** people sign up, verify their email, set up mandatory MFA and sign in, all through Better Auth inside the Next.js app. The API trusts only Better Auth's short-lived JWTs, maps them to `app_users`, resolves the organization membership and role on every request, and enforces the permission matrix and project scope.

**Architecture:**
- **Better Auth** runs in `apps/web`, with its own Mongo collections. Its `jwt` plugin publishes JWKS at `/api/auth/jwks`.
- **The API side:**
  - `verifyIdentity()` is the only provider-specific code.
  - `AccessGuard` (a global `APP_GUARD`) authenticates, applies rate limits, loads the membership, checks `@Can`, and sets the request context.
  - Organizations, memberships and invitations are our own collections, so changing auth provider doesn't touch them.

**Tech stack:** Better Auth 1.x, `@node-rs/argon2`, `mongodb` driver (web), `jose` 6 (API), ioredis, nodemailer, `qrcode`.

**Spec:** [../spec.md](../spec.md) §6, §7.

## Global constraints
- MFA (TOTP) is mandatory for everyone. Email must be verified.
- Passwords: 12–128 characters, checked against breach lists, hashed with Argon2id (`memoryCost: 19456, timeCost: 2, parallelism: 1`).
- Sessions: `expiresIn` 12 h, `updateAge` 15 min, absolute limit 7 days.
- JWT: EdDSA, 10 min, `iss = BETTER_AUTH_URL`, `aud = "veenix-api"`, payload `{ email, name, ev, mfa, sct }`.
- Roles come from `memberships` on every request. Never put roles in the JWT.
- Org routes without `@Can(...)` are refused.

## Review focus
- **A user who signed up but hasn't set up MFA calls the API:** 401 `MFA_REQUIRED`, and the web sends them to `/setup-mfa`. Tested in Task 4.5.
- **A removed member's next request:** 403 immediately, even though their JWT is still valid. Tested in Task 4.5.
- **An admin trying to make someone owner, or demoting the last owner:** refused with a clear message. Tested in Task 4.4.
- **An invitation link opened by a different email:** refused ("This invitation was sent to another email address"). Tested in Task 4.4.
- **A route with no `@Can`:** 500 with a log line naming the route, never a silent allow. Tested in Task 4.5.

---

### Task 4.1: Better Auth in the web app

**Files:**
- Create: `apps/web/lib/auth.ts`, `apps/web/lib/auth-client.ts`, `apps/web/lib/mail.ts`, `apps/web/lib/server-clients.ts`, `apps/web/app/api/auth/[...all]/route.ts`
- Modify: `apps/web/next.config.mjs`, `apps/web/.env`

**Interfaces:**
- Produces:
  - `auth` (the server instance), with `auth.api.getSession({ headers })`, `auth.api.getToken({ headers })` and `auth.api.signOut({ headers })`
  - `authClient`, with `signUp.email`, `signIn.email`, `signOut`, `twoFactor.enable`, `twoFactor.verifyTotp`, `twoFactor.verifyBackupCode`, `requestPasswordReset`, `resetPassword`
  - `sendMail({ to, subject, text })`
  - the endpoints `/api/auth/*` and the JWKS at `/api/auth/jwks`

- [x] **Step 1: Install**

```bash
pnpm --filter web add better-auth @node-rs/argon2 mongodb ioredis nodemailer qrcode "@veenix/shared@workspace:*"
pnpm --filter web add -D @types/nodemailer @types/qrcode
```

- [x] **Step 2: Add the web env vars** (`apps/web/.env`; keep the existing `DATABASE_URL` until plan 08)

```bash
BETTER_AUTH_URL=http://localhost:3100
BETTER_AUTH_SECRET=<random 32 bytes base64>
MONGODB_URI=mongodb://veenix:veenix-dev-only@localhost:27017/veenix?authSource=admin&directConnection=true
REDIS_URL=redis://localhost:6380
SMTP_URL=smtp://localhost:1025
MAIL_FROM="Veenix <no-reply@veenix.local>"
API_URL=http://localhost:4000
NEXT_PUBLIC_API_URL=http://localhost:4000
SIGNUP_MODE=open
```

- [x] **Step 3: Write `apps/web/lib/server-clients.ts`** (one Mongo and one Redis client per server instance)

```ts
import "server-only";
import { MongoClient } from "mongodb";
import Redis from "ioredis";

const g = globalThis as unknown as { __mongo?: MongoClient; __redis?: Redis };

export const mongo = (g.__mongo ??= new MongoClient(process.env.MONGODB_URI!));
export const redis = (g.__redis ??= new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: 2 }));
```

- [x] **Step 4: Write `apps/web/lib/mail.ts`**

```ts
import "server-only";
import nodemailer from "nodemailer";

const transport = nodemailer.createTransport(process.env.SMTP_URL);

export async function sendMail(m: { to: string; subject: string; text: string }) {
  await transport.sendMail({ from: process.env.MAIL_FROM, ...m });
}
```

- [x] **Step 5: Write `apps/web/lib/auth.ts`**

```ts
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
    sendOnSignIn: true, // the login page tells an unverified user a new link is on its way
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
```

⚠ Verify against the installed Better Auth docs:
1. `definePayload` receives `{ user, session }`. If `session` isn't passed, drop `sct`; the web layout's 7-day check (Task 4.6) still enforces the absolute limit.
2. The rate-limit paths (`/request-password-reset` may be `/forget-password` in older versions).
3. The `jwt` plugin's default algorithm is EdDSA.
4. `secondaryStorage.set`'s `ttl` is in seconds.

- [x] **Step 6: Write the route handler** `apps/web/app/api/auth/[...all]/route.ts`

```ts
import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";
export const { GET, POST } = toNextJsHandler(auth);
```

- [x] **Step 7: Write `apps/web/lib/auth-client.ts`**

```ts
"use client";
import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  plugins: [
    twoFactorClient({
      onTwoFactorRedirect() {
        window.location.href = "/verify-mfa";
      },
    }),
  ],
});
```

- [x] **Step 8: Update `apps/web/next.config.mjs`**

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  experimental: {
    serverActions: { bodySizeLimit: "1mb" }, // files go straight to storage now (plan 08)
    // Native or server-only packages that must not be bundled.
    serverComponentsExternalPackages: ["@node-rs/argon2", "mongodb", "ioredis", "nodemailer"],
  },
};

export default nextConfig;
```

Leave `bodySizeLimit` at `"10mb"` until plan 08 moves uploads to presigned URLs. Change it to `"1mb"` in Task 8.4.

- [x] **Step 9: Check that the JWKS endpoint works**

```bash
pnpm --filter web exec npx @better-auth/cli@latest generate --help >/dev/null 2>&1 || true   # no migrations needed for Mongo
pnpm --filter web dev
curl -s http://localhost:3100/api/auth/jwks
```
Expected: `{"keys":[{"crv":"Ed25519","x":"…","kty":"OKP","kid":"…"}]}` (a key is created on the first request).

- [x] **Step 10: Commit**

```bash
git add apps/web
git commit -m "feat(web): Better Auth with Argon2id, TOTP MFA, JWT for the API"
```

---

### Task 4.2: Auth pages

**Files:**
- Create under `apps/web/app/(auth)/`: `layout.tsx`, `signup/page.tsx`, `login/page.tsx`, `verify-email/page.tsx`, `setup-mfa/page.tsx`, `verify-mfa/page.tsx`, `forgot-password/page.tsx`, `reset-password/page.tsx`
- Create: `apps/web/components/auth/AuthForm.tsx`

**Interfaces:**
- Consumes: `authClient` (Task 4.1).
- Produces: these routes and their redirect targets:
  - `/signup` → `/verify-email?email=`
  - `/login` → `/` (or `/verify-mfa`)
  - `/setup-mfa` → `/onboarding`
  - `/verify-mfa` → `/`
  - `/forgot-password`
  - `/reset-password?token=` → `/login`

- [x] **Step 1: Write the shared form shell** `components/auth/AuthForm.tsx`

```tsx
"use client";

import { useState, useTransition } from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AuthForm({ title, subtitle, submitLabel, onSubmit, children, footer }: {
  title: string;
  subtitle?: string;
  submitLabel: string;
  onSubmit: (form: FormData) => Promise<string | null>; // resolves to an error message, or null
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="w-full max-w-sm space-y-4 rounded-xl border bg-card p-6 shadow-sm"
      action={(form) => start(async () => setError(await onSubmit(form)))}
    >
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {children}
      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>{pending ? "Please wait..." : submitLabel}</Button>
      {footer && <div className="text-center text-sm text-muted-foreground">{footer}</div>}
    </form>
  );
}
```

`app/(auth)/layout.tsx`:
```tsx
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <main className="flex min-h-screen items-center justify-center bg-background px-4">{children}</main>;
}
```

- [x] **Step 2: Write the pages**

Each page is a client component wrapping `AuthForm` with the existing `Input` and `Label` components from `components/ui`. The calls and redirects:

`signup/page.tsx`:
```tsx
"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { AuthForm } from "@/components/auth/AuthForm";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function SignupPage() {
  const router = useRouter();
  return (
    <AuthForm
      title="Create your account"
      subtitle="You'll verify your email and set up two-factor sign-in next."
      submitLabel="Create account"
      footer={<>Already have an account? <Link className="underline" href="/login">Sign in</Link></>}
      onSubmit={async (f) => {
        const email = String(f.get("email"));
        const { error } = await authClient.signUp.email({ name: String(f.get("name")), email, password: String(f.get("password")), callbackURL: "/setup-mfa" });
        if (error) return error.message ?? "Could not create the account";
        router.push(`/verify-email?email=${encodeURIComponent(email)}`);
        return null;
      }}
    >
      <div className="space-y-1.5"><Label htmlFor="name">Your name</Label><Input id="name" name="name" required autoComplete="name" /></div>
      <div className="space-y-1.5"><Label htmlFor="email">Email</Label><Input id="email" name="email" type="email" required autoComplete="email" /></div>
      <div className="space-y-1.5"><Label htmlFor="password">Password</Label><Input id="password" name="password" type="password" required minLength={12} autoComplete="new-password" /><p className="text-xs text-muted-foreground">At least 12 characters. A short sentence works well.</p></div>
    </AuthForm>
  );
}
```

`verify-email/page.tsx`: a static message: "We sent a link to {email}. Open it to continue." No form.

`login/page.tsx`:
- `authClient.signIn.email({ email, password })`.
- On `error`, show **"Email or password is incorrect"** whatever the reason, except when `error.status === 403` (email not verified). Then show "Verify your email first. We've sent you a new link."
- On success, the `twoFactorClient` redirect fires (`/verify-mfa`) for enrolled users. Otherwise `router.push("/")`, and the layout sends a user without MFA to `/setup-mfa`.

`setup-mfa/page.tsx` (two steps on one page):
1. A password field → `authClient.twoFactor.enable({ password })` returns `{ method: "totp", totpURI, backupCodes }` (narrow on `method`; the type also allows `otp`). Render the QR with `QRCode.toDataURL(totpURI)` from `qrcode`, the secret text (the `secret=` query parameter of `totpURI`) for manual entry, and the backup codes with the note "Save these somewhere safe. Each works once."
2. A 6-digit code field → `authClient.twoFactor.verifyTotp({ code })`. On success, `router.push("/onboarding")`.

`verify-mfa/page.tsx`:
- A 6-digit field → `authClient.twoFactor.verifyTotp({ code, trustDevice: false })`, then on to `/`.
- A "Use a backup code" toggle switches to `authClient.twoFactor.verifyBackupCode({ code })`.

`forgot-password/page.tsx`:
- `authClient.requestPasswordReset({ email, redirectTo: "/reset-password" })`.
- Always show "If that email has an account, a reset link is on its way."

`reset-password/page.tsx`: read `token` from `useSearchParams()` (inside a `<Suspense>`, or `next build` refuses to prerender the page), then `authClient.resetPassword({ newPassword, token })`, then `router.push("/login")`.

⚠ Verify the client method names in the installed Better Auth (`requestPasswordReset` was `forgetPassword` in older versions).

- [x] **Step 3: Click through it**

With `pnpm --filter web dev` running:
1. Open http://localhost:3100/signup and create an account.
2. Open http://localhost:8025 and click the verification link in Mailpit.
3. Set up MFA by scanning with an authenticator app and entering the code.
4. You land on `/onboarding`. It 404s until Task 4.6; that's expected.
5. Sign out by deleting the cookies, sign in again, and confirm the TOTP prompt appears.

Expected: every step works. Six wrong passwords in a minute gives a "too many requests" error.

- [x] **Step 4: Commit**

```bash
git add apps/web
git commit -m "feat(web): sign-up, email verification, MFA setup and sign-in pages"
```

---

### Task 4.3: API identity check and `app_users`

**Files:**
- Create: `apps/api/src/auth/identity.ts`, `apps/api/src/users/user.model.ts`, `apps/api/src/users/users.ts`
- Test: `apps/api/src/auth/identity.test.ts`

**Interfaces:**
- Produces:
  - `interface Identity { subject: string; email: string; name: string }`
  - `verifyIdentity(token): Promise<Identity>`: throws `AppError` with code `UNAUTHENTICATED`, `EMAIL_UNVERIFIED`, `MFA_REQUIRED` or `SESSION_EXPIRED`
  - `useJwksForTests(jwks)`
  - `UserModel` (collection `app_users`)
  - `userFor(identity): Promise<CurrentUser>`

- [x] **Step 1: Install**

```bash
pnpm --filter api add jose@^6 ioredis
```

- [x] **Step 2: Write the failing test** `src/auth/identity.test.ts`

```ts
import { beforeAll, describe, expect, it } from "vitest";
import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet } from "jose";
import { useJwksForTests, verifyIdentity } from "./identity";
import { env } from "../config/env";

let sign: (claims: Record<string, unknown>) => Promise<string>;

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair("EdDSA", { crv: "Ed25519" });
  useJwksForTests(createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: "t", alg: "EdDSA" }] }));
  sign = (claims) =>
    new SignJWT(claims).setProtectedHeader({ alg: "EdDSA", kid: "t" }).setSubject("user-1").setIssuer(env.AUTH_ISSUER).setAudience(env.AUTH_AUDIENCE).setExpirationTime("10m").sign(privateKey);
});

const good = { email: "a@b.my", name: "Aisyah", ev: true, mfa: true, sct: Date.now() };

describe("verifyIdentity", () => {
  it("accepts a verified, MFA-enrolled, fresh session", async () => {
    expect(await verifyIdentity(await sign(good))).toEqual({ subject: "user-1", email: "a@b.my", name: "Aisyah" });
  });
  it("refuses tokens that are missing a step", async () => {
    await expect(verifyIdentity(await sign({ ...good, mfa: false }))).rejects.toMatchObject({ code: "MFA_REQUIRED" });
    await expect(verifyIdentity(await sign({ ...good, ev: false }))).rejects.toMatchObject({ code: "EMAIL_UNVERIFIED" });
    await expect(verifyIdentity(await sign({ ...good, sct: Date.now() - 8 * 86_400_000 }))).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
    await expect(verifyIdentity("not-a-jwt")).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
});
```

- [x] **Step 3: Run it to confirm it fails**

Run: `pnpm --filter api test identity`
Expected: FAIL (module missing).

- [x] **Step 4: Write `src/auth/identity.ts`**

```ts
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { env } from "../config/env";
import { unauthenticated } from "../common/errors";

// The only file that knows which auth provider issues tokens (spec §6.5).
let jwks: JWTVerifyGetKey = createRemoteJWKSet(new URL(env.AUTH_JWKS_URL));
export const useJwksForTests = (keys: JWTVerifyGetKey) => {
  jwks = keys;
};

const ABSOLUTE_SESSION_MS = 7 * 86_400_000;

export interface Identity {
  subject: string;
  email: string;
  name: string;
}

export async function verifyIdentity(token: string): Promise<Identity> {
  let payload;
  try {
    ({ payload } = await jwtVerify(token, jwks, {
      issuer: env.AUTH_ISSUER,
      audience: env.AUTH_AUDIENCE,
      algorithms: ["EdDSA"],
      clockTolerance: 5,
    }));
  } catch {
    throw unauthenticated("UNAUTHENTICATED", "Your session has expired. Sign in again.");
  }
  if (payload.ev !== true) throw unauthenticated("EMAIL_UNVERIFIED", "Verify your email first");
  if (payload.mfa !== true) throw unauthenticated("MFA_REQUIRED", "Set up two-factor sign-in first");
  const sct = Number(payload.sct);
  if (Number.isFinite(sct) && Date.now() - sct > ABSOLUTE_SESSION_MS) throw unauthenticated("SESSION_EXPIRED", "Please sign in again");
  return { subject: String(payload.sub), email: String(payload.email), name: String(payload.name ?? "") };
}
```

- [x] **Step 5: Write `src/users/user.model.ts` and `src/users/users.ts`**

```ts
// user.model.ts
import { Schema, model } from "mongoose";

const userSchema = new Schema(
  {
    authSubject: { type: String, required: true, unique: true },
    email: { type: String, required: true, lowercase: true, index: true },
    name: { type: String, default: "" },
    platformRole: { type: String, enum: ["superadmin", null], default: null },
  },
  { collection: "app_users", timestamps: true },
);
export const UserModel = model("AppUser", userSchema);
```

```ts
// users.ts
import type { CurrentUser } from "../common/context";
import type { Identity } from "../auth/identity";
import { UserModel } from "./user.model";

/** Our user record for a verified identity, created the first time we see it. No write unless something changed. */
export async function userFor(identity: Identity): Promise<CurrentUser> {
  const email = identity.email.toLowerCase();
  let u = await UserModel.findOne({ authSubject: identity.subject }).lean();
  if (!u || u.email !== email || u.name !== identity.name) {
    u = await UserModel.findOneAndUpdate(
      { authSubject: identity.subject },
      { $set: { email, name: identity.name } },
      { upsert: true, new: true, lean: true },
    );
  }
  return { id: u!._id, email: u!.email, name: u!.name, platformRole: (u!.platformRole as "superadmin" | null) ?? null };
}
```

- [x] **Step 6: Run the tests**

Run: `pnpm --filter api test identity`
Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add apps/api pnpm-lock.yaml
git commit -m "feat(api): verify Better Auth JWTs and map them to app users"
```

---

### Task 4.4: Organizations, memberships, invitations, `/me`

**Files:**
- Create: `apps/api/src/orgs/org.model.ts`, `src/orgs/membership.model.ts`, `src/orgs/invitation.model.ts`, `src/orgs/orgs.service.ts`, `src/orgs/orgs.controller.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/src/orgs/orgs.service.test.ts`

**Interfaces:**
- Consumes: `currentUser()`, `ctx()`, `tx()`, `audit()`, `nextCode`-free code; `createOrgInput`, `inviteInput`, `roleInput` and `acceptInviteInput` from shared.
- Produces:
  - `OrgModel` (collection `organizations`), `MembershipModel`, `InvitationModel`
  - `OrgsService`, with these methods:

    | Method | Returns / notes |
    |---|---|
    | `me()` | `MeDto` |
    | `create(input)` | `{ orgId }` |
    | `members()` | `MemberDto[]` |
    | `changeRole(membershipId, role)` | |
    | `remove(membershipId)` | |
    | `invite(input)` | `{ id, link }`; `link` is returned only outside production, for testing |
    | `invitations()` | `InvitationDto[]` |
    | `revokeInvitation(id)` | |
    | `acceptInvitation(token)` | `{ orgId }` |
    | `assertMember(orgId, userId)` | `Membership`; throws 403 |

  - `toOrgDto(org): OrgDto`

- [x] **Step 1: Write the models**

```ts
// org.model.ts
import { Schema, model, type InferSchemaType } from "mongoose";

const orgSchema = new Schema(
  {
    companyName: { type: String, required: true },
    companyReg: { type: String, default: "" },
    companyAddress: { type: String, default: "" },
    companyPhone: { type: String, default: "" },
    logoPath: { type: String, default: null },
    bankName: { type: String, default: "" },
    bankAccountName: { type: String, default: "" },
    bankAccount: { type: String, default: "" },
    swiftCode: { type: String, default: null },
    defaultMarkupPct: { type: Number, default: 40 },
    minMarkupPct: { type: Number, default: 20 },
    sstBps: { type: Number, default: 800 },
    einvoice: { type: Schema.Types.Mixed, default: null }, // plan 10
    status: { type: String, enum: ["active", "suspended"], default: "active" },
    createdBy: { type: Schema.Types.ObjectId, required: true },
  },
  { collection: "organizations", timestamps: true },
);
export type Org = InferSchemaType<typeof orgSchema> & { _id: import("mongoose").Types.ObjectId };
export const OrgModel = model("Organization", orgSchema);
```

```ts
// membership.model.ts
import { Schema, model } from "mongoose";
import { ROLES } from "@veenix/shared";

const membershipSchema = new Schema(
  {
    orgId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    role: { type: String, enum: ROLES, required: true },
    status: { type: String, enum: ["active", "removed"], default: "active" },
    invitedBy: { type: Schema.Types.ObjectId, default: null },
  },
  { collection: "memberships", timestamps: true },
);
membershipSchema.index({ orgId: 1, userId: 1 }, { unique: true });
membershipSchema.index({ userId: 1, status: 1 });
export const MembershipModel = model("Membership", membershipSchema);
```

```ts
// invitation.model.ts
import { Schema, model } from "mongoose";
import { ROLES } from "@veenix/shared";

const invitationSchema = new Schema(
  {
    orgId: { type: Schema.Types.ObjectId, required: true },
    email: { type: String, required: true, lowercase: true },
    role: { type: String, enum: ROLES, required: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    invitedBy: { type: Schema.Types.ObjectId, required: true },
    acceptedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
  },
  { collection: "invitations", timestamps: true },
);
invitationSchema.index({ orgId: 1, email: 1 });
export const InvitationModel = model("Invitation", invitationSchema);
```

These three collections are **not** under the tenant plugin. Every query on them names `orgId` explicitly.

- [x] **Step 2: Write the failing test** `src/orgs/orgs.service.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { Types } from "mongoose";
import { OrgsService } from "./orgs.service";
import { MembershipModel } from "./membership.model";
import { runWithCtx, setUser } from "../common/context";
import { asOrg, newId } from "../../test/ctx";

const svc = new OrgsService();
const asUser = <T>(user: { id: ReturnType<typeof newId>; email: string }, fn: () => Promise<T>) =>
  runWithCtx(undefined as never, async () => { setUser({ ...user, name: "", platformRole: null }); return fn(); });

describe("OrgsService", () => {
  const owner = { id: newId(), email: "owner@x.my" };
  const admin = { id: newId(), email: "admin@x.my" };

  it("makes the creator the owner", async () => {
    const { orgId } = await asUser(owner, () => svc.create({ companyName: "Wawasan Interior" }));
    const m = await MembershipModel.findOne({ orgId, userId: owner.id }).lean();
    expect(m!.role).toBe("owner");
  });

  it("enforces invitation email and owner rules", async () => {
    const orgId = new Types.ObjectId((await asUser(owner, () => svc.create({ companyName: "Org 2" }))).orgId);
    const { link } = await asUser(owner, () => asOrg(orgId, () => svc.invite({ email: "admin@x.my", role: "admin" }), { userId: owner.id, role: "owner" }));
    const token = link!.split("/").pop()!;

    await expect(asUser({ id: newId(), email: "someone@else.my" }, () => svc.acceptInvitation(token))).rejects.toThrow("This invitation was sent to another email address");
    await asUser(admin, () => svc.acceptInvitation(token));

    const adminMembership = await MembershipModel.findOne({ orgId, userId: admin.id }).lean();
    const ownerMembership = await MembershipModel.findOne({ orgId, userId: owner.id }).lean();
    const asAdmin = <T>(fn: () => Promise<T>) => asUser(admin, () => asOrg(orgId, fn, { userId: admin.id, role: "admin" }));

    await expect(asAdmin(() => svc.changeRole(adminMembership!._id, "owner"))).rejects.toThrow("Only an owner can grant or remove the owner role");
    await expect(asUser(owner, () => asOrg(orgId, () => svc.changeRole(ownerMembership!._id, "admin"), { userId: owner.id, role: "owner" }))).rejects.toThrow("You can't change your own role");
    await expect(asAdmin(() => svc.remove(ownerMembership!._id))).rejects.toThrow("Only an owner can grant or remove the owner role");
  });
});
```

`runWithCtx(undefined as never, …)` opens a context with no organization, the same state as a `@NoOrg` route.

- [x] **Step 3: Run it to confirm it fails**

Run: `pnpm --filter api test orgs`
Expected: FAIL (module missing).

- [x] **Step 4: Write `src/orgs/orgs.service.ts`**

```ts
import { createHash, randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";
import type { InvitationDto, MeDto, MemberDto, OrgDto, Role } from "@veenix/shared";
import { ctx, currentUser } from "../common/context";
import { forbidden, notFound, rule } from "../common/errors";
import { tx } from "../common/tx";
import { audit } from "../audit/audit";
import { env } from "../config/env";
import { UserModel } from "../users/user.model";
import { OrgModel, type Org } from "./org.model";
import { MembershipModel } from "./membership.model";
import { InvitationModel } from "./invitation.model";

const INVITE_DAYS = 7;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function toOrgDto(o: Org): OrgDto {
  return {
    id: String(o._id), companyName: o.companyName, companyReg: o.companyReg, companyAddress: o.companyAddress,
    companyPhone: o.companyPhone, logoPath: o.logoPath ?? null, bankName: o.bankName, bankAccountName: o.bankAccountName,
    bankAccount: o.bankAccount, swiftCode: o.swiftCode ?? null, defaultMarkupPct: o.defaultMarkupPct,
    minMarkupPct: o.minMarkupPct, sstBps: o.sstBps,
  };
}

@Injectable()
export class OrgsService {
  async me(): Promise<MeDto> {
    const u = currentUser();
    const memberships = await MembershipModel.find({ userId: u.id, status: "active" }).lean();
    const orgs = await OrgModel.find({ _id: { $in: memberships.map((m) => m.orgId) }, status: "active" }).lean();
    return {
      user: { id: String(u.id), name: u.name, email: u.email, platformRole: u.platformRole },
      memberships: orgs.map((o) => ({ orgId: String(o._id), companyName: o.companyName, role: memberships.find((m) => m.orgId.equals(o._id))!.role as Role })),
    };
  }

  async create(input: { companyName: string }) {
    const u = currentUser();
    if (env.SIGNUP_MODE === "invite_only" && u.platformRole !== "superadmin") throw forbidden("New organizations are created by the platform administrator");
    const orgId = new Types.ObjectId();
    await OrgModel.create([{ _id: orgId, companyName: input.companyName, createdBy: u.id }]);
    await MembershipModel.create([{ orgId, userId: u.id, role: "owner" }]);
    return { orgId: String(orgId) };
  }

  async assertMember(orgId: Types.ObjectId, userId: Types.ObjectId) {
    const m = await MembershipModel.findOne({ orgId, userId, status: "active" }).lean();
    if (!m) throw forbidden("You are not a member of this organization");
    return m;
  }

  async members(): Promise<MemberDto[]> {
    const { orgId } = ctx();
    const ms = await MembershipModel.find({ orgId, status: "active" }).sort({ createdAt: 1 }).lean();
    const users = await UserModel.find({ _id: { $in: ms.map((m) => m.userId) } }).lean();
    return ms.map((m) => {
      const u = users.find((x) => x._id.equals(m.userId));
      return { id: String(m._id), userId: String(m.userId), name: u?.name ?? "", email: u?.email ?? "", role: m.role as Role, createdAt: m.createdAt };
    });
  }

  /** Owner rules: only owners touch the owner role, nobody edits themselves, the last owner stays. */
  private async guardChange(membershipId: Types.ObjectId, nextRole: Role | null) {
    const c = ctx();
    const target = await MembershipModel.findOne({ _id: membershipId, orgId: c.orgId, status: "active" }).lean();
    if (!target) throw notFound("Member");
    // Owner check first: an admin promoting themselves hears about the owner rule.
    if ((target.role === "owner" || nextRole === "owner") && c.role !== "owner") throw forbidden("Only an owner can grant or remove the owner role");
    if (target.userId.equals(c.userId!)) throw rule("You can't change your own role");
    if (target.role === "owner" && nextRole !== "owner") {
      const owners = await MembershipModel.countDocuments({ orgId: c.orgId, role: "owner", status: "active" });
      if (owners <= 1) throw rule("An organization needs at least one owner");
    }
    return target;
  }

  async changeRole(membershipId: Types.ObjectId, role: Role) {
    await tx(async () => {
      const target = await this.guardChange(membershipId, role);
      await MembershipModel.updateOne({ _id: target._id }, { $set: { role } });
      await audit("member.role_changed", "membership", target._id, { from: target.role, to: role });
    });
  }

  async remove(membershipId: Types.ObjectId) {
    await tx(async () => {
      const target = await this.guardChange(membershipId, null);
      await MembershipModel.updateOne({ _id: target._id }, { $set: { status: "removed" } });
      await audit("member.removed", "membership", target._id, { role: target.role });
    });
  }

  async invite(input: { email: string; role: Role }) {
    const c = ctx();
    if (input.role === "owner" && c.role !== "owner") throw forbidden("Only an owner can grant or remove the owner role");
    const token = randomBytes(32).toString("base64url");
    const [inv] = await InvitationModel.create([{
      orgId: c.orgId, email: input.email, role: input.role, tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000), invitedBy: c.userId,
    }]);
    const link = `${env.WEB_ORIGIN}/invite/${token}`;
    // The email itself is sent by a mail.send job (plan 05, Task 5.3).
    await this.onInvite?.(input.email, link);
    await audit("member.invited", "invitation", inv._id, { email: input.email, role: input.role });
    return { id: String(inv._id), link: env.NODE_ENV === "production" ? undefined : link };
  }

  /** Set by the mail module (plan 05) so this service doesn't depend on it. */
  onInvite?: (email: string, link: string) => Promise<void>;

  async invitations(): Promise<InvitationDto[]> {
    const { orgId } = ctx();
    const list = await InvitationModel.find({ orgId, acceptedAt: null, revokedAt: null, expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 }).lean();
    return list.map((i) => ({ id: String(i._id), email: i.email, role: i.role as Role, expiresAt: i.expiresAt, createdAt: i.createdAt }));
  }

  async revokeInvitation(id: Types.ObjectId) {
    const { orgId } = ctx();
    await InvitationModel.updateOne({ _id: id, orgId, acceptedAt: null }, { $set: { revokedAt: new Date() } });
  }

  async acceptInvitation(token: string) {
    const u = currentUser();
    const inv = await InvitationModel.findOne({ tokenHash: sha256(token), acceptedAt: null, revokedAt: null }).lean();
    if (!inv || inv.expiresAt < new Date()) throw rule("This invitation has expired or was already used");
    if (inv.email !== u.email.toLowerCase()) throw rule("This invitation was sent to another email address");
    await MembershipModel.updateOne(
      { orgId: inv.orgId, userId: u.id },
      { $set: { role: inv.role, status: "active", invitedBy: inv.invitedBy } },
      { upsert: true },
    );
    await InvitationModel.updateOne({ _id: inv._id }, { $set: { acceptedAt: new Date() } });
    return { orgId: String(inv.orgId) };
  }
}
```

`acceptInvitation` runs on a `@NoOrg` route, so there's no tenant context and these writes aren't in a transaction. Accepting the same token twice is harmless: the membership upsert is idempotent and `acceptedAt` blocks the second try.

- [x] **Step 5: Write `src/orgs/orgs.controller.ts`**

```ts
import { Controller, Delete, Get, Patch, Post } from "@nestjs/common";
import { Types } from "mongoose";
import { acceptInviteInput, createOrgInput, inviteInput, roleInput, type Role } from "@veenix/shared";
import { Can, NoOrg } from "../common/decorators";
import { OidParam } from "../common/oid";
import { ZBody } from "../common/zod";
import { OrgsService } from "./orgs.service";

@Controller()
export class OrgsController {
  constructor(private readonly orgs: OrgsService) {}

  @NoOrg() @Get("me") me() { return this.orgs.me(); }
  @NoOrg() @Post("orgs") create(@ZBody(createOrgInput) body: { companyName: string }) { return this.orgs.create(body); }
  @NoOrg() @Post("invitations/accept") accept(@ZBody(acceptInviteInput) body: { token: string }) { return this.orgs.acceptInvitation(body.token); }

  @Can("member:manage") @Get("org/members") members() { return this.orgs.members(); }
  @Can("member:manage") @Patch("org/members/:id") role(@OidParam("id") id: Types.ObjectId, @ZBody(roleInput) body: { role: Role }) { return this.orgs.changeRole(id, body.role); }
  @Can("member:manage") @Delete("org/members/:id") remove(@OidParam("id") id: Types.ObjectId) { return this.orgs.remove(id); }
  @Can("member:manage") @Get("org/invitations") invitations() { return this.orgs.invitations(); }
  @Can("member:manage") @Post("org/invitations") invite(@ZBody(inviteInput) body: { email: string; role: Role }) { return this.orgs.invite(body); }
  @Can("member:manage") @Delete("org/invitations/:id") revoke(@OidParam("id") id: Types.ObjectId) { return this.orgs.revokeInvitation(id); }
}
```

Register `OrgsController` in `AppModule.controllers` and `OrgsService` in `AppModule.providers`.

- [x] **Step 6: Run the tests**

Run: `pnpm --filter api test orgs`
Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add apps/api
git commit -m "feat(api): organizations, memberships with owner rules, invitations"
```

---

### Task 4.5: AccessGuard, project scope, rate limit

**Files:**
- Create: `apps/api/src/common/redis.ts`, `apps/api/src/common/rate-limit.ts`, `apps/api/src/auth/access.guard.ts`
- Modify: `apps/api/src/app.module.ts` (register `APP_GUARD`)
- Test: `apps/api/test/access.e2e.test.ts`

**Interfaces:**
- Consumes: `verifyIdentity`, `userFor` (Task 4.3); `MembershipModel` (Task 4.4); `can`, `isProjectScoped` and `Permission` from shared; the decorators from Task 3.1.
- Produces:
  - `redis` (a shared ioredis client)
  - `rateLimit(key, perMinute)`
  - `AccessGuard`
  - `assignedProjectIds(orgId, userId)`: reads `projects.assignees.userId` through the raw driver collection, so it runs before a context exists. The `projects` collection is created in plan 06; until then the lookup returns `[]`.

- [x] **Step 1: Write `src/common/redis.ts` and `src/common/rate-limit.ts`**

```ts
// redis.ts
import Redis from "ioredis";
import { env } from "../config/env";

const g = globalThis as unknown as { __veenixRedis?: Redis };
export const redis = (g.__veenixRedis ??= new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2, enableOfflineQueue: true }));
```

```ts
// rate-limit.ts
import { AppError } from "./errors";
import { redis } from "./redis";

// ponytail: fixed one-minute window shared through Redis; allows up to 2x the limit across a window boundary. Switch to a sliding window if that matters.
export async function rateLimit(key: string, perMinute: number) {
  const bucket = `rl:${key}:${Math.floor(Date.now() / 60_000)}`;
  const count = await redis.incr(bucket);
  if (count === 1) await redis.expire(bucket, 65);
  if (count > perMinute) throw new AppError("RATE_LIMITED", "Too many requests. Wait a minute and try again.", 429);
}
```

- [x] **Step 2: Write `src/auth/access.guard.ts`**

```ts
import { CanActivate, ExecutionContext, Injectable, Logger } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import mongoose, { Types } from "mongoose";
import type { Request } from "express";
import { can, isProjectScoped, type Permission, type Role } from "@veenix/shared";
import { IS_PUBLIC, NO_ORG, PERMISSIONS, RATE_LIMIT } from "../common/decorators";
import { AppError, forbidden, unauthenticated } from "../common/errors";
import { setCtx, setUser } from "../common/context";
import { rateLimit } from "../common/rate-limit";
import { verifyIdentity } from "./identity";
import { userFor } from "../users/users";
import { MembershipModel } from "../orgs/membership.model";

/** Project ids where this user is an assignee. The raw driver is used because no tenant context exists yet. */
export async function assignedProjectIds(orgId: Types.ObjectId, userId: Types.ObjectId): Promise<Types.ObjectId[]> {
  const ids = await mongoose.connection.collection("projects").distinct("_id", { orgId, "assignees.userId": userId });
  return ids as Types.ObjectId[];
}

@Injectable()
export class AccessGuard implements CanActivate {
  private readonly log = new Logger("AccessGuard");
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const meta = <T>(key: string) => this.reflector.getAllAndOverride<T | undefined>(key, [context.getHandler(), context.getClass()]);
    if (meta<boolean>(IS_PUBLIC)) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const header = req.header("authorization") ?? "";
    if (!header.startsWith("Bearer ")) throw unauthenticated();
    const user = await userFor(await verifyIdentity(header.slice(7)));
    setUser(user);
    await rateLimit(`u:${user.id}`, meta<number>(RATE_LIMIT) ?? 600);

    if (meta<boolean>(NO_ORG)) return true;

    const required = meta<Permission[]>(PERMISSIONS);
    if (!required) {
      this.log.error(`Route ${req.method} ${req.path} has no @Can(); refusing`);
      throw new AppError("INTERNAL", "Something went wrong. Try again.", 500);
    }

    const orgHeader = req.header("x-org-id") ?? "";
    if (!/^[a-f\d]{24}$/i.test(orgHeader)) throw forbidden("Choose an organization first");
    const orgId = new Types.ObjectId(orgHeader);
    const membership = await MembershipModel.findOne({ orgId, userId: user.id, status: "active" }).lean();
    if (!membership) throw forbidden("You are not a member of this organization");
    const role = membership.role as Role;
    for (const p of required) if (!can(role, p)) throw forbidden();

    setCtx({
      userId: user.id,
      orgId,
      role,
      projectScope: isProjectScoped(role) ? await assignedProjectIds(orgId, user.id) : "all",
      inTx: false,
      afterCommit: [],
    });
    return true;
  }
}
```

Register it in `AppModule.providers`: `{ provide: APP_GUARD, useClass: AccessGuard }`.

- [x] **Step 3: Write the e2e test** `test/access.e2e.test.ts`

```ts
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { Controller, Get, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ClsModule } from "nestjs-cls";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { AccessGuard } from "../src/auth/access.guard";
import { ErrorFilter } from "../src/common/error.filter";
import { Can } from "../src/common/decorators";
import { ctx } from "../src/common/context";
import { useJwksForTests } from "../src/auth/identity";
import { MembershipModel } from "../src/orgs/membership.model";
import { UserModel } from "../src/users/user.model";
import { env } from "../src/config/env";
import { newId } from "./ctx";

@Controller()
class ProbeController {
  @Can("bom:write") @Get("probe") probe() { return { role: ctx().role }; }
  @Get("unguarded") unguarded() { return { ok: true }; }
}

let app: INestApplication;
let token: (claims?: Record<string, unknown>) => Promise<string>;
const orgId = newId();

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair("EdDSA", { crv: "Ed25519" });
  useJwksForTests(createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: "t", alg: "EdDSA" }] }));
  token = (claims = {}) =>
    new SignJWT({ email: "pm@x.my", name: "PM", ev: true, mfa: true, sct: Date.now(), ...claims })
      .setProtectedHeader({ alg: "EdDSA", kid: "t" }).setSubject("sub-pm").setIssuer(env.AUTH_ISSUER).setAudience(env.AUTH_AUDIENCE).setExpirationTime("10m").sign(privateKey);

  const mod = await Test.createTestingModule({
    imports: [ClsModule.forRoot({ global: true, middleware: { mount: true } })],
    controllers: [ProbeController],
    providers: [{ provide: APP_GUARD, useClass: AccessGuard }, { provide: APP_FILTER, useClass: ErrorFilter }],
  }).compile();
  app = mod.createNestApplication();
  await app.init();
});

describe("AccessGuard", () => {
  it("requires MFA", async () => {
    const res = await request(app.getHttpServer()).get("/probe").set("authorization", `Bearer ${await token({ mfa: false })}`).set("x-org-id", String(orgId));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("MFA_REQUIRED");
  });

  it("checks the membership on every request and applies the matrix", async () => {
    const auth = { authorization: `Bearer ${await token()}`, "x-org-id": String(orgId) };
    expect((await request(app.getHttpServer()).get("/probe").set(auth)).status).toBe(403); // not a member yet

    const user = await UserModel.findOne({ authSubject: "sub-pm" }).lean();
    await MembershipModel.create([{ orgId, userId: user!._id, role: "project_manager" }]);
    const ok = await request(app.getHttpServer()).get("/probe").set(auth);
    expect(ok.status).toBe(200);
    expect(ok.body.role).toBe("project_manager");

    await MembershipModel.updateOne({ orgId, userId: user!._id }, { status: "removed" });
    expect((await request(app.getHttpServer()).get("/probe").set(auth)).status).toBe(403);
  });

  it("refuses org routes that forgot @Can", async () => {
    const res = await request(app.getHttpServer()).get("/unguarded").set("authorization", `Bearer ${await token()}`).set("x-org-id", String(orgId));
    expect(res.status).toBe(500);
  });
});
```

- [x] **Step 4: Run the tests**

Run: `pnpm --filter api test`
Expected: PASS. Redis must be running (`pnpm services:up`).

- [x] **Step 5: Smoke-test the toolchain** (jose 6 is ESM-only, so this proves `require(esm)` works in the compiled output)

```bash
pnpm --filter api build && (cd apps/api && node dist/main.js & sleep 4; curl -s http://localhost:4000/v1/health; kill %1)
```
Expected: `{"ok":true}`. `ERR_REQUIRE_ESM` here means Node is older than 22.12.

- [x] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): access guard with membership, permission matrix, project scope and rate limit"
```

---

### Task 4.6: Web session helpers, onboarding, organization switcher

**Files:**
- Create: `apps/web/lib/session.ts`, `apps/web/middleware.ts`, `apps/web/app/(auth)/onboarding/page.tsx`, `apps/web/app/(auth)/onboarding/actions.ts`, `apps/web/app/(auth)/invite/[token]/page.tsx`, `apps/web/components/OrgSwitcher.tsx`
- Modify: `apps/web/app/(dashboard)/layout.tsx`, `apps/web/components/NavBar.tsx`, `apps/web/lib/user.ts` (delete it)

**Interfaces:**
- Consumes: `auth` (Task 4.1); `apiRaw` (Task 8.1). **For this task only**, write the small `apiRaw` described in Step 2. Task 8.1 grows it into the full client.
- Produces:
  - `requireSession(): Promise<{ user, session }>`: redirects to `/login`, `/verify-email` or `/setup-mfa`, and signs out after 7 days
  - `requireOrg(): Promise<{ me: MeDto; orgId: string; role: Role }>`: redirects to `/onboarding` when the user has no membership
  - the `veenix_org` cookie
  - `<OrgSwitcher />`

- [x] **Step 1: Write `apps/web/middleware.ts`** (a cheap cookie check; the real checks happen in `requireSession`)

```ts
import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

const PUBLIC = ["/login", "/signup", "/verify-email", "/verify-mfa", "/forgot-password", "/reset-password", "/api/auth"];

export function middleware(req: NextRequest) {
  if (PUBLIC.some((p) => req.nextUrl.pathname.startsWith(p))) return NextResponse.next();
  if (!getSessionCookie(req)) return NextResponse.redirect(new URL("/login", req.url));
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/|favicon.ico).*)"] };
```

- [x] **Step 2: Write `apps/web/lib/session.ts`**

```ts
import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { MeDto, Role } from "@veenix/shared";
import { auth } from "./auth";

const ABSOLUTE_SESSION_MS = 7 * 86_400_000;
export const ORG_COOKIE = "veenix_org";

export const requireSession = cache(async () => {
  const s = await auth.api.getSession({ headers: headers() });
  if (!s) redirect("/login");
  if (!s.user.emailVerified) redirect(`/verify-email?email=${encodeURIComponent(s.user.email)}`);
  if (!(s.user as { twoFactorEnabled?: boolean }).twoFactorEnabled) redirect("/setup-mfa");
  if (Date.now() - new Date(s.session.createdAt).getTime() > ABSOLUTE_SESSION_MS) {
    await auth.api.signOut({ headers: headers() });
    redirect("/login");
  }
  return s;
});

/** A JWT for the API, minted once per request. */
export const apiToken = cache(async () => {
  await requireSession();
  const { token } = await auth.api.getToken({ headers: headers() });
  return token;
});

/** Minimal API call used before plan 08's full client exists. */
export async function apiRaw<T>(path: string, init: { method?: string; body?: unknown; orgId?: string } = {}): Promise<T> {
  const res = await fetch(`${process.env.API_URL}/v1${path}`, {
    method: init.method ?? "GET",
    headers: {
      authorization: `Bearer ${await apiToken()}`,
      "content-type": "application/json",
      ...(init.orgId ? { "x-org-id": init.orgId } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message ?? "Request failed");
  return data as T;
}

export const requireOrg = cache(async (): Promise<{ me: MeDto; orgId: string; role: Role }> => {
  const me = await apiRaw<MeDto>("/me");
  if (me.memberships.length === 0) redirect("/onboarding");
  const chosen = cookies().get(ORG_COOKIE)?.value;
  const m = me.memberships.find((x) => x.orgId === chosen) ?? me.memberships[0];
  return { me, orgId: m.orgId, role: m.role };
});
```

⚠ Verify: `auth.api.getToken` is the server-side name for the JWT plugin's `/token` endpoint in the installed version.

- [x] **Step 3: Onboarding and invitations**

`app/(auth)/onboarding/actions.ts`:
```ts
"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { apiRaw, ORG_COOKIE } from "@/lib/session";

export async function createOrganization(form: FormData) {
  const { orgId } = await apiRaw<{ orgId: string }>("/orgs", { method: "POST", body: { companyName: String(form.get("companyName") ?? "").trim() } });
  cookies().set(ORG_COOKIE, orgId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
  redirect("/");
}

export async function acceptInvitation(token: string) {
  const { orgId } = await apiRaw<{ orgId: string }>("/invitations/accept", { method: "POST", body: { token } });
  cookies().set(ORG_COOKIE, orgId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
  redirect("/");
}

export async function switchOrganization(orgId: string) {
  cookies().set(ORG_COOKIE, orgId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
  redirect("/");
}
```

`app/(auth)/onboarding/page.tsx`:
- A server component that calls `requireSession()`.
- It shows a "Your company name" form posting to `createOrganization`, with the text "Were you invited? Open the link in your invitation email instead."
- Exception: if `apiRaw<MeDto>("/me")` already returns memberships, `redirect("/")`.

`app/(auth)/invite/[token]/page.tsx`:
- A server component that calls `requireSession()` (so the person signs up or in first; the middleware sends them to `/login`).
- It renders a single "Join the organization" button whose form action is `acceptInvitation.bind(null, params.token)`.
- Errors from the API ("This invitation was sent to another email address") show through Next's error boundary for now.

Don't add `/invite` to the middleware's `PUBLIC` list: accepting an invitation needs a signed-in user.

- [x] **Step 4: Use the real user in the dashboard shell**

`app/(dashboard)/layout.tsx`:
```tsx
import { NavBar } from "@/components/NavBar";
import { requireOrg, requireSession } from "@/lib/session";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireSession();
  const { me, orgId } = await requireOrg();
  return (
    <div className="min-h-screen bg-background">
      <NavBar userName={user.name} orgs={me.memberships} currentOrgId={orgId} />
      <main className="mx-auto max-w-[1400px] px-6 py-6">{children}</main>
    </div>
  );
}
```

In `components/NavBar.tsx`:
- Accept `userName`, `orgs` and `currentOrgId` props.
- Replace every use of `CURRENT_USER.name` with `userName`.
- Render `<OrgSwitcher orgs={orgs} currentOrgId={currentOrgId} />` next to the user menu when `orgs.length > 1`.
- Make the avatar a `DropdownMenu` trigger (there's no user menu yet) and add a "Sign out" item calling `authClient.signOut()` then `window.location.href = "/login"`.

`components/OrgSwitcher.tsx`: a `DropdownMenu` listing `orgs[].companyName`. Each item is a `<form action={switchOrganization.bind(null, org.orgId)}>` with a submit button.

Delete `lib/user.ts`. Then `grep -rn "CURRENT_USER" apps/web` and replace each use:
- On the home page greeting, use `(await requireSession()).user.name`.
- In `actions/leads.ts` (the activity author), the API stamps the author in plan 06, so drop the argument; until then the action uses `(await requireSession()).user.name`.
- `components/leads/LogActivityForm.tsx` (a client component): the initials come from `authClient.useSession()`.
- `components/projects/QuotationTab.tsx` (a server component): `ThreadEntry` becomes async and uses `(await requireSession()).user.name`.

- [x] **Step 5: Check it end to end**

With the API (`pnpm --filter api dev`) and web (`pnpm --filter web dev`) both running:
1. Sign up and set up MFA.
2. `/onboarding` → create "Test Interior".
3. You land on `/`. The page still shows Prisma data until plan 08; that's expected.
4. `curl` isn't needed: the API log shows `GET /v1/me` 200.

Expected: no redirect loops, and the nav shows your name.

- [x] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): session guard, onboarding, invitations and organization switcher"
```
