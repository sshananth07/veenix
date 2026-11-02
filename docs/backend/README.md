# Veenix backend: start here

This folder holds the design and the step-by-step build guide for moving Veenix from Prisma/SQLite inside Next.js to a NestJS + MongoDB API that supports multiple organizations.

| File | What it is |
|---|---|
| [spec.md](spec.md) | **What** is being built and why: every decision from the planning session |
| [plan/01-workspace-and-local-stack.md](plan/01-workspace-and-local-stack.md) | pnpm workspace, moving the app to `apps/web`, Docker services |
| [plan/02-shared-package.md](plan/02-shared-package.md) | `@veenix/shared`: enums, money (sen), formatting, time, Zod schemas, DTO types, domain functions |
| [plan/03-api-foundation.md](plan/03-api-foundation.md) | NestJS app, config, Mongo, request context, tenant plugin, errors, transactions, counters, audit |
| [plan/04-auth-and-access.md](plan/04-auth-and-access.md) | Better Auth in web (MFA, sessions, JWT), the API's identity check, organizations, memberships, invitations, RBAC guard |
| [plan/05-platform-services.md](plan/05-platform-services.md) | Storage and uploads, background jobs, email, live updates (SSE), search |
| [plan/06-domain-modules.md](plan/06-domain-modules.md) | Vendors, leads, projects and BOM, quotations, procurement, variation orders, billing, files, settings, dashboard, reports |
| [plan/07-documents-and-sending.md](plan/07-documents-and-sending.md) | PDFs in the API, stored snapshots, sending by email, WhatsApp share links |
| [plan/08-web-integration.md](plan/08-web-integration.md) | Switching the Next.js app from Prisma to the API, uploads, live refresh, team and member screens |
| [plan/09-data-migration.md](plan/09-data-migration.md) | Copying everything in `dev.db` and `uploads/` into Mongo and storage |
| [plan/10-lhdn-myinvois.md](plan/10-lhdn-myinvois.md) | Real e-invoice submission to LHDN (pre-production first) |
| [plan/11-deployment.md](plan/11-deployment.md) | **Later.** Vercel, Atlas, Upstash, R2 and email provider setup. Don't run it yet |
| [copilot-spec.md](copilot-spec.md) | **What** the AI Copilot is and why: WhatsApp and in-app assistant, tools, approvals, 3D room concepts |
| [plan/12-copilot-core.md](plan/12-copilot-core.md) | Job lanes, running as a member, site updates and tasks, tool registry, `query_records`, turn loop, approvals, undo and the action catalogue, in-app chat |
| [plan/13-copilot-procurement-and-budget.md](plan/13-copilot-procurement-and-budget.md) | Vendor quotes, budget lines, quote acceptance and vendor payment tools; financial questions and procurement catalogue; the assistant evaluation |
| [plan/14-copilot-whatsapp.md](plan/14-copilot-whatsapp.md) | Phone linking, webhook, sending, voice notes and buttons |
| [plan/15-copilot-proactive.md](plan/15-copilot-proactive.md) | Morning summary, task reminders, audio retention |
| [plan/16-copilot-room-concepts.md](plan/16-copilot-room-concepts.md) | 3D spike, concept generation, WhatsApp delivery, the viewer in chat |

## How to use the plan

- **Order:** work through the plan files in number order. One exception: run **plan 09 (data migration) as soon as plan 06 is done**, before plan 08, so the web app has real data to compare against while you switch it over. Each task lists the files it touches, the code, a check command with its expected output, and a commit.
- **Ticking off:** tick the box here when a task is done, so anyone can see where things stand.
- **Plan sections:**
  - **Interfaces** blocks name what a task uses from earlier tasks and what it provides to later ones. If a name in your code differs from the plan, fix it to match; later tasks depend on it.
  - **⚠ Verify** marks a library API that may have changed since this was written (October 2026). Check it against that package's installed docs before relying on it.
- **Commits:** each task ends with one commit on `main`, in the form `feat(api): …`, `feat(web): …`, `chore: …`, `test: …`. The repo is local-only; don't add a remote until you choose a private host.
- **Picking up again (you or Claude):** read this README, find the first unticked box, open that plan file at that task, and run `git log --oneline -5` to confirm the last finished commit. Claude's memory also points here.

## Build rules (the "ponytail" approach)

Take the simplest version that works. Before writing anything, go down this list and stop at the first that holds:

1. **Does it need to exist?** If it's for a "maybe later", skip it. Later can build it.
2. **Is it already here?** Use what's already in `@veenix/shared`, `src/common/*`, or the old code under `apps/web/actions` and `apps/web/lib`. Most business logic is **ported, not rewritten**: same rules, same messages.
3. **Do Node, the platform or an installed package already do it?** Use that before adding a dependency.
4. **Only then**, write the smallest code that does the job.

Concretely:
- No interface with one implementation, no factory for one product, no setting for a value that never changes. One Nest module (`AppModule`) for the whole API.
- Map DTOs with `plain()`. Write a mapper only where a join is needed.
- Ship one test per real rule (money, a state change, a cascade, access). No tests for plain wiring.
- When a simplification has a known limit, mark it in the code with a `ponytail:` comment naming the limit and the upgrade path. For example: `// ponytail: fixed-window rate limit; switch to sliding window if bursts at the boundary matter`.
- Never cut corners on: validation at the API boundary, tenant and project scoping, money rounding, transactions around multi-document writes, or security checks.

## Progress

### 01 Workspace and local stack
- [x] 1.1 pnpm workspace; app moved to `apps/web`; still runs on Prisma
- [x] 1.2 Docker services up (Mongo + Search, Valkey, SeaweedFS, Mailpit)

### 02 Shared package
- [x] 2.1 Package scaffold and build
- [x] 2.2 Money, formatting, time (with tests)
- [x] 2.3 Enums, address, payment terms, permissions
- [x] 2.4 Domain functions: BOM, quotation, procurement, attention (with tests)
- [x] 2.5 Zod input schemas
- [x] 2.6 DTO types

### 03 API foundation
- [x] 3.1 NestJS scaffold, env, health endpoint, toolchain smoke test
- [x] 3.2 Mongo connection, request context, errors, Zod pipe, `plain()`
- [x] 3.3 Tenant plugin and `Sen` type (with isolation tests)
- [x] 3.4 Transactions, `afterCommit`, counters, audit

### 04 Auth and access
- [x] 4.1 Better Auth in web: config, route handler, mail
- [x] 4.2 Auth pages: sign-up, verify, MFA setup and verify, login, reset
- [x] 4.3 API identity check, `app_users`
- [x] 4.4 Organizations, memberships, invitations, `/me`
- [x] 4.5 AccessGuard, `@Can`, project scope, rate limit (with tests)
- [x] 4.6 Web session helpers, onboarding, organization switcher

### 05 Platform services
- [x] 5.1 Redis, storage service, bucket init, uploads endpoint (with tests)
- [x] 5.2 Jobs: outbox, runner, cron endpoint (with tests)
- [x] 5.3 Mail service
- [x] 5.4 Live updates: `changed()`, SSE, tickets (with tests)
- [x] 5.5 Search: entries, Atlas Search index, query (with tests)

### 06 Domain modules
- [x] 6.1 Vendors (the template for the other modules)
- [x] 6.2 All other domain models
- [x] 6.3 Leads and convert to project (with tests)
- [x] 6.4 Projects: detail payload, list, update, assignees
- [x] 6.5 Work items, BOM, the draft-quotation refresh (with tests)
- [x] 6.6 Quotations (with tests)
- [x] 6.7 Procurement: RFQs, quotes, POs, vendor payments (with tests)
- [x] 6.8 Variation orders and billing (with tests)
- [x] 6.9 Files and downloads
- [x] 6.10 Organization settings
- [x] 6.11 Dashboard and reports

### 07 Documents and sending
- [x] 7.1 PDF templates and rendering in the API
- [x] 7.2 Snapshots for sent quotations and invoices
- [x] 7.3 Send by email; WhatsApp share link

### 08 Web integration
- [x] 8.1 API client, shims in `lib/`, date and sen formatting
- [x] 8.2 Server actions call the API
- [x] 8.3 Pages read from the API
- [x] 8.4 Uploads through presigned URLs; download redirects; PDF proxies
- [x] 8.5 Live refresh, global search, team and member screens
- [x] 8.6 Remove Prisma

### 09 Data migration
- [x] 9.1 Migration script (SQLite + uploads → Mongo + storage)
- [x] 9.2 Verification report and clicking through the app

### 10 LHDN MyInvois
- [x] 10.1 Per-organization e-invoice settings (encrypted)
- [ ] 10.2 MyInvois client, submission and polling jobs (pre-production)

### 11 Deployment (later, don't start yet)
- [ ] 11.1 Provision the services
- [ ] 11.2 Vercel projects and environment variables

### 12 Copilot core and in-app chat
- [ ] 12.1 Before building: Meta's terms and the speech spike (owner)
- [x] 12.2 Job lanes and per-type retries (with tests)
- [x] 12.3 Running as a member, permissions, personal live events (with tests)
- [x] 12.4 Site updates and tasks (with tests)
- [x] 12.5 Tool registry (with tests)
- [ ] 12.5b `query_records` (with tests)
- [ ] 12.6 Turn loop (with tests)
- [ ] 12.7 Approval and undo (with tests)
- [ ] 12.8 In-app chat
- [ ] 12.9 Updates tab and tasks screen

### 13 Copilot procurement and budget
- [ ] 13.1 Record a vendor quote (with tests)
- [ ] 13.2 Propose budget lines (with tests)
- [ ] 13.3 Propose quote acceptance and vendor payment (with tests)
- [ ] 13.3b Financial questions and procurement catalogue (with tests)
- [ ] 13.4 Assistant evaluation

### 14 Copilot on WhatsApp
- [ ] 14.1 Phone linking (with tests)
- [ ] 14.2 Webhook (with tests)
- [ ] 14.3 Sending (with tests)
- [ ] 14.4 Inbound job, voice and buttons (with tests)

### 15 Copilot proactive messages
- [ ] 15.1 Morning summary (with tests)
- [ ] 15.2 Task reminders (with tests)

### 16 Copilot 3D room concepts
- [ ] 16.1 Spike (owner judges)
- [ ] 16.2 Concepts and generation jobs (with tests)
- [ ] 16.3 WhatsApp delivery (with tests)
- [ ] 16.4 Viewer in the chat and on its own page
