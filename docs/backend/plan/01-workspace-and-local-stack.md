# 01: Workspace and local stack

> For whoever implements this (you or Claude): work task by task and tick each one off in [../README.md](../README.md). Steps use `- [ ]` checkboxes. Claude works through it with superpowers:executing-plans.

**Goal:** turn the repo into a pnpm workspace with the existing app in `apps/web` (still working on Prisma), and run every dev service in Docker.

**Architecture:** the root holds the workspace configuration and `docker-compose.yml`. The app moves unchanged.

**Tech stack:** pnpm 10, Node 24, Docker Compose.

**Spec:** [../spec.md](../spec.md) §3 and §19.

## Global constraints
- Node 24 LTS (`node --version` → `v24.x`).
- pnpm 10 (`pnpm --version` → `10.x`).
- Run all commands from the repo root `C:\Users\shananth\Veenix` in Git Bash unless a step says otherwise.

## Review focus
- **Hidden dependency on a hoisted package:** pnpm doesn't hoist. If `next dev` fails with "Cannot find module X", add X to `apps/web/package.json` rather than enabling hoisting.
- **Uploads folder:** `uploads/` is git-ignored, so `git mv` won't move it. Move it by hand, or the migration in plan 09 finds no files.

---

### Task 1.1: pnpm workspace, app moved to `apps/web`

**Files:**
- Move: `actions/ app/ components/ lib/ prisma/ next-env.d.ts next.config.mjs package.json postcss.config.js tailwind.config.ts tsconfig.json START-HERE.md` → `apps/web/`
- Move by hand (git-ignored): `.env`, `uploads/` → `apps/web/`
- Delete: `package-lock.json`, `node_modules/`, `.next/`
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore` (edit)

**Interfaces:**
- Produces:
  - workspace globs `apps/*` and `packages/*`
  - the root scripts `dev`, `build`, `test`, `typecheck`, `check`, `services:up`, `services:down` (later tasks add to them)
  - the web package name `web`

- [x] **Step 1: Install pnpm**

```bash
npm install -g pnpm@10
pnpm --version
```
Expected: `10.x.x`

- [x] **Step 2: Move the app**

```bash
mkdir -p apps/web packages
git mv actions app components lib prisma next-env.d.ts next.config.mjs package.json postcss.config.js tailwind.config.ts tsconfig.json START-HERE.md apps/web/
mv .env apps/web/.env
mv uploads apps/web/uploads
rm -rf node_modules .next package-lock.json
git rm --cached package-lock.json 2>/dev/null || true
```

- [x] **Step 3: Rename the web package**

In `apps/web/package.json`, change `"name": "veenix"` to `"name": "web"`. Add `"typecheck": "tsc --noEmit"` to its scripts.

- [x] **Step 4: Create the root files**

`pnpm-workspace.yaml`:
```yaml
packages:
  - apps/*
  - packages/*

# pnpm 10 blocks install scripts unless the package is listed here.
onlyBuiltDependencies:
  - "@prisma/client"
  - "@prisma/engines"
  - prisma
  - esbuild
  - "@swc/core"
  - sharp
```

`package.json`:
```json
{
  "name": "veenix",
  "private": true,
  "scripts": {
    "dev": "pnpm --parallel --filter @veenix/shared --filter web --filter api run dev",
    "build": "pnpm --filter @veenix/shared build && pnpm --filter api --filter web build",
    "test": "pnpm -r --if-present test",
    "typecheck": "pnpm -r --if-present typecheck",
    "check": "pnpm --filter @veenix/shared build && pnpm typecheck && pnpm test",
    "services:up": "docker compose up -d",
    "services:down": "docker compose down"
  },
  "engines": {
    "node": ">=24"
  }
}
```

`tsconfig.base.json` (packages and the API extend it; the web keeps its own Next.js tsconfig):
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": true,
    "sourceMap": true
  }
}
```

Append to `.gitignore`:
```
dist
apps/web/uploads
apps/web/prisma/dev.db
apps/web/prisma/dev.db-journal
```

- [x] **Step 5: Install and run the web app**

```bash
pnpm install
pnpm --filter web exec prisma generate
pnpm --filter web dev
```
Expected: `Ready` on port 3100. Open http://localhost:3100 and the sample data shows. Stop it with Ctrl+C.

If it fails with `Cannot find module 'X'`, run `pnpm --filter web add X` and retry.

- [x] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: pnpm workspace with the Next.js app in apps/web"
```

---

### Task 1.2: Docker services

**Files:**
- Create: `docker-compose.yml`, `docker/seaweedfs/s3.json`, `.env.example`

**Interfaces:**
- Produces these local endpoints, which later tasks put in `.env` files:
  - `MONGODB_URI=mongodb://veenix:veenix-dev-only@localhost:27017/veenix?authSource=admin&directConnection=true`
  - `REDIS_URL=redis://localhost:6379`
  - `S3_ENDPOINT=http://localhost:8333`, `S3_ACCESS_KEY_ID=veenix`, `S3_SECRET_ACCESS_KEY=veenix-dev-secret`, `S3_REGION=us-east-1`, `S3_BUCKET=veenix-dev`, `S3_FORCE_PATH_STYLE=true`
  - `SMTP_URL=smtp://localhost:1025`, with the Mailpit UI at http://localhost:8025

- [x] **Step 1: Write `docker-compose.yml`**

```yaml
name: veenix

services:
  mongo:
    # Single-node replica set (transactions work) with Atlas Search built in.
    image: mongodb/mongodb-atlas-local:8.0
    # Fixed so the replica set config stored in the volume still matches after the container is recreated.
    hostname: mongo
    environment:
      MONGODB_INITDB_ROOT_USERNAME: veenix
      MONGODB_INITDB_ROOT_PASSWORD: veenix-dev-only
    ports: ["27017:27017"]
    volumes:
      - mongo-data:/data/db
      - mongo-config:/data/configdb

  redis:
    image: valkey/valkey:8
    ports: ["6379:6379"]
    volumes:
      - redis-data:/data

  storage:
    # S3-compatible object store. Production swaps in Cloudflare R2 through env vars only.
    image: chrislusf/seaweedfs:latest
    command: "server -dir=/data -ip.bind=0.0.0.0 -s3 -s3.port=8333 -s3.config=/etc/seaweedfs/s3.json"
    ports: ["8333:8333"]
    volumes:
      - storage-data:/data
      - ./docker/seaweedfs/s3.json:/etc/seaweedfs/s3.json:ro

  mail:
    image: axllent/mailpit:latest
    ports:
      - "1025:1025" # SMTP
      - "8025:8025" # web inbox

volumes:
  mongo-data:
  mongo-config:
  redis-data:
  storage-data:
```

- [x] **Step 2: Write `docker/seaweedfs/s3.json`**

```json
{
  "identities": [
    {
      "name": "veenix",
      "credentials": [{ "accessKey": "veenix", "secretKey": "veenix-dev-secret" }],
      "actions": ["Admin", "Read", "Write", "List", "Tagging"]
    }
  ]
}
```

- [x] **Step 3: Write `.env.example`** (documentation only; each app gets its own `.env` in later tasks)

```bash
# Local service endpoints from docker-compose.yml
MONGODB_URI=mongodb://veenix:veenix-dev-only@localhost:27017/veenix?authSource=admin&directConnection=true
REDIS_URL=redis://localhost:6379
S3_ENDPOINT=http://localhost:8333
S3_REGION=us-east-1
S3_BUCKET=veenix-dev
S3_ACCESS_KEY_ID=veenix
S3_SECRET_ACCESS_KEY=veenix-dev-secret
S3_FORCE_PATH_STYLE=true
SMTP_URL=smtp://localhost:1025
```

- [x] **Step 4: Start the services and check each one**

```bash
pnpm services:up
docker compose ps
```
Expected: four services, each `running`. Mongo may show `starting` for about 30 s while the search process boots.

```bash
docker compose exec mongo mongosh "mongodb://veenix:veenix-dev-only@localhost:27017/?authSource=admin&directConnection=true" --quiet --eval "rs.status().ok"
```
Expected: `1` (a replica set, so transactions work)

```bash
docker compose exec redis valkey-cli ping
```
Expected: `PONG`

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8333
```
Expected: an HTTP status line, usually `403` (the S3 gateway is up and refusing anonymous access). `000` means it isn't up yet; check `docker compose logs storage`.

Open http://localhost:8025. Expected: an empty Mailpit inbox.

- [x] **Step 5: Pin the SeaweedFS version**

```bash
docker compose exec storage weed version
```
Replace `chrislusf/seaweedfs:latest` in `docker-compose.yml` with the version printed, e.g. `chrislusf/seaweedfs:3.xx`, so later pulls don't change behaviour.

- [x] **Step 6: Commit**

```bash
git add docker-compose.yml docker/ .env.example
git commit -m "chore: docker services for local development"
```
