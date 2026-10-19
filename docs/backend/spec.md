# Veenix backend: design spec

Status: approved in the planning session of 2026-10-19. The implementation plan lives in [plan/](plan/), and progress is tracked in [README.md](README.md).

This document records **what** is being built and **why**. Each plan file covers **how** to build one part.

---

## 1. Goals

1. Replace the Next.js app's direct Prisma/SQLite access with a NestJS API on MongoDB.
2. Let many organizations use the platform, each fully isolated from the others (multi-tenancy).
3. Add accounts, mandatory MFA and role-based access, including project-level visibility for project managers and site staff.
4. Keep money exact: integer sen, computed only on the server.
5. Keep responses fast (one document read per screen where possible) and push live updates to open screens.
6. Change the existing UI as little as possible. The API returns the same shapes the components read today.

Not part of this phase:
- a client signing portal (client actions are still recorded by staff with buttons)
- a superadmin portal (the data model is ready for it, see §6.6)
- the WhatsApp Business API (WhatsApp sharing uses share links)
- billing organizations for subscriptions

## 2. Decisions

| Area | Decision |
|---|---|
| API | NestJS 11, REST + JSON, on the **Express** adapter |
| Validation | Zod 4 schemas in `@veenix/shared`, used by the API (request validation) and the web app (types, form previews) |
| Database | MongoDB 8 through Mongoose 8 (raw `Schema` + `InferSchemaType`, no decorator classes) |
| Auth | Better Auth, self-hosted inside the Next.js app; the API only checks its JWTs against the published JWKS. It can be swapped for Clerk later (§6.5) |
| MFA | Mandatory for every user (TOTP authenticator app plus backup codes) |
| Sessions | 12 h idle (sliding), 7 days absolute |
| Access | Organization roles with a fixed permission matrix (§7). `project_manager` and `site_staff` see only their assigned projects |
| Money | Integer **sen** everywhere (§8) |
| Real-time | Server-Sent Events, fanned out through Redis pub/sub (§11) |
| Files | Any S3-compatible store: SeaweedFS locally, Cloudflare R2 in production. Switching is a change of environment variables only (§12) |
| Background work | A `jobs` collection (outbox) processed after each commit, plus a cron backstop (§13) |
| Search | MongoDB Atlas Search with fuzzy matching over one `search_entries` collection (§14) |
| Email | SMTP through nodemailer: Mailpit locally, a Vercel Marketplace provider later |
| WhatsApp | A `wa.me` share link carrying a short-lived document link |
| Repo | A pnpm workspace in one private, local-only git repo |
| Hosting (later) | Vercel: two projects (web, api), region `sin1`. Atlas Singapore. Upstash Redis |
| Local dev | Docker Compose: `mongodb-atlas-local`, Valkey, SeaweedFS, Mailpit |
| Market | Malaysia only: MYR, SST, MY addresses, LHDN MyInvois |

**Changed from earlier in the planning conversation:**

- **Express instead of Fastify.** Express is the default that Vercel's NestJS integration is built around. On serverless, the speed difference is well under a millisecond per request. Database round trips dominate, and §10 addresses those.
- **SSE instead of a Socket.IO gateway.** Updates only flow from server to browser, and SSE is plain HTTP streaming, which Vercel Functions support on every plan. Each stream reconnects on its own when a function reaches its time limit.
- **No OpenAPI generator.** Web and API share the Zod schemas and DTO types directly through the workspace package, so a generated client would add nothing.
- **Bank details are stored as plain text.** They are printed on every invoice sent to clients, so encrypting them wouldn't protect anything. Only the LHDN MyInvois credentials and certificate are encrypted (AES-256-GCM).

## 3. Repository layout

```
veenix/
├─ apps/
│  ├─ web/                 the existing Next.js 14 app, moved here
│  └─ api/                 NestJS
├─ packages/
│  └─ shared/              @veenix/shared: enums, money, Zod schemas, DTO types, pure domain functions
├─ docs/backend/           this spec, the plan and the progress tracker
├─ docker-compose.yml
├─ pnpm-workspace.yaml
├─ package.json
└─ tsconfig.base.json
```

Global toolchain: Node 24 LTS, pnpm 10, TypeScript ≥ 5.8 (`module: nodenext`, CommonJS output, `require()` of ESM-only packages allowed).

## 4. Request flow

```
Browser ──(cookies)──► Next.js (apps/web)
                         │  server components and server actions
                         │  Better Auth: login, sessions, MFA, JWKS
                         │
                         └─(Authorization: Bearer <JWT>, x-org-id)──► NestJS (apps/api) ──► MongoDB
                                                                          │            └─► Redis
Browser ──(EventSource + short-lived ticket)──────────────────────────────┘  SSE live updates
Browser ──(presigned PUT)──► S3-compatible storage
```

- The browser never calls the API with cookies. Next.js gets a 10-minute JWT from Better Auth on the server and forwards it with each request.
- Server actions keep their current signatures and `ActionResult` return value. Their bodies become: read the form → build JSON → call the API → `revalidatePath`.
- Uploads go from the browser straight to storage through a presigned URL. Vercel caps request bodies at 4.5 MB, and today's limit is 10 MB.

## 5. Data model (MongoDB)

General rules:
- Every tenant document has `orgId` (ObjectId, immutable), and every compound index starts with `orgId`.
- Field names copy the current Prisma model, so DTOs and components keep their names. Every money field holds integer sen (§8).
- Every `*Path` field (`photoPath`, `attachmentPath`, `invoicePath`, `path`, `logoPath`) holds a **storage key**, not a disk path.
- Timestamps come from Mongoose (`createdAt`, `updatedAt`).
- `optimisticConcurrency: true` on `projects`, `quotations`, `purchase_orders` and `rfqs`, so two concurrent saves can't silently overwrite each other.
- Explicit collection names (`collection:` option), all snake_case.

### 5.1 Platform collections (not tenant-scoped)

| Collection | Fields | Indexes |
|---|---|---|
| `app_users` | `authSubject` (the auth provider's user id), `email`, `name`, `platformRole: 'superadmin' \| null` | unique `authSubject`; `email` |
| `organizations` | `name`, `companyReg`, `companyAddress`, `companyPhone`, `logoPath`, `bankName`, `bankAccountName`, `bankAccount`, `swiftCode`, `defaultMarkupPct` (40), `minMarkupPct` (20), `sstBps` (800), `einvoice` (§16), `status: 'active' \| 'suspended'`, `createdBy` | — |
| `memberships` | `orgId`, `userId`, `role`, `status: 'active' \| 'removed'`, `invitedBy` | unique `{orgId, userId}`; `{userId, status}` |
| `invitations` | `orgId`, `email` (lower-case), `role`, `tokenHash`, `expiresAt`, `invitedBy`, `acceptedAt` | unique `tokenHash`; `{orgId, email}` |
| `counters` | `_id: "<orgId>:<key>:<year>"`, `seq` | — |
| `jobs` | `orgId`, `type`, `payload`, `status`, `attempts`, `runAt`, `lockedUntil`, `lastError`, `doneAt` | `{status, runAt}`; TTL 30 d on `doneAt` |

Better Auth owns its own collections (`user`, `session`, `account`, `verification`, `twoFactor`, `jwks`). The API never reads them; only the migration script does, to find the owner (plan 09).

### 5.2 Tenant collections

| Collection | Embeds | Key fields beyond the Prisma model | Indexes (all prefixed `orgId`) |
|---|---|---|---|
| `leads` | `activities[] {note, author, authorId, createdAt}` | `assignedTo` stays text | unique `code`; `status`; `createdAt` |
| `vendors` | — | — | unique `name` (collation `en`, strength 2 = case-insensitive) |
| `projects` | `workItems[]`, `bomItems[] {…, materials[], awarded}`, `milestones[]` (client payment milestones), `assignees[] {userId, role}` | `bomItems[].awarded: {poId, amount} \| null`; `milestones[].invoiceId` | unique `code`; `stage`; `assignees.userId`; unique `leadId` (partial) |
| `rfqs` | `quotes[] {…, revisions[]}` | — | unique `code`; unique `bomItemId`; `projectId`; `quotes.vendorId` |
| `purchase_orders` | `milestones[]` (vendor payment milestones) | — | unique `code`; unique `rfqId` (partial); `projectId`; `vendorId` |
| `quotations` | `lineItems[]`, `terms[]`, `events[] {type, note, actorId, createdAt}` | `snapshot: {key, sha256} \| null` | unique `code`; unique `{projectId, revision}`; partial unique `projectId` where `status = DRAFT`; partial unique `projectId` where `status = ACCEPTED` |
| `variation_orders` | — | — | unique `code`; `projectId` |
| `invoices` | — | `projectId`; `einvoice {status, submissionUid, uuid, longId, validatedAt, errors}`; `snapshot` | unique `code`; unique `milestoneId`; `projectId` |
| `files` | — | `uploadedBy` | `{projectId, createdAt}` |
| `documents` | `sends[] {channel, to, status, error, at}` | `type`, `refId`, `projectId`, `key`, `sha256` | `{type, refId}` |
| `search_entries` | — | `kind`, `refId`, `projectId`, `title`, `subtitle`, `keywords` | unique `{kind, refId}` + Atlas Search index `search_entries` |
| `audit_events` | — | `actorId`, `action`, `entity {type, id}`, `projectId`, `data` | `{createdAt}`; `{entity.id}` |

Why each thing is embedded or kept separate:
- **Embedded in the project:** the BOM (work items, lines, materials) and the client milestones. They are always edited and read together, so readiness, costing and the payment schedule are computed from one document, and multi-part edits are atomic.
- **Copy of the awarded PO amount:** `bomItems[].awarded` is written in the same transaction that creates the PO. Costing needs no join.
- **Separate collections:** quotations (versioned, frozen snapshots), RFQs and POs (queried by vendor across projects), invoices (finance queries, unique codes).
- **One draft and one signed quotation per project:** guaranteed by the partial unique indexes, not only by app code.

### 5.3 Deletion and cascade rules (replacing Prisma's `onDelete`)

| When this is deleted | Also do |
|---|---|
| a BOM line | delete its RFQ (and quotes); set `lineItems.$.bomItemId = null` on quotations; set `bomItemId = null` on variation orders; refresh the draft quotation |
| a work item | the above for each of its BOM lines |
| a draft quotation | nothing (it's a single document) |
| a project file | delete the storage object after commit |

These are blocked, with the same messages as today: deleting a BOM line that has a PO or sits in the signed quotation.

Financial records (quotations except drafts, POs, invoices, VOs) are never hard-deleted. Records are kept for 7 years; an organization-closure flow comes with the superadmin phase.

## 6. Authentication

### 6.1 Better Auth (in `apps/web`)

- Email and password. Email verification is required before sign-in.
- Passwords: minimum 12 characters, maximum 128, checked against breach lists by the `haveIBeenPwned` plugin, and hashed with **Argon2id** (`@node-rs/argon2`, `memoryCost 19456 KiB, timeCost 2, parallelism 1`).
- `twoFactor` plugin with TOTP and backup codes. The app layout sends anyone without `twoFactorEnabled` to `/setup-mfa`. The API rejects their tokens with `MFA_REQUIRED`.
- `jwt` plugin: EdDSA (Ed25519) signing, `exp` 10 min, `iss = BETTER_AUTH_URL`, `aud = "veenix-api"`. The payload is `{sub, email, name, ev, mfa, sct}`, where `ev` = email verified, `mfa` = TOTP enrolled, and `sct` = session created at (ms).
- Sessions are stored in the database: `expiresIn` 12 h with `updateAge` 15 min (sliding idle limit). The 7-day absolute limit is enforced in two places: the web layout (it signs out once the session is older than 7 days) and the API (it rejects tokens whose `sct` is more than 7 days old).
- Rate limits are stored in Redis: sign-in 5/min, TOTP verify 5/min, password reset 3 per 5 min, sign-up 5/h, everything else 100/min.
- `revokeSessionsOnPasswordReset: true`.

### 6.2 API side

- `verifyIdentity(token)` in `apps/api/src/auth/identity.ts` is **the only file that knows the auth provider**. It checks the signature against the JWKS, the issuer and audience, `EdDSA`, and `exp` with 5 s tolerance. It then requires `ev`, `mfa` and a fresh `sct`.
- An `app_users` record is created on first sight of a new `sub`.
- Roles are read from `memberships` on **every request** and never put in the token, so changing or removing a role takes effect immediately.
- Revoking a session cuts off API access within at most 10 minutes (the token lifetime). That's an accepted trade-off.

### 6.3 Organization context

Each request names its organization in the `x-org-id` header. The web app keeps the current organization in a `veenix_org` cookie and offers an organization switcher once a user belongs to more than one.

### 6.4 Onboarding

```
sign-up → verify email → set up MFA → (accept an invitation | create an organization) → dashboard
```

Signup is open for now (`SIGNUP_MODE=open`). Invitations: `{email, role}`, a 32-byte random token stored only as a SHA-256 hash, 7-day expiry, single use. The accepting user's email must match the invitation.

### 6.5 Swapping to Clerk later

1. Replace `apps/web/lib/auth*.ts` and the auth pages with Clerk's Next.js SDK.
2. Rewrite `verifyIdentity()`:
   - JWKS URL and issuer come from Clerk
   - `ev` comes from `email_verified`
   - `mfa` comes from Clerk's `fva` claim (a second factor is verified when `fva[1] !== -1`)
3. Change `app_users.authSubject` to the Clerk user id. Clerk can import Argon2id hashes, which needs checking at switch time. TOTP secrets may not transfer, in which case every user sets up MFA again.

Memberships, roles and project assignments live in our database, so they don't move.

### 6.6 Superadmin (later)

`app_users.platformRole = 'superadmin'` already exists. The later phase adds:
- `SIGNUP_MODE=invite_only` (Better Auth `databaseHooks.user.create.before` rejects emails that have no pending invitation)
- `/v1/platform/*` routes
- a portal to create organizations and hand out invitations

## 7. Authorization

Roles, per membership: `owner`, `admin`, `sales`, `project_manager`, `site_staff`, `procurement`, `finance`.

| Permission | owner | admin | sales | project_manager | site_staff | procurement | finance |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `org:manage` (letterhead, bank, pricing, tax, e-invoice setup) | ✓ | ✓ | | | | | |
| `member:manage` | ✓ | ✓ | | | | | |
| `lead:read`, `lead:write` (incl. convert) | ✓ | ✓ | ✓ | | | | |
| `project:read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `project:write` | ✓ | ✓ | | ✓ | | | |
| `project:assign` | ✓ | ✓ | | | | | |
| `bom:write` | ✓ | ✓ | | ✓ | | | |
| `vendor:read` | ✓ | ✓ | ✓ | ✓ | | ✓ | ✓ |
| `vendor:write` | ✓ | ✓ | | | | ✓ | |
| `procurement:write` (RFQs, quotes, accept, PO terms) | ✓ | ✓ | | ✓ | | ✓ | |
| `vendor_payment:write` | ✓ | ✓ | | | | | ✓ |
| `quotation:write`, `quotation:send`, `quotation:record` | ✓ | ✓ | | ✓ | | | |
| `vo:write`, `vo:record` | ✓ | ✓ | | ✓ | | | |
| `billing:write`, `billing:mark_paid` | ✓ | ✓ | | | | | ✓ |
| `einvoice:submit` | ✓ | ✓ | | | | | ✓ |
| `file:write` | ✓ | ✓ | | ✓ | ✓ | ✓ | |
| `document:send` | ✓ | ✓ | | ✓ | | ✓ | ✓ |
| `report:read` | ✓ | ✓ | | | | | ✓ |

- The matrix lives as one constant in `packages/shared/src/permissions.ts`. Changing a role means editing that file.
- **Project scope:** for `project_manager` and `site_staff`, the request context holds `projectScope = [ids of projects where assignees.userId = me]`. Every other role gets `'all'`. The tenant plugin (§9) adds `projectId ∈ scope` (or `_id ∈ scope` on `projects`) to every query on project-owned collections.
- **No field-level hiding:** inside a visible project, every role sees every field.
- **Membership rules:**
  - Only `owner` can grant or revoke `owner`; `admin` can manage every other role.
  - Nobody changes their own role.
  - The last owner can't be removed or demoted.
- **Fail closed:** an org-scoped route with no `@Can(...)` declared is rejected with a 500 at request time. An omitted permission therefore shows up immediately as an error rather than as an open route.

## 8. Money

- **Storage:** every money field is an integer number of sen (RM 1 = 100 sen), stored as a Mongo `Number`. Mongoose validators require `Number.isSafeInteger`; Zod uses `z.int()`.
- **Unit costs are whole sen.** Quantities are not money and may have up to 3 decimals.
- **Rounding:** only where a calculation produces fractions of a sen, exactly once, half-up, using `big.js` (never float multiplication):
  - `lineTotal(qty, unitSen)`
  - `withMarkup(costSen, pct)`
  - `sstOn(subtotalSen, sstBps)`
  - `splitSstInclusive(totalSen, sstBps)`
  - `allocate(totalSen, rows)`: the last row takes the remainder, so the parts always add up to the total exactly
- **SST:** `organizations.sstBps` (default 800 = 8%) replaces the hard-coded `SST_RATE`.
- **Input:** forms take ringgit text ("1,234.50"). The web converts it with `parseRinggit()` and sends integer sen. The API rejects anything that isn't an integer.
- **Authority:** the API computes every stored value and every headline figure: line totals, quotation totals and SST, margins, schedule amounts, contract value, collected amount, dashboard KPIs and report figures. All of them are returned in DTOs.
  - The browser may compute **previews** while a form is being typed (shared functions), but a computed total is never accepted from the client.
  - Simple display arithmetic on numbers already shown (e.g. "RM 2,000 over budget") may stay in components.
- **Display:** `formatCurrency(sen)` shows "RM 1,234.50", or "RM 1,200" when there are no sen. `formatMoney2(sen)` always shows two decimals.

## 9. Multi-tenancy enforcement

- **Request context:** a `RequestContext {userId, orgId, role, projectScope, inTx, afterCommit[]}` is kept in AsyncLocalStorage (`nestjs-cls`). `AccessGuard` sets it.
- **`tenantPlugin(schema, { projectField })`** is applied to every tenant collection's schema:
  - It adds `{orgId}` (plus the project-scope filter) through `query.and([...])` on every query: `find*`, `count*`, `distinct`, `update*`, `delete*`, `replaceOne`, `findOneAnd*`.
  - On `aggregate`, it puts `$match` first, or right after a leading `$search`.
  - On `save`, it stamps `orgId` and rejects saves to another organization or outside the project scope.
  - With no context present, it throws, so a missing context never becomes an unscoped query.
- **Not allowed on tenant models:** `insertMany`, `bulkWrite`, `estimatedDocumentCount`, and `doc.deleteOne()`. Use `Model.create([...])` and `Model.deleteOne(filter)`.
- **System work** (jobs, migration) runs inside `runWithCtx(systemCtx(orgId), fn)`.
- **Tests:** for every tenant collection, reading another org's record by `_id` returns 404, and a project manager reading an unassigned project returns 404. 404 rather than 403, so the record's existence isn't revealed.

## 10. Performance

- **Region:** Vercel `sin1` together with Atlas `ap-southeast-1` (Singapore).
- **Project page:** one `projects` read plus 6 parallel indexed reads by `projectId` (rfqs, purchase_orders, quotations, variation_orders, invoices, files), plus 1 vendor `$in` read.
- **Dashboard:** one active-projects read plus the same per-collection `$in` reads for all visible projects at once. No queries repeat per project.
- **Reads:** `.lean()` with projections on all reads. Leads use page-based pagination (10 per page, as the UI has now).
- **Reports and dashboard:** lean reads with projections, keeping the page's current calculations. Marked `ponytail:` so they move to aggregation pipelines once one organization's data outgrows that (thousands of leads or projects).
- **Connections:** cached on `globalThis` across invocations; `maxPoolSize: 10`.
- **Targets:** API p95 under 150 ms in-region for reads, under 300 ms for writes.

## 11. Real-time

- **Publishing:** after a transaction commits, a service calls `changed({ kind, id, projectId? })`, which publishes JSON to the Redis channel `live:<orgId>`. Events carry ids only.
- **Subscribing:**
  1. The browser gets a 60-second ticket (`POST /v1/live/ticket`, via a server action), an HS256 JWT holding `{sub, org, scope}`.
  2. It opens `EventSource(API_URL/v1/live?ticket=…)`.
  3. The API checks the ticket and subscribes the stream to the org channel. Events outside the user's `scope` are dropped, and events with no `projectId` are dropped for project-scoped roles.
- **Heartbeat:** every 25 s.
- **Reconnect:** when the function hits its duration limit the stream closes. The client fetches a new ticket and reconnects, with a backoff of 1, 2, 4… up to 30 s.
- **Client:** `useLiveRefresh(filter)` calls `router.refresh()`, debounced 300 ms. It's mounted on the project page (filter `projectId`) and the dashboard (any event).

## 12. Files

- **Store:** the S3 API through `@aws-sdk/client-s3`. Environment variables: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`.
  - SeaweedFS locally (`http://localhost:8333`, path style).
  - R2 in production (`https://<account>.r2.cloudflarestorage.com`, region `auto`).
- **Keys:** `orgs/<orgId>/<purpose>/<uuid><ext>`, with purposes `quotes | invoices | photos | vo | files | logos | documents`.
- **Upload flow:**
  1. `POST /v1/uploads {purpose, filename, contentType, size}` → `{key, url}`, a presigned PUT valid for 5 min. Content type and length are signed into it.
  2. The browser PUTs the file to storage.
  3. The form submits `key` + `name`. The service calls `storage.claim(key, purpose, name)`, which checks:
     - the key prefix
     - the purpose's extension allow-list (same as today's `lib/uploads.ts`)
     - `HeadObject` size ≤ 10 MB
     - **magic bytes**: PDF `%PDF`, PNG, JPEG, WEBP, ZIP (docx/xlsx), OLE (doc/xls)

     A file that fails a check is deleted.
- **Downloads:** `GET /v1/downloads/:kind/:id` → `{url}`, a presigned GET valid for 5 min with `Content-Disposition`. It loads the owning record through the tenant plugin, so access follows project scope. The web keeps its current `/api/uploads/<kind>/<id>` URLs, which now become 302 redirects. This also fixes the links that are broken today.
- **No SVG uploads.** Uploaded-but-unclaimed objects are left in storage (a bucket lifecycle rule for `orgs/*/…` can clear them later).

## 13. Background jobs

- **Table:** `jobs` (§5.1). `jobs.enqueue(type, payload)` inserts inside the caller's transaction, so a job exists only if the change that triggered it was committed.
- **Running:**
  - After commit, `jobs.kick()` runs due jobs under `waitUntil()` (`@vercel/functions`).
  - A middleware also kicks at most once per minute per instance whenever any request arrives.
  - A cron runs `GET /v1/internal/jobs/run` (header `Authorization: Bearer CRON_SECRET`). It runs daily on Vercel Hobby and can be per-minute on Pro.
- **Claiming:** an atomic `findOneAndUpdate` sets `status: running`, `lockedUntil: now + 2 min`, and `attempts + 1`.
- **Retries:** backoff `2^attempts` minutes, failing for good after 8 attempts.
- **Handlers:** `mail.send`, `document.snapshot`, `einvoice.submit`, `einvoice.poll`. Each runs inside `systemCtx(job.orgId)`.

## 14. Search

- **One collection:** `search_entries`, rewritten after commit by the services that own each kind:

  | Kind | Title | Subtitle / keywords |
  |---|---|---|
  | lead | name | code · phone · city |
  | project | name | code · client · city |
  | vendor | name | type · location |
  | quotation | code | project name |
  | po | code | vendor · project |
  | invoice | code | project |

- **Atlas Search index** `search_entries`:
  - `orgId` and `projectId` as `objectId`, `kind` as `token`
  - `title` as `string` + `autocomplete` (edgeGram 2–15, diacritics folded)
  - `subtitle` and `keywords` as `string`
- **Query** (`GET /v1/search?q=`): `compound.should` = autocomplete on title (fuzzy `maxEdits 1`) + text on all three fields (fuzzy `maxEdits 1`, or 2 when the query is 6+ characters).
  - `filter`: `orgId`, plus `projectId ∈ scope` for scoped roles.
  - `mustNot`: kind `lead` without `lead:read`.
  - Results: limit 20, grouped by kind on screen.
- **Rebuild:** `pnpm --filter api search:rebuild` rewrites every entry.
- **Free-tier limit:** Atlas M0 allows 3 search indexes, and this uses 1.

## 15. Documents, email and WhatsApp

- **Templates:** the PDF templates move from `apps/web/lib/pdf` to `apps/api/src/documents/templates` and keep their markup.
- **Endpoints:**
  - `GET /v1/documents/:type/:id/pdf` streams a PDF. Types are `quotation | invoice | po | rfq | rfq-bundle`.
  - The web keeps its `/api/documents/...` routes as thin proxies.
- **Snapshots:**
  - When a quotation is **sent** or an invoice is **generated**, a `document.snapshot` job renders the PDF and stores it under `documents/` with its SHA-256 hash.
  - Later downloads of that quotation revision or invoice return the stored file, so a later letterhead change can't alter what the client received.
  - Drafts, POs and RFQs are rendered fresh on every download.
- **Email:** `POST /v1/documents/:type/:id/email {to, message?}` enqueues `mail.send` with the PDF attached. The send is recorded in `documents.sends[]`.
- **WhatsApp:** `POST /v1/documents/:type/:id/share {phone?}` → `{url, whatsappUrl}`.
  - `url` is a presigned GET valid for 7 days.
  - `whatsappUrl` is `https://wa.me/<phone>?text=<message + url>`, opened from the staff member's own WhatsApp.

## 16. LHDN MyInvois

- **Credentials per organization:** `organizations.einvoice = {enabled, environment: 'preprod' | 'prod', tin, brn, sstNo, clientId, clientSecretEnc, certificateEnc, certificatePasswordEnc}`. Secrets are encrypted with AES-256-GCM using `FIELD_ENCRYPTION_KEY`.
- **Flow:**
  1. Generating an invoice enqueues `einvoice.submit` (when `enabled`).
  2. The job builds the UBL 2.1 JSON document, signs it (v1.1), and submits it.
  3. It stores `submissionUid` and enqueues `einvoice.poll`.
  4. Polling stores `uuid`, `longId`, `validatedAt`, or the `errors`.
  5. The invoice DTO exposes `eInvoiceUuid` and `eInvoiceValidatedAt` (the UI's existing fields), plus `eInvoiceStatus`.
- **Development:** all of this is built against the **pre-production** environment first. Plan 10 lists exactly what must be checked against the official SDK.

## 17. Errors and API conventions

- **Prefix:** `/v1`. All bodies are JSON. Ids are 24-hex strings, and dates are ISO strings; the web client turns those back into `Date` objects.
- **Error body:** `{ "error": { "code": "...", "message": "human sentence", "details"?: ... } }`

  | Code | Status |
  |---|---|
  | `VALIDATION` | 400 |
  | `UNAUTHENTICATED`, `MFA_REQUIRED`, `EMAIL_UNVERIFIED`, `SESSION_EXPIRED` | 401 |
  | `FORBIDDEN` | 403 |
  | `NOT_FOUND` | 404 |
  | `CONFLICT`, `DUPLICATE` | 409 |
  | `RULE` (a business rule, with the same messages the UI shows today) | 422 |
  | `RATE_LIMITED` | 429 |
  | `INTERNAL` | 500, never with a stack trace |

- **Validation:** Zod `strictObject` everywhere, so unknown keys are rejected. That blocks clients from setting fields such as `orgId` or totals. String-typed fields block MongoDB operator injection, and `mongoose.set('strictQuery', 'throw')` is on.
- **API rate limits** (Redis fixed window): 600 requests/min per user; 30/min on `/documents/*` and `/uploads`.
- **Idempotency:** creating the same record twice is blocked by the database, not by clients sending idempotency keys:
  - accepting a quote → `rfqId` unique on POs
  - generating an invoice → `milestoneId` unique
  - the schedule → refused if one exists
  - payments → refused if already `PAID`

  This replaces the idempotency-key idea from earlier in the planning conversation, with less code.
- **Time zone:** business dates use Asia/Kuala_Lumpur (UTC+8, no DST), through `@veenix/shared/time`. That covers code years (`QT-2026-…`), "today" on the dashboard, and invoice due dates. `formatDate` formats in `Asia/Kuala_Lumpur`.

## 18. Security checklist (release gate)

- [ ] Argon2id hashing, breached-password check, 12-character minimum
- [ ] Email verification and MFA enforced on both web and API
- [ ] Session idle and absolute limits; revocation on password reset
- [ ] Rate limits on auth endpoints and the API
- [ ] Generic sign-in errors (no hint whether an email has an account)
- [ ] JWT algorithm, issuer, audience and expiry pinned
- [ ] Strict Zod on every body/query; ObjectId params validated; `strictQuery: 'throw'`
- [ ] Tenant plugin on every tenant schema; cross-tenant and cross-project tests pass
- [ ] Permission declared on every org route (the fail-closed check)
- [ ] Uploads: presigned with signed length; magic-byte check; private bucket; 5-min download links
- [ ] Secrets only in env; LHDN secrets encrypted; logs redact `authorization`, `cookie`, `password`, `token`, `secret`
- [ ] `helmet` on the API; CORS on the API allows only `WEB_ORIGIN` (needed for SSE)
- [ ] Audit events for money, role and auth-relevant actions
- [ ] `pnpm audit` clean of high/critical findings

## 19. Environments

| | Local | Production (later) |
|---|---|---|
| Web | `localhost:3100` | Vercel project `veenix-web` |
| API | `localhost:4000` | Vercel project `veenix-api`, `sin1` |
| MongoDB | `mongodb/mongodb-atlas-local:8.0` (replica set + Search) | Atlas M0/M10 `ap-southeast-1` |
| Redis | `valkey/valkey:8` | Upstash (Vercel Marketplace) |
| Storage | `chrislusf/seaweedfs` S3 gateway on 8333 | Cloudflare R2 |
| Email | `axllent/mailpit` (SMTP 1025, UI 8025) | Marketplace SMTP provider |
| Cron | manual `curl` | Vercel Cron (daily on Hobby) |

Vercel **Hobby is for non-commercial use** under Vercel's terms. Move to Pro before onboarding paying customers.
