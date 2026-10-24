# 03: API foundation

> For whoever implements this (you or Claude): work task by task and tick each one off in [../README.md](../README.md).

**Goal:** a NestJS app in `apps/api` with validated config, a Mongo connection that is reused across serverless invocations, a per-request context, a tenant plugin that fails closed, uniform errors, Zod validation, transactions with after-commit hooks, per-organization document codes, and an audit log.

**Architecture:**
- One Nest `AppModule`; plain Mongoose models (no `@nestjs/mongoose`).
- The request context lives in AsyncLocalStorage through `nestjs-cls`, so Mongoose middleware can read it outside Nest's dependency injection.
- Every later module builds on the files from this plan.

**Tech stack:** NestJS 11 (Express), Mongoose 8, nestjs-cls, Zod 4, Vitest 3 + unplugin-swc, Node 24.

**Spec:** [../spec.md](../spec.md) §5, §9, §17.

## Global constraints
- `apps/api/tsconfig.json` extends `tsconfig.base.json` (`module: nodenext`, CommonJS output). TypeScript ≥ 5.8, so ESM-only packages can be `require`d.
- `mongoose.set('strictQuery', 'throw')` and `mongoose.set('transactionAsyncLocalStorage', true)` are set once, in `connectDb`.
- **Never use these on tenant models:** `insertMany`, `bulkWrite`, `estimatedDocumentCount`, `doc.deleteOne()`.
- Every API route is under `/v1`.

## Review focus
- **Context missing during a query:** a tenant query outside a request (for example, a forgotten `runWithCtx` in a script) must throw `No request context`, never run unscoped. Tested in Task 3.3.
- **Project manager reading an unassigned project by id:** must return nothing (the controller turns that into 404). Tested in Task 3.3.
- **Two codes created at the same moment:** `nextCode` must never hand out the same code twice. Tested with 10 parallel calls in Task 3.4.
- **A rolled-back transaction:** its after-commit hooks must not run. Tested in Task 3.4.
- **A duplicate key from a unique index:** the API answers 409 `DUPLICATE`, not 500. Tested in Task 3.2.

---

### Task 3.1: Scaffold, env, health

**Files:**
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/nest-cli.json`, `apps/api/vitest.config.ts`, `apps/api/.env`, `apps/api/.env.example`
- Create: `apps/api/src/main.ts`, `src/app.factory.ts`, `src/app.module.ts`, `src/config/env.ts`, `src/common/decorators.ts`, `src/health.controller.ts`

**Interfaces:**
- Produces:
  - `env` (typed config)
  - `createApp(): Promise<NestExpressApplication>`
  - decorators `@Public()`, `@NoOrg()`, `@Can(...permissions)`, `@RateLimit(perMinute)` and their metadata keys `IS_PUBLIC`, `NO_ORG`, `PERMISSIONS`, `RATE_LIMIT`
  - the route `GET /v1/health`

- [x] **Step 1: Write `apps/api/package.json`**

```json
{
  "name": "api",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "dev": "nest start --watch",
    "build": "nest build",
    "start": "node dist/main.js",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

- [x] **Step 2: Install the dependencies**

```bash
pnpm --filter api add @nestjs/common@^11 @nestjs/core@^11 @nestjs/platform-express@^11 reflect-metadata rxjs mongoose@^8 nestjs-cls zod@^4 helmet "@veenix/shared@workspace:*"
pnpm --filter api add -D @nestjs/cli@^11 @nestjs/testing@^11 typescript@^5.8 vitest@^3 unplugin-swc @swc/core supertest @types/supertest @types/express @types/node@^24 tsx
```

- [x] **Step 3: Write `apps/api/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "jsx": "react-jsx",
    "declaration": false,
    "strictPropertyInitialization": false
  },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts"]
}
```

`apps/api/nest-cli.json`:
```json
{ "$schema": "https://json.schemastore.org/nest-cli", "collection": "@nestjs/schematics", "sourceRoot": "src", "compilerOptions": { "deleteOutDir": true } }
```

`apps/api/vitest.config.ts` (SWC keeps the decorator metadata that Nest's dependency injection needs):
```ts
import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    setupFiles: ["./test/setup.ts"],
    pool: "forks",
    testTimeout: 20_000,
  },
  plugins: [swc.vite({ module: { type: "es6" } })],
});
```

- [x] **Step 4: Write `apps/api/.env`** (git-ignored) and the same file with placeholder secrets as `apps/api/.env.example`

Generate each secret with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.

```bash
NODE_ENV=development
PORT=4000
WEB_ORIGIN=http://localhost:3100
MONGODB_URI=mongodb://veenix:veenix-dev-only@localhost:27017/veenix?authSource=admin&directConnection=true
REDIS_URL=redis://localhost:6380
AUTH_JWKS_URL=http://localhost:3100/api/auth/jwks
AUTH_ISSUER=http://localhost:3100
AUTH_AUDIENCE=veenix-api
SIGNUP_MODE=open
LIVE_TICKET_SECRET=<random>
CRON_SECRET=<random>
FIELD_ENCRYPTION_KEY=<random>
S3_ENDPOINT=http://localhost:8333
S3_REGION=us-east-1
S3_BUCKET=veenix-dev
S3_ACCESS_KEY_ID=veenix
S3_SECRET_ACCESS_KEY=veenix-dev-secret
S3_FORCE_PATH_STYLE=true
SMTP_URL=smtp://localhost:1025
MAIL_FROM="Veenix <no-reply@veenix.local>"
```

- [x] **Step 5: Write `src/config/env.ts`**

```ts
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
});

export const env = schema.parse(process.env);
```

- [x] **Step 6: Write `src/common/decorators.ts`**

```ts
import { SetMetadata } from "@nestjs/common";
import type { Permission } from "@veenix/shared";

export const IS_PUBLIC = "veenix:public";
export const NO_ORG = "veenix:no-org";
export const PERMISSIONS = "veenix:permissions";
export const RATE_LIMIT = "veenix:rate-limit";

/** No sign-in needed (health, cron with its own secret, the SSE stream with its ticket). */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Signed in, but no organization needed (/me, create organization, accept invitation). */
export const NoOrg = () => SetMetadata(NO_ORG, true);
/** Org route permissions. `@Can()` with no arguments means "any member". Routes without @Can are refused (fail closed). */
export const Can = (...permissions: Permission[]) => SetMetadata(PERMISSIONS, permissions);
/** Per-user requests per minute for this route (the default is 600). */
export const RateLimit = (perMinute: number) => SetMetadata(RATE_LIMIT, perMinute);
```

- [x] **Step 7: Write the app files**

`src/health.controller.ts`:
```ts
import { Controller, Get } from "@nestjs/common";
import mongoose from "mongoose";
import { Public } from "./common/decorators";

@Controller("health")
export class HealthController {
  @Public()
  @Get()
  async get() {
    await mongoose.connection.db!.admin().ping();
    return { ok: true };
  }
}
```

`src/app.module.ts`:
```ts
import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { ClsModule } from "nestjs-cls";
import { HealthController } from "./health.controller";
import { ErrorFilter } from "./common/error.filter";

// One module for the whole API. Later tasks append to `controllers` and `providers`.
@Module({
  imports: [ClsModule.forRoot({ global: true, middleware: { mount: true } })],
  controllers: [HealthController],
  providers: [{ provide: APP_FILTER, useClass: ErrorFilter }],
})
export class AppModule {}
```

`src/app.factory.ts`:
```ts
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { connectDb } from "./common/db";
import { env } from "./config/env";

export async function createApp() {
  await connectDb();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.setGlobalPrefix("v1");
  app.use(helmet());
  app.useBodyParser("json", { limit: "1mb" });
  // The browser calls the API directly only for the SSE stream.
  app.enableCors({ origin: env.WEB_ORIGIN, methods: ["GET"] });
  app.enableShutdownHooks();
  return app;
}
```

`src/main.ts`:
```ts
import "reflect-metadata";
import { createApp } from "./app.factory";
import { env } from "./config/env";

async function bootstrap() {
  const app = await createApp();
  await app.listen(env.PORT);
}
void bootstrap();
```

`ErrorFilter` and `connectDb` come in Task 3.2. Write that task's `src/common/db.ts` and `src/common/error.filter.ts` now, or the build in the next step fails.

- [x] **Step 8: Run it**

```bash
pnpm services:up
pnpm --filter @veenix/shared build
pnpm --filter api dev
curl -s http://localhost:4000/v1/health
```
Expected: `{"ok":true}`

- [x] **Step 9: Commit**

```bash
git add apps/api pnpm-lock.yaml
git commit -m "feat(api): NestJS scaffold with validated env and health check"
```

---

### Task 3.2: Mongo connection, context, errors, validation, `plain()`

**Files:**
- Create: `src/common/db.ts`, `src/common/context.ts`, `src/common/errors.ts`, `src/common/error.filter.ts`, `src/common/zod.ts`, `src/common/oid.ts`, `src/common/plain.ts` (all under `apps/api/`)
- Create: `apps/api/test/setup.ts`, `apps/api/test/ctx.ts`
- Test: `apps/api/src/common/common.test.ts`

**Interfaces:**
- Produces:
  - `connectDb(uri?, dbName?)`
  - `type ProjectScope = 'all' | Types.ObjectId[]`
  - `interface RequestContext { userId: Types.ObjectId | null; orgId: Types.ObjectId; role: Role | 'system'; projectScope: ProjectScope; inTx: boolean; afterCommit: (() => unknown)[] }`
  - `ctx(): RequestContext` (throws `No request context`), `getCtx()`, `setCtx(c)`, `runWithCtx(c, fn)`, `systemCtx(orgId)`
  - `interface CurrentUser { id: Types.ObjectId; email: string; name: string; platformRole: 'superadmin' | null }`, `setUser(u)`, `currentUser()`
  - `class AppError(code, message, status = 422, details?)`, `rule(message)`, `notFound(what?)`, `forbidden(message?)`, `unauthenticated(code?, message?)`
  - `ErrorFilter`, `toErrorResponse(e)`
  - `ZodPipe`, `ZBody(schema)`, `ZQuery(schema)`
  - `oid(value, what?)`, `OidParam(name)`
  - `plain<T>(value): T`
  - test helpers `asOrg(orgId, fn, over?)`, `newId()`

- [x] **Step 1: Write the failing test** `src/common/common.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { Types } from "mongoose";
import { AppError } from "./errors";
import { toErrorResponse } from "./error.filter";
import { ctx } from "./context";
import { plain } from "./plain";
import { ZodPipe } from "./zod";
import { leadInput } from "@veenix/shared";

describe("common", () => {
  it("refuses to give a context outside a request", () => {
    expect(() => ctx()).toThrow("No request context");
  });
  it("maps errors to the API error shape", () => {
    expect(toErrorResponse(new AppError("RULE", "Only a draft can be sent"))).toEqual({ status: 422, body: { error: { code: "RULE", message: "Only a draft can be sent" } } });
    expect(toErrorResponse({ code: 11000 }).status).toBe(409);
    expect(toErrorResponse(new Error("boom"))).toEqual({ status: 500, body: { error: { code: "INTERNAL", message: "Something went wrong. Try again." } } });
  });
  it("turns documents into DTO-shaped plain objects", () => {
    const id = new Types.ObjectId();
    expect(plain({ _id: id, orgId: id, __v: 3, items: [{ _id: id, at: new Date(0) }] })).toEqual({ id: id.toHexString(), items: [{ id: id.toHexString(), at: new Date(0) }] });
  });
  it("validates bodies with the schema's own message", () => {
    expect(() => new ZodPipe(leadInput).transform({ name: "", phone: "1" })).toThrow("Lead name is required");
  });
});
```

- [x] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter api test common`
Expected: FAIL (modules missing).

- [x] **Step 3: Write `src/common/db.ts`**

```ts
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
```
⚠ Verify: `transactionAsyncLocalStorage` exists in the installed Mongoose (added in 8.4).

- [x] **Step 4: Write `src/common/context.ts`**

```ts
import { ClsServiceManager } from "nestjs-cls";
import { Types } from "mongoose";
import type { Role } from "@veenix/shared";

export type ProjectScope = "all" | Types.ObjectId[];

export interface RequestContext {
  userId: Types.ObjectId | null; // null for system work (jobs, migration)
  orgId: Types.ObjectId;
  role: Role | "system";
  projectScope: ProjectScope;
  inTx: boolean;
  afterCommit: (() => unknown)[];
}

export interface CurrentUser {
  id: Types.ObjectId;
  email: string;
  name: string;
  platformRole: "superadmin" | null;
}

const CTX = "veenix:ctx";
const USER = "veenix:user";
const cls = () => ClsServiceManager.getClsService();

export function getCtx(): RequestContext | undefined {
  return cls().isActive() ? cls().get(CTX) : undefined;
}

export function ctx(): RequestContext {
  const c = getCtx();
  if (!c) throw new Error("No request context");
  return c;
}

export function setCtx(c: RequestContext) {
  cls().set(CTX, c);
}

export function setUser(u: CurrentUser) {
  cls().set(USER, u);
}

export function currentUser(): CurrentUser {
  const u = cls().isActive() ? (cls().get(USER) as CurrentUser | undefined) : undefined;
  if (!u) throw new Error("No signed-in user");
  return u;
}

export function runWithCtx<T>(c: RequestContext, fn: () => Promise<T>): Promise<T> {
  // Awaited inside run() so a lazy thenable (a Mongoose Query) executes with the context.
  return cls().run(async () => {
    setCtx(c);
    return await fn();
  });
}

export function systemCtx(orgId: Types.ObjectId): RequestContext {
  return { userId: null, orgId, role: "system", projectScope: "all", inTx: false, afterCommit: [] };
}
```

- [x] **Step 5: Write `src/common/errors.ts` and `src/common/error.filter.ts`**

```ts
// errors.ts
export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 422,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/** A business rule refused the action. The message is shown to the user as is. */
export const rule = (message: string) => new AppError("RULE", message, 422);
export const notFound = (what = "Record") => new AppError("NOT_FOUND", `${what} not found`, 404);
export const forbidden = (message = "Your role cannot do this") => new AppError("FORBIDDEN", message, 403);
export const unauthenticated = (code = "UNAUTHENTICATED", message = "Sign in required") => new AppError(code, message, 401);
```

```ts
// error.filter.ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from "@nestjs/common";
import type { Response } from "express";
import mongoose from "mongoose";
import { AppError } from "./errors";

type Body = { error: { code: string; message: string; details?: unknown } };

export function toErrorResponse(e: unknown): { status: number; body: Body } {
  if (e instanceof AppError) {
    const error: Body["error"] = { code: e.code, message: e.message };
    if (e.details !== undefined) error.details = e.details;
    return { status: e.status, body: { error } };
  }
  if (e instanceof mongoose.Error.VersionError)
    return { status: 409, body: { error: { code: "CONFLICT", message: "Someone else changed this just now. Refresh and try again." } } };
  if (typeof e === "object" && e !== null && (e as { code?: unknown }).code === 11000)
    return { status: 409, body: { error: { code: "DUPLICATE", message: "That already exists." } } };
  if (e instanceof HttpException) {
    const status = e.getStatus();
    return { status, body: { error: { code: status === 404 ? "NOT_FOUND" : "HTTP", message: e.message } } };
  }
  return { status: 500, body: { error: { code: "INTERNAL", message: "Something went wrong. Try again." } } };
}

@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly log = new Logger("Error");

  catch(e: unknown, host: ArgumentsHost) {
    const { status, body } = toErrorResponse(e);
    if (status >= 500) this.log.error(e instanceof Error ? e.stack : String(e));
    host.switchToHttp().getResponse<Response>().status(status).json(body);
  }
}
```

- [x] **Step 6: Write `src/common/zod.ts`, `src/common/oid.ts`, `src/common/plain.ts`**

```ts
// zod.ts
import { Body, PipeTransform, Query } from "@nestjs/common";
import type { ZodType } from "zod";
import { AppError } from "./errors";

export class ZodPipe implements PipeTransform {
  constructor(private readonly schema: ZodType) {}

  transform(value: unknown) {
    const r = this.schema.safeParse(value);
    if (r.success) return r.data;
    const issues = r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    throw new AppError("VALIDATION", issues[0]?.message ?? "Invalid input", 400, issues);
  }
}

export const ZBody = (schema: ZodType) => Body(new ZodPipe(schema));
export const ZQuery = (schema: ZodType) => Query(new ZodPipe(schema));
```

```ts
// oid.ts
import { Param, PipeTransform } from "@nestjs/common";
import { Types } from "mongoose";
import { notFound } from "./errors";

/** A 24-hex id or a 404. An invalid id is reported as "not found" so it reveals nothing. */
export function oid(value: unknown, what = "Record"): Types.ObjectId {
  if (typeof value !== "string" || !/^[a-f\d]{24}$/i.test(value)) throw notFound(what);
  return new Types.ObjectId(value);
}

class ParseOid implements PipeTransform<string, Types.ObjectId> {
  transform(value: string) {
    return oid(value);
  }
}

export const OidParam = (name: string) => Param(name, new ParseOid());
```

```ts
// plain.ts
/** Mongo document → DTO-shaped object: _id → id, ObjectIds → hex strings, orgId and __v dropped. */
export function plain<T = unknown>(value: unknown): T {
  if (value === null || typeof value !== "object" || value instanceof Date) return value as T;
  if ((value as { _bsontype?: string })._bsontype === "ObjectId") return (value as { toHexString(): string }).toHexString() as T;
  if (Array.isArray(value)) return value.map((v) => plain(v)) as T;
  const source = typeof (value as { toObject?: unknown }).toObject === "function" ? (value as { toObject(): object }).toObject() : value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(source)) {
    if (k === "orgId" || k === "__v") continue;
    out[k === "_id" ? "id" : k] = plain(v);
  }
  return out as T;
}
```

- [x] **Step 7: Write the test helpers**

`apps/api/test/setup.ts`:
```ts
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
```

`apps/api/test/ctx.ts`:
```ts
import { Types } from "mongoose";
import { runWithCtx, type RequestContext } from "../src/common/context";

export const newId = () => new Types.ObjectId();

export function asOrg<T>(orgId: Types.ObjectId, fn: () => Promise<T>, over: Partial<RequestContext> = {}) {
  return runWithCtx({ userId: newId(), orgId, role: "owner", projectScope: "all", inTx: false, afterCommit: [], ...over }, fn);
}
```

- [x] **Step 8: Run the tests**

Run: `pnpm --filter api test`
Expected: PASS.

- [x] **Step 9: Commit**

```bash
git add apps/api
git commit -m "feat(api): db connection, request context, errors, validation, plain()"
```

---

### Task 3.3: Tenant plugin and `Sen` type

**Files:**
- Create: `apps/api/src/common/tenant.plugin.ts`, `apps/api/src/common/fields.ts`
- Test: `apps/api/src/common/tenant.plugin.test.ts`

**Interfaces:**
- Consumes: `ctx()` and `forbidden()` from Task 3.2.
- Produces:
  - `tenantPlugin(schema, { projectField?: '_id' | 'projectId' })`
  - `orgIdField`, `sen()` (required, default 0), `senOrNull()`
  - `findSub(array, id)`: finds an embedded subdocument by id, or `undefined`

- [x] **Step 1: Write the failing test** `src/common/tenant.plugin.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { Schema, Types, model } from "mongoose";
import { tenantPlugin, orgIdField, sen } from "./tenant.plugin";
import { asOrg, newId } from "../../test/ctx";

const thingSchema = new Schema({ orgId: orgIdField, projectId: { type: Schema.Types.ObjectId, required: true }, name: String, amount: sen() }, { collection: "test_things" });
thingSchema.plugin(tenantPlugin, { projectField: "projectId" });
const Thing = model("TestThing", thingSchema);

describe("tenantPlugin", () => {
  const orgA = newId(), orgB = newId(), p1 = newId(), p2 = newId();

  it("stamps orgId and hides other orgs' records from every read and write", async () => {
    const thing = await asOrg(orgA, async () => (await Thing.create([{ projectId: p1, name: "A", amount: 100 }]))[0]);
    expect(thing.orgId.equals(orgA)).toBe(true);

    await asOrg(orgB, async () => {
      expect(await Thing.findById(thing._id)).toBeNull();
      expect(await Thing.countDocuments()).toBe(0);
      expect(await Thing.aggregate([{ $match: {} }])).toEqual([]);
      expect((await Thing.updateOne({ _id: thing._id }, { name: "hacked" })).modifiedCount).toBe(0);
      expect((await Thing.deleteOne({ _id: thing._id })).deletedCount).toBe(0);
    });
    expect((await asOrg(orgA, () => Thing.findById(thing._id).lean()))!.name).toBe("A");
  });

  it("limits project-scoped users to their assigned projects", async () => {
    await asOrg(orgA, () => Thing.create([{ projectId: p2, name: "Other project" }]));
    const seen = await asOrg(orgA, () => Thing.find().lean(), { role: "project_manager", projectScope: [p1] });
    expect(seen.map((t) => t.name)).toEqual(["A"]);
    await expect(asOrg(orgA, () => Thing.create([{ projectId: p2, name: "x" }]), { role: "site_staff", projectScope: [p1] })).rejects.toThrow("not assigned");
  });

  it("refuses to query without a context", async () => {
    await expect(Thing.find().exec()).rejects.toThrow("No request context");
  });

  it("refuses fractional sen", async () => {
    await expect(asOrg(orgA, () => Thing.create([{ projectId: p1, amount: 10.5 }]))).rejects.toThrow("whole number of sen");
  });

  it("blocks bulk helpers that would skip the filter", async () => {
    await expect(asOrg(orgA, () => Thing.insertMany([{ projectId: p1 }]))).rejects.toThrow("not allowed");
  });
});
```

- [x] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter api test tenant`
Expected: FAIL (module missing).

- [x] **Step 3: Write `src/common/tenant.plugin.ts`**

```ts
import { Schema, Types } from "mongoose";
import { ctx } from "./context";
import { forbidden } from "./errors";

export const orgIdField = { type: Schema.Types.ObjectId, required: true, immutable: true } as const;

const isSen = (v: unknown) => v == null || Number.isSafeInteger(v);
const senValidator = { validator: isSen, message: "{PATH} must be a whole number of sen" };

/** A required money field in sen, default 0. */
export const sen = () => ({ type: Number, required: true, default: 0, validate: senValidator }) as const;
/** An optional money field in sen. */
export const senOrNull = () => ({ type: Number, default: null, validate: senValidator }) as const;

/** Finds an embedded subdocument by id. */
export function findSub<T extends { _id?: unknown }>(items: T[], id: Types.ObjectId | string): T | undefined {
  const target = String(id);
  return items.find((i) => String(i._id) === target);
}

const QUERY_OPS = [
  "countDocuments", "deleteMany", "deleteOne", "distinct", "find", "findOne", "findOneAndDelete",
  "findOneAndReplace", "findOneAndUpdate", "replaceOne", "updateMany", "updateOne",
] as const;

/**
 * Scopes every query on a tenant collection to the request's organization and,
 * for project managers and site staff, to their assigned projects. Throws
 * without a request context so a forgotten context never becomes an
 * unscoped query.
 */
export function tenantPlugin(schema: Schema, opts: { projectField?: "_id" | "projectId" } = {}) {
  const scope = () => {
    const c = ctx();
    const filter: Record<string, unknown> = { orgId: c.orgId };
    if (opts.projectField && c.projectScope !== "all") filter[opts.projectField] = { $in: c.projectScope };
    return filter;
  };

  schema.pre([...QUERY_OPS], function () {
    this.and([scope()]);
  });

  schema.pre("aggregate", function () {
    const pipeline = this.pipeline();
    const first = pipeline[0];
    // $search must stay the first stage; filter right after it.
    if (first && "$search" in first) pipeline.splice(1, 0, { $match: scope() });
    else pipeline.unshift({ $match: scope() });
  });

  schema.pre("validate", function () {
    if (this.isNew && this.get("orgId") == null) this.set("orgId", ctx().orgId);
  });

  schema.pre("save", function () {
    const c = ctx();
    if (!c.orgId.equals(this.get("orgId") as Types.ObjectId)) throw new Error("Cross-tenant write blocked");
    if (opts.projectField && c.projectScope !== "all") {
      const projectId = this.get(opts.projectField) as Types.ObjectId;
      if (!c.projectScope.some((id) => id.equals(projectId))) throw forbidden("This project is not assigned to you");
    }
  });

  const refuse = (name: string) => () => {
    throw new Error(`${name} is not allowed on tenant models; use Model.create([...]) or filtered updates`);
  };
  schema.pre("insertMany", refuse("insertMany"));
  schema.pre("estimatedDocumentCount", refuse("estimatedDocumentCount"));
  schema.pre("bulkWrite" as "insertMany", refuse("bulkWrite"));
}
```

- [x] **Step 4: Write `src/common/fields.ts`** (a single import point for schema files)

```ts
export { orgIdField, sen, senOrNull, findSub, tenantPlugin } from "./tenant.plugin";
```

- [x] **Step 5: Run the tests**

Run: `pnpm --filter api test tenant`
Expected: PASS (5 tests).

- [x] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): tenant plugin with org and project scoping, sen fields"
```

---

### Task 3.4: Transactions, after-commit hooks, counters, audit

**Files:**
- Create: `apps/api/src/common/tx.ts`, `apps/api/src/counters/counters.ts`, `apps/api/src/audit/audit.ts`
- Test: `apps/api/src/common/tx.test.ts`

**Interfaces:**
- Consumes: `ctx()` (Task 3.2), `tenantPlugin` and `orgIdField` (Task 3.3), `mytYear` (shared).
- Produces:
  - `tx<T>(fn: () => Promise<T>): Promise<T>`: joins an outer transaction if there is one; runs the after-commit hooks only after commit
  - `afterCommit(fn: () => unknown): void`: runs now when not inside a transaction
  - `type CodeKind = 'L' | 'PRJ' | 'QT' | 'INV' | 'RFQ' | 'PO' | 'VO'`
  - `nextCode(kind, now?): Promise<string>`
  - `raiseCounter(orgId, kind, year, atLeast)`, used by the migration
  - `audit(action, entityType, entityId, data?, projectId?)`
  - `CounterModel`, `AuditModel`

- [x] **Step 1: Write the failing test** `src/common/tx.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { tx, afterCommit } from "./tx";
import { nextCode } from "../counters/counters";
import { AuditModel, audit } from "../audit/audit";
import { asOrg, newId } from "../../test/ctx";

describe("transactions and counters", () => {
  const org = newId();

  it("numbers codes per organization and per Malaysian year", async () => {
    const jan1Myt = new Date("2026-12-31T16:30:00Z");
    expect(await asOrg(org, () => nextCode("QT", jan1Myt))).toBe("QT-2027-0001");
    expect(await asOrg(org, () => nextCode("QT", jan1Myt))).toBe("QT-2027-0002");
    expect(await asOrg(newId(), () => nextCode("QT", jan1Myt))).toBe("QT-2027-0001");
    expect(await asOrg(org, () => nextCode("PO"))).toBe("PO-0001");
  });

  it("never hands out the same code twice under concurrency", async () => {
    const codes = await asOrg(org, () => Promise.all(Array.from({ length: 10 }, () => nextCode("RFQ"))));
    expect(new Set(codes).size).toBe(10);
  });

  it("runs after-commit hooks only when the transaction commits", async () => {
    const ran: string[] = [];
    await asOrg(org, () => tx(async () => { await audit("test.ok", "thing", newId()); afterCommit(() => ran.push("ok")); }));
    await expect(
      asOrg(org, () => tx(async () => { await audit("test.fail", "thing", newId()); afterCommit(() => ran.push("fail")); throw new Error("rollback"); })),
    ).rejects.toThrow("rollback");
    expect(ran).toEqual(["ok"]);
    const actions = await asOrg(org, () => AuditModel.find().lean());
    expect(actions.map((a) => a.action)).toEqual(["test.ok"]);
  });
});
```

- [x] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter api test tx`
Expected: FAIL (modules missing).

- [x] **Step 3: Write `src/common/tx.ts`**

```ts
import { Logger } from "@nestjs/common";
import mongoose from "mongoose";
import { ctx } from "./context";

const log = new Logger("afterCommit");

async function runHooks(hooks: (() => unknown)[]) {
  for (const hook of hooks) {
    try {
      await hook();
    } catch (e) {
      log.error(e instanceof Error ? e.stack : String(e));
    }
  }
}

/**
 * Runs fn in a MongoDB transaction. Every Mongoose operation inside picks up
 * the session automatically (transactionAsyncLocalStorage). Nested calls join
 * the outer transaction. Hooks registered with afterCommit run once, after the
 * commit, never after a rollback.
 */
export async function tx<T>(fn: () => Promise<T>): Promise<T> {
  const c = ctx();
  if (c.inTx) return fn();
  let result!: T;
  c.inTx = true;
  try {
    await mongoose.connection.transaction(async () => {
      c.afterCommit = []; // reset on each retry of a transient error
      result = await fn();
    });
  } catch (e) {
    c.afterCommit = [];
    throw e;
  } finally {
    c.inTx = false;
  }
  const hooks = c.afterCommit;
  c.afterCommit = [];
  await runHooks(hooks);
  return result;
}

/** Defers side effects (events, search updates, job kicks, file deletes) until the data is committed. */
export function afterCommit(fn: () => unknown) {
  const c = ctx();
  if (c.inTx) c.afterCommit.push(fn);
  else void runHooks([fn]);
}
```

- [x] **Step 4: Write `src/counters/counters.ts`**

```ts
import { Schema, Types, model } from "mongoose";
import { mytYear } from "@veenix/shared";
import { ctx } from "../common/context";

// Not tenant-scoped through the plugin: the org is part of the _id.
const counterSchema = new Schema({ _id: { type: String, required: true }, seq: { type: Number, required: true } }, { collection: "counters", versionKey: false });
export const CounterModel = model("Counter", counterSchema);

const YEARLY = { L: true, PRJ: true, QT: true, INV: true, RFQ: false, PO: false, VO: false } as const;
export type CodeKind = keyof typeof YEARLY;

/** L-2026-0001, PRJ-2026-0001, QT-2026-0001, INV-2026-0001, RFQ-0001, PO-0001, VO-0001: per organization, atomic. */
export async function nextCode(kind: CodeKind, now = new Date()): Promise<string> {
  const year = YEARLY[kind] ? mytYear(now) : 0;
  const doc = await CounterModel.findOneAndUpdate(
    { _id: `${ctx().orgId}:${kind}:${year}` },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, lean: true },
  );
  const n = String(doc!.seq).padStart(4, "0");
  return year ? `${kind}-${year}-${n}` : `${kind}-${n}`;
}

/** Makes the next code follow on from codes that already exist (used by the migration). */
export async function raiseCounter(orgId: Types.ObjectId, kind: CodeKind, year: number, atLeast: number) {
  await CounterModel.updateOne({ _id: `${orgId}:${kind}:${YEARLY[kind] ? year : 0}` }, { $max: { seq: atLeast } }, { upsert: true });
}
```

- [x] **Step 5: Write `src/audit/audit.ts`**

```ts
import { Schema, Types, model } from "mongoose";
import { ctx } from "../common/context";
import { orgIdField, tenantPlugin } from "../common/fields";

const auditSchema = new Schema(
  {
    orgId: orgIdField,
    actorId: { type: Schema.Types.ObjectId, default: null },
    action: { type: String, required: true },
    entityType: { type: String, required: true },
    entityId: { type: Schema.Types.ObjectId, required: true },
    projectId: { type: Schema.Types.ObjectId, default: null },
    data: { type: Schema.Types.Mixed, default: null },
  },
  { collection: "audit_events", timestamps: { createdAt: true, updatedAt: false } },
);
auditSchema.index({ orgId: 1, createdAt: -1 });
auditSchema.index({ orgId: 1, entityId: 1 });
auditSchema.plugin(tenantPlugin);
export const AuditModel = model("AuditEvent", auditSchema);

/** Records who did what. Call it inside the same tx() as the change, so both commit or neither does. */
export async function audit(action: string, entityType: string, entityId: Types.ObjectId, data?: object, projectId?: Types.ObjectId) {
  const c = ctx();
  await AuditModel.create([{ orgId: c.orgId, actorId: c.userId, action, entityType, entityId, projectId: projectId ?? null, data: data ?? null }]);
}
```

These audit actions are mandatory (later tasks call them):

| Area | Actions |
|---|---|
| Quotations | `quotation.sent`, `quotation.accepted` |
| Vendor quotes and payments | `quote.accepted`, `po.terms_changed`, `po_milestone.paid` |
| Variation orders | `vo.accepted` |
| Billing | `invoice.generated`, `invoice.paid`, `schedule.created` |
| Members | `member.invited`, `member.role_changed`, `member.removed` |
| Settings | `org.bank_changed`, `org.pricing_changed`, `org.tax_changed`, `org.einvoice_changed` |

- [x] **Step 6: Run the tests**

Run: `pnpm --filter api test`
Expected: PASS (all API tests so far).

- [x] **Step 7: Commit**

```bash
git add apps/api
git commit -m "feat(api): transactions with after-commit hooks, per-org codes, audit log"
```
