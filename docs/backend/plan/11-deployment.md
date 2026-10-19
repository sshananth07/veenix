# 11: Deployment (later; don't run yet)

> Written down now so the earlier plans stay compatible with it. Start this only when you decide to go live. It needs the Vercel CLI (`npm i -g vercel`) and your own accounts. Nothing here is provisioned yet.

**Goal:** the web app and the API on Vercel in Singapore, with MongoDB Atlas, Upstash Redis, Cloudflare R2 and an SMTP provider.

**Architecture:** two Vercel projects from the one repo (`apps/web`, `apps/api`), both in region `sin1`. Every service is wired by environment variables only; no code changes.

**Spec:** [../spec.md](../spec.md) §19.

## Constraints to know first
- **Vercel Hobby** is for non-commercial use. Move to **Pro** before onboarding paying customers. Pro also enables per-minute cron.
- **Atlas M0 (free)** has no continuous backups. Use **M10 or above** before real customer data goes in (spec §19 backups).
- **Hobby has no static outbound IPs,** so Atlas network access needs either the Atlas Vercel integration or `0.0.0.0/0` with a strong database password over TLS. Pro or Enterprise static IPs remove that.

---

### Task 11.1: Provision the services

- [ ] **MongoDB Atlas.**
  - Create a cluster on AWS `ap-southeast-1` (Singapore), version 8.x, either through the Vercel Marketplace integration (`vercel integration add mongodbatlas`; ⚠ check the slug with `vercel integration discover --category storage`) or directly in Atlas.
  - Create a database user with `readWrite` on the `veenix` database only.
  - Note the connection string as `MONGODB_URI`, with `/veenix?retryWrites=true&w=majority`.
- [ ] **Upstash Redis** through the Vercel Marketplace, in the Singapore region. Use the TLS URL (`rediss://…`) as `REDIS_URL`.
- [ ] **Cloudflare R2.**
  - Create the bucket `veenix-prod` and an API token with Object Read & Write on that bucket only.
  - Set:

    | Variable | Value |
    |---|---|
    | `S3_ENDPOINT` | `https://<account id>.r2.cloudflarestorage.com` |
    | `S3_REGION` | `auto` |
    | `S3_BUCKET` | `veenix-prod` |
    | `S3_FORCE_PATH_STYLE` | `true` |
    | `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | from the token |

- [ ] **Email.**
  - Add an SMTP-capable provider from the Vercel Marketplace (messaging category) and verify your sending domain (SPF and DKIM records).
  - Set `SMTP_URL`, e.g. `smtps://<user>:<password>@<host>:465`, and `MAIL_FROM="Veenix <no-reply@yourdomain.my>"`.

### Task 11.2: Vercel projects and environment variables

- [ ] **API project** (`veenix-api`):
  - Root directory `apps/api`, framework NestJS.
  - Install command `pnpm install`.
  - Build command `pnpm --filter @veenix/shared build && pnpm --filter api build`.
  - ⚠ Verify in Vercel's NestJS guide that it runs `src/main.ts` as written in plan 03. If it expects an exported handler instead, export the app from `main.ts` as the guide shows; `createApp()` already exists for this.
  - Add `apps/api/vercel.json`:
    ```json
    { "regions": ["sin1"], "crons": [{ "path": "/v1/internal/jobs/run", "schedule": "0 0 * * *" }] }
    ```
    Change the schedule to `"* * * * *"` on Pro.
  - Env: everything in `apps/api/.env.example` with production values:
    - `NODE_ENV=production`
    - `WEB_ORIGIN=https://<web domain>`
    - `AUTH_JWKS_URL=https://<web domain>/api/auth/jwks`
    - `AUTH_ISSUER=https://<web domain>`
    - new random `LIVE_TICKET_SECRET`, `CRON_SECRET` and `FIELD_ENCRYPTION_KEY`
  - Mark every secret as Sensitive.
- [ ] **Web project** (`veenix-web`):
  - Root directory `apps/web`, framework Next.js, region `sin1` (`apps/web/vercel.json`: `{ "regions": ["sin1"] }`).
  - Env:
    - `BETTER_AUTH_URL=https://<web domain>`
    - a new `BETTER_AUTH_SECRET`
    - `MONGODB_URI`, `REDIS_URL`, `SMTP_URL`, `MAIL_FROM`
    - `API_URL` and `NEXT_PUBLIC_API_URL` (`https://<api domain>`)
    - `SIGNUP_MODE=open`
- [ ] **First deploy and one-time setup.** From your machine, with the production variables pulled into a local file that is never committed:
  ```bash
  vercel env pull apps/api/.env.production.local --environment=production --cwd apps/api
  (cd apps/api && set -a && . ./.env.production.local && set +a && pnpm db:indexes && pnpm storage:init)
  rm apps/api/.env.production.local
  ```
- [ ] **Smoke test.**
  - `https://<api domain>/v1/health` returns `{"ok":true}`.
  - Sign up, verify the email, set up MFA and create an organization.
  - Upload a file, generate a PDF and email it.
- [ ] **Before inviting customers:** go through the release-gate checklist in spec §18. Every box must be ticked.
