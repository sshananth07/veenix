# 05: Platform services

> For whoever implements this (you or Claude): work task by task and tick each one off in [../README.md](../README.md).

**Goal:** the shared building blocks the domain modules call: S3-compatible file storage with presigned uploads and checked claims, a background-job outbox, email, live updates over SSE, and fuzzy search.

**Architecture:**
- Each building block is a plain TypeScript module of functions, not Nest dependency injection, so services, jobs and scripts can all call it.
- Thin Nest controllers expose the HTTP parts: `POST /v1/uploads`, `GET /v1/internal/jobs/run`, `POST /v1/live/ticket`, `GET /v1/live` and `GET /v1/search`.

**Tech stack:** `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, ioredis, nodemailer, jose, `@vercel/functions` (`waitUntil`), rxjs, MongoDB Atlas Search.

**Spec:** [../spec.md](../spec.md) §11–§14.

## Global constraints
- Storage keys are `orgs/<orgId>/<purpose>/<uuid><ext>`. Presigned PUT links last 300 s, download links 300 s, share links 7 days (604 800 s, the S3 maximum).
- Switching to Cloudflare R2 is a change of environment variables only. No R2-specific code.
- Jobs: at most 8 attempts, backoff `2^attempts` minutes, a 120 s lock.
- Live events carry ids only.
- Search returns at most 20 results.

## Review focus
- **A file renamed to `.pdf` that isn't a PDF:** the claim fails with `"x.pdf" is not a real PDF file` and the object is deleted. Tested in Task 5.1.
- **A key from another organization pasted into a form:** the claim fails. Tested in Task 5.1.
- **A job whose transaction rolled back:** the job must not exist. Tested in Task 5.2.
- **A project manager's live stream:** never receives events for unassigned projects, or lead events. Tested in Task 5.4.
- **A search typo** ("Wawsan" finds "Wawasan Interior"), and **a project manager searching:** never sees leads or unassigned projects. Tested in Task 5.5.

---

### Task 5.1: Storage, bucket init, uploads endpoint

**Files:**
- Create: `apps/api/src/storage/storage.ts`, `apps/api/src/storage/uploads.controller.ts`, `apps/api/scripts/storage-init.ts`
- Modify: `apps/api/package.json` (script `storage:init`), `apps/api/src/app.module.ts`
- Test: `apps/api/src/storage/storage.test.ts`

**Interfaces:**
- Produces:
  - `presignUpload(input: PresignInput): Promise<{ key: string; url: string; contentType: string }>`
  - `claim(ref: { key: string; name: string }, purpose: UploadPurpose): Promise<{ path: string; name: string; size: number; contentType: string }>`
  - `downloadUrl(key, filename, inline?): Promise<string>`, valid 300 s
  - `shareUrl(key, filename): Promise<string>`, valid 7 days
  - `putObject(key, body: Buffer, contentType)`, `getObject(key): Promise<Buffer>`, `removeObject(key)`
  - `newKey(purpose: UploadPurpose | 'documents', ext): string`
  - `ensureBucket()`

- [ ] **Step 1: Install**

```bash
pnpm --filter api add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

- [ ] **Step 2: Write `src/storage/storage.ts`**

```ts
import { randomUUID } from "node:crypto";
import { basename, extname } from "node:path";
import {
  CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, HeadObjectCommand,
  PutBucketCorsCommand, PutObjectCommand, S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { CONTENT_TYPES, MAX_UPLOAD_BYTES, UPLOAD_RULES, type PresignInput, type UploadPurpose } from "@veenix/shared";
import { env } from "../config/env";
import { ctx } from "../common/context";
import { rule } from "../common/errors";

const s3 = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
  credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
});
const Bucket = env.S3_BUCKET;

export function newKey(purpose: UploadPurpose | "documents", ext: string) {
  return `orgs/${ctx().orgId}/${purpose}/${randomUUID()}${ext}`;
}

export async function presignUpload(input: PresignInput) {
  const ext = extname(input.filename).toLowerCase();
  if (!UPLOAD_RULES[input.purpose].exts.includes(ext)) throw rule(UPLOAD_RULES[input.purpose].label);
  const key = newKey(input.purpose, ext);
  const contentType = CONTENT_TYPES[ext];
  // Content type and length are signed: the browser must PUT exactly this file.
  const url = await getSignedUrl(s3, new PutObjectCommand({ Bucket, Key: key, ContentType: contentType, ContentLength: input.size }), { expiresIn: 300 });
  return { key, url, contentType };
}

const startsWith = (b: Buffer, bytes: number[]) => bytes.every((v, i) => b[i] === v);
const zip = (b: Buffer) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]);
const ole = (b: Buffer) => startsWith(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const jpeg = (b: Buffer) => startsWith(b, [0xff, 0xd8, 0xff]);
const MAGIC: Record<string, (b: Buffer) => boolean> = {
  ".pdf": (b) => b.subarray(0, 4).toString("latin1") === "%PDF",
  ".png": (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  ".jpg": jpeg,
  ".jpeg": jpeg,
  ".webp": (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP",
  ".docx": zip,
  ".xlsx": zip,
  ".doc": ole,
  ".xls": ole,
};

async function readStart(key: string): Promise<Buffer> {
  const r = await s3.send(new GetObjectCommand({ Bucket, Key: key, Range: "bytes=0-15" }));
  return Buffer.from(await r.Body!.transformToByteArray());
}

/** Accepts a file the browser uploaded, after checking it really belongs here and really is what its name says. */
export async function claim(ref: { key: string; name: string }, purpose: UploadPurpose) {
  const ext = extname(ref.key).toLowerCase();
  const prefix = `orgs/${ctx().orgId}/${purpose}/`;
  if (!ref.key.startsWith(prefix) || !/^[0-9a-f-]{36}$/.test(basename(ref.key, ext)) || !UPLOAD_RULES[purpose].exts.includes(ext)) {
    throw rule(UPLOAD_RULES[purpose].label);
  }
  const head = await s3.send(new HeadObjectCommand({ Bucket, Key: ref.key })).catch(() => null);
  if (!head) throw rule("The upload didn't finish. Try again.");
  const size = head.ContentLength ?? 0;
  if (size > MAX_UPLOAD_BYTES) {
    await removeObject(ref.key);
    throw rule("File is larger than 10 MB");
  }
  if (!MAGIC[ext](await readStart(ref.key))) {
    await removeObject(ref.key);
    throw rule(`"${ref.name}" is not a real ${ext.slice(1).toUpperCase()} file`);
  }
  return { path: ref.key, name: ref.name.slice(0, 120), size, contentType: CONTENT_TYPES[ext] };
}

const disposition = (filename: string, inline: boolean) =>
  `${inline ? "inline" : "attachment"}; filename="${filename.replace(/[^\w.\- ]+/g, "_")}"`;

export function downloadUrl(key: string, filename: string, inline = true) {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket, Key: key, ResponseContentDisposition: disposition(filename, inline) }), { expiresIn: 300 });
}

/** A 7-day link for sending a document over WhatsApp. */
export function shareUrl(key: string, filename: string) {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket, Key: key, ResponseContentDisposition: disposition(filename, true) }), { expiresIn: 604_800 });
}

export async function putObject(key: string, body: Buffer, contentType: string) {
  await s3.send(new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType }));
}

export async function getObject(key: string): Promise<Buffer> {
  const r = await s3.send(new GetObjectCommand({ Bucket, Key: key }));
  return Buffer.from(await r.Body!.transformToByteArray());
}

export async function removeObject(key: string) {
  await s3.send(new DeleteObjectCommand({ Bucket, Key: key })).catch(() => undefined);
}

/** Local and first-deploy setup: create the bucket and let the web origin PUT and GET directly. */
export async function ensureBucket() {
  const exists = await s3.send(new HeadBucketCommand({ Bucket })).then(() => true, () => false);
  if (!exists) await s3.send(new CreateBucketCommand({ Bucket }));
  await s3
    .send(new PutBucketCorsCommand({
      Bucket,
      CORSConfiguration: { CORSRules: [{ AllowedOrigins: [env.WEB_ORIGIN], AllowedMethods: ["PUT", "GET"], AllowedHeaders: ["*"], MaxAgeSeconds: 3000 }] },
    }))
    .catch((e) => console.warn(`Bucket CORS not set (${e.name}). If browser uploads fail with a CORS error, see plan 05 Task 5.1 Step 5.`));
}
```

- [ ] **Step 3: Write the uploads controller and the init script**

`src/storage/uploads.controller.ts`:
```ts
import { Controller, Post } from "@nestjs/common";
import { can, presignInput, type PresignInput, type Role } from "@veenix/shared";
import { Can, RateLimit } from "../common/decorators";
import { ctx } from "../common/context";
import { forbidden } from "../common/errors";
import { ZBody } from "../common/zod";
import { presignUpload } from "./storage";

@Controller("uploads")
export class UploadsController {
  // Any member may upload. The action that claims the file checks the real permission.
  @Can() @RateLimit(30) @Post()
  presign(@ZBody(presignInput) body: PresignInput) {
    if (body.purpose === "logos" && !can(ctx().role as Role, "org:manage")) throw forbidden();
    return presignUpload(body);
  }
}
```

`scripts/storage-init.ts`:
```ts
import { ensureBucket } from "../src/storage/storage";

ensureBucket().then(() => console.log("bucket ready"), (e) => { console.error(e); process.exit(1); });
```

Add `"storage:init": "tsx scripts/storage-init.ts"` to `apps/api/package.json`, and register `UploadsController` in `AppModule`.

- [ ] **Step 4: Create the bucket**

Run: `pnpm --filter api storage:init`
Expected: `bucket ready`. A CORS warning may also print; handle it in Step 5.

- [ ] **Step 5: If CORS can't be set on SeaweedFS**

Change the storage `command` in `docker-compose.yml` to add `-s3.allowedOrigins=http://localhost:3100`, then run `docker compose up -d storage`. ⚠ Verify the flag name with `docker compose exec storage weed server -h | grep -i origin`. R2 supports `PutBucketCors` normally.

- [ ] **Step 6: Write the test** `src/storage/storage.test.ts`

```ts
import { beforeAll, describe, expect, it } from "vitest";
import { claim, ensureBucket, newKey, putObject } from "./storage";
import { asOrg, newId } from "../../test/ctx";

const org = newId();

describe("storage claim", () => {
  beforeAll(() => ensureBucket());

  it("accepts a real PDF in this org's folder", async () => {
    const key = await asOrg(org, async () => newKey("quotes", ".pdf"));
    await putObject(key, Buffer.from("%PDF-1.7 test"), "application/pdf");
    const r = await asOrg(org, () => claim({ key, name: "quote.pdf" }, "quotes"));
    expect(r).toMatchObject({ path: key, name: "quote.pdf", contentType: "application/pdf" });
  });

  it("rejects a fake PDF and deletes it", async () => {
    const key = await asOrg(org, async () => newKey("quotes", ".pdf"));
    await putObject(key, Buffer.from("MZ not a pdf"), "application/pdf");
    await expect(asOrg(org, () => claim({ key, name: "evil.pdf" }, "quotes"))).rejects.toThrow('"evil.pdf" is not a real PDF file');
    await expect(asOrg(org, () => claim({ key, name: "evil.pdf" }, "quotes"))).rejects.toThrow("The upload didn't finish");
  });

  it("rejects another organization's key", async () => {
    const key = await asOrg(newId(), async () => newKey("quotes", ".pdf"));
    await expect(asOrg(org, () => claim({ key, name: "x.pdf" }, "quotes"))).rejects.toThrow("Upload a PDF");
  });
});
```

- [ ] **Step 7: Run the tests**

Run: `pnpm --filter api test storage`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api pnpm-lock.yaml docker-compose.yml
git commit -m "feat(api): S3-compatible storage with presigned uploads and checked claims"
```

---

### Task 5.2: Background jobs

**Files:**
- Create: `apps/api/src/jobs/job.model.ts`, `apps/api/src/jobs/jobs.ts`, `apps/api/src/jobs/jobs.controller.ts`
- Modify: `apps/api/src/app.factory.ts` (sweep middleware), `apps/api/src/app.module.ts`
- Test: `apps/api/src/jobs/jobs.test.ts`

**Interfaces:**
- Consumes: `tx`, `afterCommit` (Task 3.4); `runWithCtx`, `systemCtx` (Task 3.2).
- Produces:
  - `type JobType = 'mail.send' | 'document.snapshot' | 'einvoice.submit' | 'einvoice.poll'`
  - `registerJob(type, handler: (payload) => Promise<void>)`
  - `enqueue(type, payload, runAt?)`
  - `kick()`, `sweepIfIdle()`
  - `runDue(max?): Promise<number>`
  - `JobModel`
  - the route `GET /v1/internal/jobs/run`

- [ ] **Step 1: Install**

```bash
pnpm --filter api add @vercel/functions
```

- [ ] **Step 2: Write the failing test** `src/jobs/jobs.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { JobModel } from "./job.model";
import { enqueue, registerJob, runDue } from "./jobs";
import { tx } from "../common/tx";
import { ctx } from "../common/context";
import { asOrg, newId } from "../../test/ctx";

const org = newId();
const seen: string[] = [];
registerJob("mail.send", async (p: { to: string }) => {
  if (p.to === "fail@x.my") throw new Error("smtp down");
  seen.push(`${p.to}:${String(ctx().orgId)}`);
});

describe("jobs", () => {
  it("only exists when the transaction commits", async () => {
    await expect(asOrg(org, () => tx(async () => { await enqueue("mail.send", { to: "rolled@x.my" }); throw new Error("no"); }))).rejects.toThrow("no");
    expect(await JobModel.countDocuments({ "payload.to": "rolled@x.my" })).toBe(0);
  });

  it("runs handlers in the job's organization and backs off failures", async () => {
    await asOrg(org, () => tx(async () => { await enqueue("mail.send", { to: "ok@x.my" }); await enqueue("mail.send", { to: "fail@x.my" }); }));
    await runDue();
    expect(seen).toContain(`ok@x.my:${org}`);
    const failed = await JobModel.findOne({ "payload.to": "fail@x.my" }).lean();
    expect(failed).toMatchObject({ status: "pending", attempts: 1, lastError: "smtp down" });
    expect(failed!.runAt.getTime()).toBeGreaterThan(Date.now());
  });
});
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `pnpm --filter api test jobs`
Expected: FAIL (modules missing).

- [ ] **Step 4: Write `src/jobs/job.model.ts` and `src/jobs/jobs.ts`**

```ts
// job.model.ts
import { Schema, model } from "mongoose";

// Not under the tenant plugin: the runner claims jobs for every organization.
const jobSchema = new Schema(
  {
    orgId: { type: Schema.Types.ObjectId, required: true },
    type: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, default: {} },
    status: { type: String, enum: ["pending", "running", "done", "failed"], default: "pending" },
    attempts: { type: Number, default: 0 },
    runAt: { type: Date, default: () => new Date() },
    lockedUntil: { type: Date, default: null },
    lastError: { type: String, default: null },
    doneAt: { type: Date, default: null },
  },
  { collection: "jobs", timestamps: true },
);
jobSchema.index({ status: 1, runAt: 1 });
jobSchema.index({ doneAt: 1 }, { expireAfterSeconds: 30 * 86_400 });
export const JobModel = model("Job", jobSchema);
```

```ts
// jobs.ts
import { Logger } from "@nestjs/common";
import { waitUntil } from "@vercel/functions";
import { ctx, runWithCtx, systemCtx } from "../common/context";
import { afterCommit } from "../common/tx";
import { JobModel } from "./job.model";

export type JobType = "mail.send" | "document.snapshot" | "einvoice.submit" | "einvoice.poll";

const MAX_ATTEMPTS = 8;
const LOCK_MS = 120_000;
const log = new Logger("Jobs");
const handlers = new Map<JobType, (payload: never) => Promise<void>>();

export function registerJob<P>(type: JobType, handler: (payload: P) => Promise<void>) {
  handlers.set(type, handler as (payload: never) => Promise<void>);
}

/** Adds a job inside the caller's transaction. It only exists if that transaction commits. */
export async function enqueue(type: JobType, payload: object, runAt = new Date()) {
  await JobModel.create([{ orgId: ctx().orgId, type, payload, runAt }]);
  afterCommit(kick);
}

/** Runs due jobs without holding up the response. */
export function kick() {
  const work = runDue().catch((e) => log.error(e instanceof Error ? e.stack : String(e)));
  try {
    waitUntil(work);
  } catch {
    // not running on Vercel; the promise still runs
  }
}

let lastSweep = 0;
// ponytail: on the Hobby plan, cron only runs daily, so traffic drives retries. A failed job waits for the next request after its backoff. Use a per-minute Vercel Cron on Pro.
export function sweepIfIdle() {
  if (Date.now() - lastSweep < 60_000) return;
  lastSweep = Date.now();
  kick();
}

async function claimNext() {
  const now = new Date();
  return JobModel.findOneAndUpdate(
    { $or: [{ status: "pending", runAt: { $lte: now } }, { status: "running", lockedUntil: { $lt: now } }] },
    { $set: { status: "running", lockedUntil: new Date(now.getTime() + LOCK_MS) }, $inc: { attempts: 1 } },
    { sort: { runAt: 1 }, new: true, lean: true },
  );
}

export async function runDue(max = 20): Promise<number> {
  let ran = 0;
  for (; ran < max; ran++) {
    const job = await claimNext();
    if (!job) break;
    try {
      const handler = handlers.get(job.type as JobType);
      if (!handler) throw new Error(`No handler for ${job.type}`);
      await runWithCtx(systemCtx(job.orgId), () => handler(job.payload as never));
      await JobModel.updateOne({ _id: job._id }, { $set: { status: "done", doneAt: new Date(), lastError: null } });
    } catch (e) {
      const message = (e instanceof Error ? e.message : String(e)).slice(0, 2000);
      await JobModel.updateOne(
        { _id: job._id },
        { $set: { status: job.attempts >= MAX_ATTEMPTS ? "failed" : "pending", runAt: new Date(Date.now() + 2 ** job.attempts * 60_000), lastError: message } },
      );
      log.warn(`${job.type} ${job._id} attempt ${job.attempts} failed: ${message}`);
    }
  }
  return ran;
}
```

- [ ] **Step 5: Write the cron endpoint and the sweep middleware**

`src/jobs/jobs.controller.ts`:
```ts
import { timingSafeEqual } from "node:crypto";
import { Controller, Get, Headers } from "@nestjs/common";
import { Public } from "../common/decorators";
import { unauthenticated } from "../common/errors";
import { env } from "../config/env";
import { runDue } from "./jobs";

@Controller("internal/jobs")
export class JobsController {
  // Vercel Cron sends "Authorization: Bearer <CRON_SECRET>".
  @Public() @Get("run")
  async run(@Headers("authorization") header = "") {
    const expected = Buffer.from(`Bearer ${env.CRON_SECRET}`);
    const given = Buffer.from(header);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw unauthenticated();
    return { ran: await runDue(100) };
  }
}
```

In `src/app.factory.ts`, after `app.use(helmet())`:
```ts
app.use((_req: unknown, _res: unknown, next: () => void) => {
  sweepIfIdle();
  next();
});
```
(import `sweepIfIdle` from `./jobs/jobs`). Register `JobsController` in `AppModule`.

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter api test jobs`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api pnpm-lock.yaml
git commit -m "feat(api): transactional job outbox with runner, backoff and cron endpoint"
```

---

### Task 5.3: Mail

**Files:**
- Create: `apps/api/src/mail/mail.ts`
- Modify: `apps/api/src/orgs/orgs.service.ts` (send the invitation email), `apps/api/src/app.module.ts` (import `./mail/mail` once so its job handler registers)

**Interfaces:**
- Consumes: `registerJob`, `enqueue` (Task 5.2); `getObject` (Task 5.1).
- Produces:
  - `interface MailJob { to: string; subject: string; text: string; attachments?: { filename: string; key: string; contentType: string }[]; documentId?: string }`
  - `queueMail(job: MailJob)`
  - `sendMailNow(job)`

- [ ] **Step 1: Install**

```bash
pnpm --filter api add nodemailer && pnpm --filter api add -D @types/nodemailer
```

- [ ] **Step 2: Write `src/mail/mail.ts`**

```ts
import nodemailer from "nodemailer";
import { env } from "../config/env";
import { enqueue, registerJob } from "../jobs/jobs";
import { getObject } from "../storage/storage";

export interface MailJob {
  to: string;
  subject: string;
  text: string;
  attachments?: { filename: string; key: string; contentType: string }[];
  /** Set when the mail delivers a document, so plan 07 can record the outcome. */
  documentId?: string;
}

const transport = nodemailer.createTransport(env.SMTP_URL);

export async function sendMailNow(job: MailJob) {
  const attachments = await Promise.all((job.attachments ?? []).map(async (a) => ({ filename: a.filename, content: await getObject(a.key), contentType: a.contentType })));
  await transport.sendMail({ from: env.MAIL_FROM, to: job.to, subject: job.subject, text: job.text, attachments });
}

/** Queues an email in the caller's transaction. */
export const queueMail = (job: MailJob) => enqueue("mail.send", job);

registerJob<MailJob>("mail.send", sendMailNow);
```

- [ ] **Step 3: Send invitations by email**

In `OrgsService.invite`, delete the `onInvite` property and its call. Then:
- Wrap the method body in `tx(async () => { … })`.
- Before the audit call, add:

```ts
const org = await OrgModel.findById(c.orgId).lean();
await queueMail({
  to: input.email,
  subject: `You're invited to ${org!.companyName} on Veenix`,
  text: `You've been invited to join ${org!.companyName} on Veenix.\n\nAccept the invitation: ${link}\n\nThe link works once and expires in ${INVITE_DAYS} days.`,
});
```

Add `import "./mail/mail";` at the top of `app.module.ts`, so the handler registers when the app boots.

- [ ] **Step 4: Check it by hand**

With the API and web running, an owner creates an invitation:

```bash
curl -s -X POST http://localhost:4000/v1/org/invitations -H "authorization: Bearer <a token>" -H "x-org-id: <orgId>" -H "content-type: application/json" -d '{"email":"pm@x.my","role":"project_manager"}'
```

Easier: wait for the members screen in plan 08, Task 8.5. Expected: the email appears in Mailpit (http://localhost:8025) within a second or two.

- [ ] **Step 5: Run the tests and commit**

Run: `pnpm --filter api test`
Expected: PASS (the orgs test still passes because the mail job only queues).

```bash
git add apps/api pnpm-lock.yaml
git commit -m "feat(api): email through the job queue; invitation emails"
```

---

### Task 5.4: Live updates

**Files:**
- Create: `apps/api/src/live/live.ts`, `apps/api/src/live/live.controller.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/src/live/live.test.ts`

**Interfaces:**
- Consumes: `redis` (Task 4.5), `afterCommit` (Task 3.4), `ctx()`.
- Produces:
  - `type LiveEvent = { kind: 'project' | 'lead' | 'vendor' | 'org'; id?: string; projectId?: string }`
  - `changed(e: LiveEvent)`: publishes after commit
  - `visible(e, scope: 'all' | string[]): boolean`
  - `issueTicket(): Promise<string>`, `readTicket(t)`
  - `liveStream(orgId, scope): Observable<MessageEvent>`
  - routes `POST /v1/live/ticket` (`@Can()`) and `GET /v1/live?ticket=` (public)

- [ ] **Step 1: Write the failing test** `src/live/live.test.ts`

```ts
import { describe, expect, it } from "vitest";
import Redis from "ioredis";
import { changed, issueTicket, readTicket, visible } from "./live";
import { tx } from "../common/tx";
import { env } from "../config/env";
import { asOrg, newId } from "../../test/ctx";

describe("live", () => {
  it("filters events by project scope", () => {
    expect(visible({ kind: "project", projectId: "p1" }, ["p1"])).toBe(true);
    expect(visible({ kind: "project", projectId: "p2" }, ["p1"])).toBe(false);
    expect(visible({ kind: "lead", id: "l1" }, ["p1"])).toBe(false);
    expect(visible({ kind: "lead", id: "l1" }, "all")).toBe(true);
  });

  it("publishes only after commit", async () => {
    const org = newId();
    const sub = new Redis(env.REDIS_URL);
    const got: string[] = [];
    await sub.subscribe(`live:${org}`);
    sub.on("message", (_c, m) => got.push(m));
    await asOrg(org, () => tx(async () => { changed({ kind: "project", projectId: "p1" }); expect(got).toEqual([]); }));
    await new Promise((r) => setTimeout(r, 200));
    expect(got.map((m) => JSON.parse(m))).toEqual([{ kind: "project", projectId: "p1" }]);
    sub.disconnect();
  });

  it("round-trips a ticket carrying the scope", async () => {
    const org = newId(), p = newId();
    const t = await asOrg(org, () => issueTicket(), { projectScope: [p] });
    expect(await readTicket(t)).toEqual({ orgId: String(org), scope: [String(p)] });
    await expect(readTicket("junk")).rejects.toThrow("expired");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter api test live`
Expected: FAIL (module missing).

- [ ] **Step 3: Write `src/live/live.ts`**

```ts
import { EventEmitter } from "node:events";
import type { MessageEvent } from "@nestjs/common";
import Redis from "ioredis";
import { SignJWT, jwtVerify } from "jose";
import { Observable } from "rxjs";
import { env } from "../config/env";
import { ctx } from "../common/context";
import { unauthenticated } from "../common/errors";
import { redis } from "../common/redis";
import { afterCommit } from "../common/tx";

export type LiveEvent = { kind: "project" | "lead" | "vendor" | "org"; id?: string; projectId?: string };
type Scope = "all" | string[];

/** Tells open screens something changed. Ids only; screens refetch through the normal, permission-checked API. */
export function changed(e: LiveEvent) {
  const orgId = String(ctx().orgId);
  afterCommit(() => redis.publish(`live:${orgId}`, JSON.stringify(e)));
}

export function visible(e: LiveEvent, scope: Scope) {
  if (scope === "all") return true;
  return !!e.projectId && scope.includes(e.projectId);
}

const secret = new TextEncoder().encode(env.LIVE_TICKET_SECRET);

export function issueTicket() {
  const c = ctx();
  return new SignJWT({ org: String(c.orgId), scope: c.projectScope === "all" ? "all" : c.projectScope.map(String) })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(c.userId))
    .setExpirationTime("60s")
    .sign(secret);
}

export async function readTicket(ticket: string): Promise<{ orgId: string; scope: Scope }> {
  try {
    const { payload } = await jwtVerify(ticket, secret, { algorithms: ["HS256"] });
    return { orgId: String(payload.org), scope: payload.scope as Scope };
  } catch {
    throw unauthenticated("UNAUTHENTICATED", "The live updates link expired");
  }
}

// One Redis subscriber per instance, fanned out in memory to each open stream.
const emitter = new EventEmitter().setMaxListeners(0);
const refs = new Map<string, number>();
let sub: Redis | undefined;

function subscriber() {
  if (!sub) {
    sub = new Redis(env.REDIS_URL);
    sub.on("message", (channel, message) => emitter.emit(channel, message));
  }
  return sub;
}

export function liveStream(orgId: string, scope: Scope): Observable<MessageEvent> {
  return new Observable<MessageEvent>((out) => {
    const channel = `live:${orgId}`;
    if ((refs.get(channel) ?? 0) === 0) void subscriber().subscribe(channel);
    refs.set(channel, (refs.get(channel) ?? 0) + 1);

    const onMessage = (raw: string) => {
      const e = JSON.parse(raw) as LiveEvent;
      if (visible(e, scope)) out.next({ data: e });
    };
    emitter.on(channel, onMessage);
    const ping = setInterval(() => out.next({ type: "ping", data: "" }), 25_000);

    return () => {
      clearInterval(ping);
      emitter.off(channel, onMessage);
      const left = (refs.get(channel) ?? 1) - 1;
      refs.set(channel, left);
      if (left === 0) void subscriber().unsubscribe(channel);
    };
  });
}
```

- [ ] **Step 4: Write `src/live/live.controller.ts`**

```ts
import { Controller, Post, Query, Sse, type MessageEvent } from "@nestjs/common";
import { from, switchMap, type Observable } from "rxjs";
import { Can, Public } from "../common/decorators";
import { issueTicket, liveStream, readTicket } from "./live";

@Controller("live")
export class LiveController {
  @Can() @Post("ticket")
  async ticket() {
    return { ticket: await issueTicket() };
  }

  // EventSource can't send headers, so the stream authenticates with the short-lived ticket.
  // The stream ends when the function hits its time limit; the browser reconnects with a new ticket.
  @Public() @Sse()
  stream(@Query("ticket") ticket = ""): Observable<MessageEvent> {
    return from(readTicket(ticket)).pipe(switchMap((t) => liveStream(t.orgId, t.scope)));
  }
}
```

Register `LiveController`.

Known limit: someone removed from the organization keeps an already-open stream (ids only) until it next reconnects, at most the function's 300 s limit. Their reconnect then fails, because the ticket request goes through `AccessGuard`.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter api test live`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): live updates over SSE with Redis fan-out and scoped tickets"
```

---

### Task 5.5: Search

**Files:**
- Create: `apps/api/src/search/search-entry.model.ts`, `apps/api/src/search/search.ts`, `apps/api/src/search/search.controller.ts`, `apps/api/src/models.ts`, `apps/api/scripts/db-indexes.ts`
- Modify: `apps/api/package.json` (script `db:indexes`), `apps/api/src/app.module.ts`
- Test: `apps/api/src/search/search.test.ts`

**Interfaces:**
- Produces:
  - `type SearchKind = 'lead' | 'project' | 'vendor' | 'quotation' | 'po' | 'invoice'`
  - `indexEntry(e: { kind; refId; projectId; title; subtitle; keywords })`: upserts after commit
  - `removeEntry(kind, refId)`
  - `search(q): Promise<SearchResultDto[]>`
  - `SEARCH_INDEX_DEFINITION`
  - `src/models.ts`: imports every model file. **Every later plan adds its model imports here.**

- [ ] **Step 1: Write the model and `src/models.ts`**

```ts
// search-entry.model.ts
import { Schema, model } from "mongoose";
import { orgIdField, tenantPlugin } from "../common/fields";

const searchEntrySchema = new Schema(
  {
    orgId: orgIdField,
    kind: { type: String, required: true },
    refId: { type: Schema.Types.ObjectId, required: true },
    projectId: { type: Schema.Types.ObjectId, default: null },
    title: { type: String, required: true },
    subtitle: { type: String, default: "" },
    keywords: { type: String, default: "" },
  },
  { collection: "search_entries", timestamps: true },
);
searchEntrySchema.index({ orgId: 1, kind: 1, refId: 1 }, { unique: true });
// Org scoping only: the search query applies the project scope itself, so vendors stay findable.
searchEntrySchema.plugin(tenantPlugin);
export const SearchEntryModel = model("SearchEntry", searchEntrySchema);
```

```ts
// src/models.ts — import every model so scripts (indexes, migration) register them all.
import "./audit/audit";
import "./counters/counters";
import "./users/user.model";
import "./orgs/org.model";
import "./orgs/membership.model";
import "./orgs/invitation.model";
import "./jobs/job.model";
import "./search/search-entry.model";
// plan 06 adds: leads, vendors, projects, rfqs, purchase orders, quotations, variation orders, invoices, files
// plan 07 adds: documents
```

- [ ] **Step 2: Write `src/search/search.ts`**

```ts
import { Types } from "mongoose";
import { can, type Role, type SearchResultDto } from "@veenix/shared";
import { ctx } from "../common/context";
import { afterCommit } from "../common/tx";
import { SearchEntryModel } from "./search-entry.model";

export type SearchKind = SearchResultDto["kind"];

export const SEARCH_INDEX_DEFINITION = {
  mappings: {
    dynamic: false,
    fields: {
      orgId: { type: "objectId" },
      projectId: { type: "objectId" },
      kind: { type: "token" },
      title: [{ type: "string" }, { type: "autocomplete", tokenization: "edgeGram", minGrams: 2, maxGrams: 15, foldDiacritics: true }],
      subtitle: { type: "string" },
      keywords: { type: "string" },
    },
  },
};

type Entry = { kind: SearchKind; refId: Types.ObjectId; projectId: Types.ObjectId | null; title: string; subtitle: string; keywords?: string };

/** Keeps the search entry for a record up to date. Runs after commit; search is derived data. */
export function indexEntry(e: Entry) {
  afterCommit(async () => {
    const fields = { projectId: e.projectId, title: e.title, subtitle: e.subtitle, keywords: e.keywords ?? "" };
    const updated = await SearchEntryModel.updateOne({ kind: e.kind, refId: e.refId }, { $set: fields });
    if (updated.matchedCount === 0) {
      await SearchEntryModel.create([{ kind: e.kind, refId: e.refId, ...fields }]).catch((err) => {
        if (err?.code !== 11000) throw err; // another request created it first
      });
    }
  });
}

export function removeEntry(kind: SearchKind, refId: Types.ObjectId) {
  afterCommit(() => SearchEntryModel.deleteOne({ kind, refId }));
}

export async function search(q: string): Promise<SearchResultDto[]> {
  const c = ctx();
  const role = c.role as Role;
  const fuzzy = { maxEdits: q.length >= 6 ? 2 : 1, prefixLength: 1 };
  const filter: object[] = [{ equals: { path: "orgId", value: c.orgId } }];
  if (c.projectScope !== "all") {
    filter.push({ compound: { should: [{ in: { path: "projectId", value: c.projectScope } }, { equals: { path: "kind", value: "vendor" } }], minimumShouldMatch: 1 } });
  }
  const mustNot: object[] = [];
  if (!can(role, "lead:read")) mustNot.push({ equals: { path: "kind", value: "lead" } });
  if (!can(role, "vendor:read")) mustNot.push({ equals: { path: "kind", value: "vendor" } });

  const rows = await SearchEntryModel.aggregate<{ kind: SearchKind; refId: Types.ObjectId; projectId: Types.ObjectId | null; title: string; subtitle: string }>([
    {
      $search: {
        index: "search_entries",
        compound: {
          should: [{ autocomplete: { query: q, path: "title", fuzzy } }, { text: { query: q, path: ["title", "subtitle", "keywords"], fuzzy } }],
          minimumShouldMatch: 1,
          filter,
          ...(mustNot.length ? { mustNot } : {}),
        },
      },
    },
    { $limit: 20 },
    { $project: { kind: 1, refId: 1, projectId: 1, title: 1, subtitle: 1 } },
  ]);
  return rows.map((r) => ({ kind: r.kind, refId: String(r.refId), projectId: r.projectId ? String(r.projectId) : null, title: r.title, subtitle: r.subtitle }));
}
```

- [ ] **Step 3: Write `src/search/search.controller.ts`**

```ts
import { Controller, Get } from "@nestjs/common";
import { searchQuery } from "@veenix/shared";
import { Can } from "../common/decorators";
import { ZQuery } from "../common/zod";
import { search } from "./search";

@Controller("search")
export class SearchController {
  @Can() @Get()
  find(@ZQuery(searchQuery) query: { q: string }) {
    return search(query.q);
  }
}
```

Register `SearchController`.

- [ ] **Step 4: Write `scripts/db-indexes.ts`** (production has `autoIndex` off, so indexes are built by this script)

```ts
import mongoose from "mongoose";
import "../src/models";
import { connectDb } from "../src/common/db";
import { SEARCH_INDEX_DEFINITION } from "../src/search/search";

async function main() {
  await connectDb();
  for (const name of mongoose.modelNames()) {
    await mongoose.model(name).syncIndexes();
    console.log(`indexes ok: ${name}`);
  }
  const coll = mongoose.connection.collection("search_entries");
  const existing = await coll.listSearchIndexes("search_entries").toArray();
  if (existing.length === 0) await coll.createSearchIndex({ name: "search_entries", definition: SEARCH_INDEX_DEFINITION });
  else await coll.updateSearchIndex("search_entries", SEARCH_INDEX_DEFINITION);
  console.log("search index ok");
  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
```

Add `"db:indexes": "tsx scripts/db-indexes.ts"` to `apps/api/package.json`.

Run: `pnpm --filter api db:indexes`
Expected: one `indexes ok: …` line per model, then `search index ok`.

- [ ] **Step 5: Write the test** `src/search/search.test.ts`

The search index builds asynchronously, so the test creates it and waits until it answers.

```ts
import { beforeAll, describe, expect, it } from "vitest";
import mongoose from "mongoose";
import { SearchEntryModel } from "./search-entry.model";
import { SEARCH_INDEX_DEFINITION, indexEntry, search } from "./search";
import { asOrg, newId } from "../../test/ctx";

const org = newId(), p1 = newId(), p2 = newId();

async function waitFor(fn: () => Promise<boolean>, ms = 60_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn().catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("search index never became ready");
}

beforeAll(async () => {
  await SearchEntryModel.createCollection();
  await mongoose.connection.collection("search_entries").createSearchIndex({ name: "search_entries", definition: SEARCH_INDEX_DEFINITION });
  await asOrg(org, async () => {
    indexEntry({ kind: "project", refId: p1, projectId: p1, title: "Wawasan Interior Condo Reno", subtitle: "PRJ-2026-0001" });
    indexEntry({ kind: "project", refId: p2, projectId: p2, title: "Taman Bahagia Kitchen", subtitle: "PRJ-2026-0002" });
    indexEntry({ kind: "lead", refId: newId(), projectId: null, title: "Wawasan lead", subtitle: "L-2026-0001" });
  });
  await waitFor(async () => (await asOrg(org, () => search("Wawasan"))).length >= 2);
}, 90_000);

describe("search", () => {
  it("tolerates typos", async () => {
    const r = await asOrg(org, () => search("Wawsan"));
    expect(r.map((x) => x.title)).toContain("Wawasan Interior Condo Reno");
  });
  it("hides leads and unassigned projects from a project manager", async () => {
    const r = await asOrg(org, () => search("Wawasan"), { role: "project_manager", projectScope: [p2] });
    expect(r).toEqual([]);
  });
  it("never crosses organizations", async () => {
    expect(await asOrg(newId(), () => search("Wawasan"))).toEqual([]);
  });
});
```

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter api test search`
Expected: PASS. The first run can take around 30 s while the index builds.

- [ ] **Step 7: Commit**

```bash
git add apps/api
git commit -m "feat(api): fuzzy search over one entries collection with scope filters"
```
