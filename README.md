# Veenix

Veenix is a project management platform for interior design and renovation firms in Malaysia. It covers the whole job, from the first lead to the final invoice, and lets several organizations share one platform with their data kept fully separate.

## What it does

- **Leads → projects:** capture leads with Malaysian addresses and turn them into projects.
- **Work and BOM:** break a project into work items with self-performed (labour and materials) and outsourced lines.
- **Vendors and procurement:** request quotes from vendors, send RFQ PDFs, compare and revise quotes, accept one and set payment terms.
- **Quotations:** build and send client quotations with SST, log client questions and replies, and record the signing.
- **Variation orders:** raise and sign changes after the quotation is signed.
- **Billing:** turn payment terms into invoices and track payments. LHDN MyInvois e-invoicing is planned.
- **Files, reports and settings:** project files, reports, a dashboard and a company letterhead.
- **Accounts and access:** sign-up with mandatory two-step verification, organizations, invitations and roles. Project managers and site staff see only the projects they are assigned to.
- **Copilot (in progress):** an AI assistant in the app and on WhatsApp. It answers questions about your records, takes actions only after you approve them, sends site updates and reminders, and generates room concepts (a restyled photo plus an editable 3D room).

## How it is built

A pnpm monorepo:

| Path | What it is |
|---|---|
| `apps/web` | Next.js 16 app (React 19). Handles sign-in (Better Auth) and the user interface, including the Three.js 3D room viewer |
| `apps/api` | NestJS 11 REST API on MongoDB (Mongoose). Holds the business rules, PDFs, background jobs, live updates (SSE) and the Copilot |
| `packages/shared` | `@veenix/shared`: Zod schemas, DTO types, enums, money and date helpers, and domain logic used by both apps |
| `docs/backend` | Design specs and the step-by-step build plan, with progress |

Money is stored as whole sen and is calculated only on the server.

Local services run in Docker (`docker-compose.yml`): MongoDB with Atlas Search, Valkey (Redis), SeaweedFS (S3-compatible file storage) and Mailpit (catches outgoing email).

## Running it locally

You need Node 24, pnpm 10 and Docker Desktop.

```sh
pnpm install
cp apps/api/.env.example apps/api/.env      # then fill in the <random> values
pnpm services:up
pnpm --filter api storage:init && pnpm --filter api db:indexes
pnpm dev
```

The web app reads `apps/web/.env`: `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, `MONGODB_URI`, `REDIS_URL`, `SMTP_URL`, `MAIL_FROM`, `API_URL`, `NEXT_PUBLIC_API_URL` and `SIGNUP_MODE`.

- Web: http://localhost:3100 (sign up at `/signup`)
- API: http://localhost:4000
- Email inbox (Mailpit): http://localhost:8025

The Copilot and WhatsApp features stay off until you set `OPENAI_API_KEY` and the `WHATSAPP_*` values in `apps/api/.env`.

## Checks

```sh
pnpm check    # builds the shared package, then runs typecheck and tests
```

## Documentation

Start with [docs/backend/README.md](docs/backend/README.md). It explains the spec, the plan files and which tasks are done. [apps/web/START-HERE.md](apps/web/START-HERE.md) is a short guide for testers.
