# 02: Shared package (`@veenix/shared`)

> For whoever implements this (you or Claude): work task by task and tick each one off in [../README.md](../README.md).

**Goal:** one package that both apps import for enums, money (integer sen), formatting, Malaysian time, the permission matrix, Zod input schemas, DTO types, and the pure domain functions (BOM costing, quotation totals, readiness, procurement stage, attention).

**Architecture:** plain TypeScript, compiled by `tsc` to CommonJS in `dist/`. No framework code. Most of it is moved out of `apps/web/lib/*` and changed in two ways: money is in sen, and the functions take DTO types instead of Prisma types. The web app keeps using Prisma until plan 08, so **don't change `apps/web` in this plan.**

**Tech stack:** TypeScript ≥ 5.8, Zod 4, big.js 6, Vitest 3.

**Spec:** [../spec.md](../spec.md) §7, §8, §17.

## Global constraints
- Every money value is an integer number of sen (`Sen`). Rounding happens only in `money.ts`: half-up, using big.js.
- Dates format and calculate in `Asia/Kuala_Lumpur` (UTC+8, no DST).
- Zod objects are `z.strictObject` (unknown keys are rejected).
- Error messages copy today's messages from `apps/web/actions/*`, because the UI shows them as they are.

## Review focus
- **Float traps in quantities:** `lineTotal(0.145, 100)` must be `15` (half-up on the exact decimal). Plain JS `Math.round(0.145 * 100)` gives `14`. That test is in Task 2.2.
- **Remainder allocation:** `allocate` must make the parts add up exactly to the total for every input. Tested with an odd total.
- **Blank form fields:** an empty string for an optional text field must become `null`, not `""`. Tested in Task 2.5.
- **Payment terms that don't total 100%:** the error message must name the actual sum ("Payment terms add up to 90%…"). Tested in Task 2.5.
- **Midnight in Malaysia:** `mytYear(new Date('2026-12-31T16:30:00Z'))` is 2027. Tested in Task 2.2.

---

### Task 2.1: Package scaffold

**Files:**
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/src/index.ts`

**Interfaces:**
- Produces: the package `@veenix/shared`, built to `packages/shared/dist`, with scripts `build`, `dev`, `test`, `typecheck`.

- [x] **Step 1: Write `packages/shared/package.json`**

```json
{
  "name": "@veenix/shared",
  "version": "0.0.0",
  "private": true,
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsc -p tsconfig.json --watch --preserveWatchOutput",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  }
}
```

- [x] **Step 2: Install the dependencies**

```bash
pnpm --filter @veenix/shared add zod@^4 big.js@^6
pnpm --filter @veenix/shared add -D typescript@^5.8 vitest@^3 @types/big.js@^6 @types/node@^24
```

- [x] **Step 3: Write `packages/shared/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts"]
}
```

- [x] **Step 4: Write a placeholder `packages/shared/src/index.ts`**

```ts
export const SHARED_OK = true;
```

- [x] **Step 5: Build it**

Run: `pnpm --filter @veenix/shared build && ls packages/shared/dist`
Expected: `index.d.ts  index.js  index.js.map`

- [x] **Step 6: Commit**

```bash
git add packages/shared pnpm-lock.yaml
git commit -m "chore(shared): package scaffold"
```

---

### Task 2.2: Money, formatting, time

**Files:**
- Create: `packages/shared/src/money.ts`, `packages/shared/src/time.ts`, `packages/shared/src/format.ts`
- Test: `packages/shared/src/money.test.ts`, `packages/shared/src/time.test.ts`

**Interfaces:**
- Produces:
  - `type Sen = number`
  - `isSen(v): v is Sen`
  - `parseRinggit(input: string): Sen | null`
  - `senToInput(sen: Sen | null | undefined): string`
  - `lineTotal(qty: number, unitSen: Sen): Sen`
  - `withMarkup(costSen: Sen, markupPct: number): Sen`
  - `sstOn(subtotalSen: Sen, sstBps: number): Sen`
  - `splitSstInclusive(totalSen: Sen, sstBps: number): { exSst: Sen; sst: Sen }`
  - `allocate(totalSen: Sen, rows: { pct: number }[]): Sen[]`
  - `MY_TZ`, `mytYear(d?)`, `mytStartOfDay(d?)`, `addDays(d, n)`, `toDateInput(d)`, `daysBetween(a, b)`
  - `formatCurrency(sen)`, `formatMoney2(sen)`, `formatNumber(n, maxFractionDigits?)`, `formatBudget(minSen, maxSen)`, `formatDate(d)`, `formatDateTime(d)`

- [x] **Step 1: Write the failing tests**

`packages/shared/src/money.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { allocate, lineTotal, parseRinggit, senToInput, splitSstInclusive, sstOn, withMarkup } from "./money";
import { formatCurrency, formatBudget } from "./format";

describe("parseRinggit", () => {
  it("reads ringgit text into sen", () => {
    expect(parseRinggit("1,234.50")).toBe(123450);
    expect(parseRinggit("RM 12")).toBe(1200);
    expect(parseRinggit("0.05")).toBe(5);
  });
  it("rejects blanks, negatives and fractions of a sen", () => {
    expect(parseRinggit("")).toBeNull();
    expect(parseRinggit("-5")).toBeNull();
    expect(parseRinggit("1.234")).toBeNull();
    expect(parseRinggit("abc")).toBeNull();
  });
});

describe("rounding", () => {
  it("rounds qty x price half-up on the exact decimal, not the float", () => {
    expect(lineTotal(0.145, 100)).toBe(15);
    expect(lineTotal(12.5, 345)).toBe(4313);
    expect(lineTotal(3, 1999)).toBe(5997);
  });
  it("applies markup", () => {
    expect(withMarkup(10000, 40)).toBe(14000);
    expect(withMarkup(333, 40)).toBe(466);
  });
  it("computes and splits SST", () => {
    expect(sstOn(100000, 800)).toBe(8000);
    expect(splitSstInclusive(108000, 800)).toEqual({ exSst: 100000, sst: 8000 });
    const s = splitSstInclusive(12345, 800);
    expect(s.exSst + s.sst).toBe(12345);
  });
  it("allocates so parts always sum to the total", () => {
    expect(allocate(100001, [{ pct: 30 }, { pct: 70 }])).toEqual([30000, 70001]);
    const parts = allocate(99999, [{ pct: 33 }, { pct: 33 }, { pct: 34 }]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(99999);
  });
});

describe("display", () => {
  it("formats sen as ringgit", () => {
    expect(formatCurrency(123450)).toBe("RM 1,234.50");
    expect(formatCurrency(120000)).toBe("RM 1,200");
    expect(senToInput(123450)).toBe("1234.50");
    expect(senToInput(120000)).toBe("1200");
    expect(senToInput(null)).toBe("");
  });
  it("formats budgets in sen", () => {
    expect(formatBudget(10_000_000, 20_000_000)).toBe("RM 100k – 200k");
    expect(formatBudget(null, null)).toBeNull();
  });
});
```

`packages/shared/src/time.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { mytStartOfDay, mytYear, toDateInput } from "./time";

describe("Malaysia time", () => {
  it("rolls the year at Malaysian midnight, not UTC midnight", () => {
    expect(mytYear(new Date("2026-12-31T16:30:00Z"))).toBe(2027);
    expect(mytYear(new Date("2026-12-31T15:30:00Z"))).toBe(2026);
  });
  it("finds the start of the Malaysian day", () => {
    expect(mytStartOfDay(new Date("2026-05-10T20:00:00Z")).toISOString()).toBe("2026-05-10T16:00:00.000Z");
  });
  it("gives the Malaysian date for date inputs", () => {
    expect(toDateInput(new Date("2026-05-10T20:00:00Z"))).toBe("2026-05-11");
  });
});
```

- [x] **Step 2: Run them to confirm they fail**

Run: `pnpm --filter @veenix/shared test`
Expected: FAIL. `Failed to resolve import "./money"`.

- [x] **Step 3: Write `packages/shared/src/money.ts`**

```ts
import Big from "big.js";

/** A whole number of sen (RM 1 = 100 sen). Every money value in Veenix is a Sen. */
export type Sen = number;

export function isSen(v: unknown): v is Sen {
  return typeof v === "number" && Number.isSafeInteger(v);
}

function roundHalfUp(b: Big): Sen {
  return Number(b.round(0, Big.roundHalfUp));
}

/** "1,234.50", "1234.5" or "RM 12" → sen. Null for blanks, negatives, text, or more than 2 decimals. */
export function parseRinggit(input: string): Sen | null {
  const s = input.replace(/^RM\s*/i, "").replace(/,/g, "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const sen = Number(new Big(s).times(100).toFixed(0));
  return Number.isSafeInteger(sen) ? sen : null;
}

/** Form default value: 123450 → "1234.50", 120000 → "1200", null → "". */
export function senToInput(sen: Sen | null | undefined): string {
  if (sen == null) return "";
  const ringgit = new Big(sen).div(100);
  return sen % 100 === 0 ? ringgit.toFixed(0) : ringgit.toFixed(2);
}

/** qty × unit price, rounded half-up to the sen. qty may have decimals (12.5 sq ft). */
export function lineTotal(qty: number, unitSen: Sen): Sen {
  return roundHalfUp(new Big(qty).times(unitSen));
}

/** Cost marked up by a whole-number percentage: 10000 at 40% → 14000. */
export function withMarkup(costSen: Sen, markupPct: number): Sen {
  return roundHalfUp(new Big(costSen).times(100 + markupPct).div(100));
}

/** SST on a subtotal. The rate is in basis points: 800 = 8%. */
export function sstOn(subtotalSen: Sen, sstBps: number): Sen {
  return roundHalfUp(new Big(subtotalSen).times(sstBps).div(10_000));
}

/** Splits an SST-inclusive amount into the amount before SST and the SST. The two always add back up. */
export function splitSstInclusive(totalSen: Sen, sstBps: number): { exSst: Sen; sst: Sen } {
  const exSst = roundHalfUp(new Big(totalSen).times(10_000).div(10_000 + sstBps));
  return { exSst, sst: totalSen - exSst };
}

/** Splits a total across percentage rows. The last row takes the rounding remainder so the parts add up exactly. */
export function allocate(totalSen: Sen, rows: { pct: number }[]): Sen[] {
  let running = 0;
  return rows.map((r, i) => {
    const amount = i === rows.length - 1 ? totalSen - running : roundHalfUp(new Big(totalSen).times(r.pct).div(100));
    running += amount;
    return amount;
  });
}
```

- [x] **Step 4: Write `packages/shared/src/time.ts`**

```ts
export const MY_TZ = "Asia/Kuala_Lumpur";

// Malaysia is UTC+8 all year (no daylight saving), so a fixed offset is exact.
const OFFSET_MS = 8 * 3_600_000;
const DAY_MS = 86_400_000;

export function mytYear(d: Date = new Date()): number {
  return new Date(d.getTime() + OFFSET_MS).getUTCFullYear();
}

/** The UTC instant at which the Malaysian calendar day containing `d` began. */
export function mytStartOfDay(d: Date = new Date()): Date {
  const local = new Date(d.getTime() + OFFSET_MS);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() - OFFSET_MS);
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS);
}

/** "YYYY-MM-DD" in Malaysian time, for <input type="date"> values. */
export function toDateInput(value: Date | string | null | undefined): string {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  return new Date(d.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

export function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / DAY_MS);
}
```

- [x] **Step 5: Write `packages/shared/src/format.ts`**

These are moved from `apps/web/lib/utils.ts`. Money now takes sen, and dates format in Malaysian time.

```ts
import type { Sen } from "./money";
import { MY_TZ } from "./time";

/** "RM 1,234.50", or "RM 1,200" when there are no sen. */
export function formatCurrency(sen: Sen): string {
  const digits = sen % 100 === 0 ? 0 : 2;
  return "RM " + new Intl.NumberFormat("en-MY", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(sen / 100);
}

/** Always two decimals: "RM 1,200.00". */
export function formatMoney2(sen: Sen): string {
  return "RM " + new Intl.NumberFormat("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(sen / 100);
}

export function formatNumber(value: number, maxFractionDigits = 2): string {
  return new Intl.NumberFormat("en-MY", { maximumFractionDigits: maxFractionDigits }).format(value);
}

/** "RM 100k – 200k": compact enough for a table cell. Inputs are sen. */
export function formatBudget(minSen: Sen | null | undefined, maxSen: Sen | null | undefined): string | null {
  const short = (sen: number) => {
    const n = sen / 100;
    const trim = (v: number) => String(Math.round(v * 10) / 10);
    return n >= 1_000_000 ? `${trim(n / 1_000_000)}m` : n >= 1000 ? `${trim(n / 1000)}k` : String(n);
  };
  if (minSen != null && maxSen != null) return `RM ${short(minSen)} – ${short(maxSen)}`;
  if (minSen != null) return `From RM ${short(minSen)}`;
  if (maxSen != null) return `Up to RM ${short(maxSen)}`;
  return null;
}

export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "-";
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-MY", { timeZone: MY_TZ, year: "numeric", month: "short", day: "numeric" }).format(d);
}

export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return "-";
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-MY", {
    timeZone: MY_TZ,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}
```

- [x] **Step 6: Run the tests**

Run: `pnpm --filter @veenix/shared test`
Expected: PASS (all tests in both files).

- [x] **Step 7: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): money in sen, Malaysian time, formatting"
```

---

### Task 2.3: Enums, address, payment terms, permissions

**Files:**
- Create: `packages/shared/src/enums.ts`, `packages/shared/src/address.ts`, `packages/shared/src/payment-terms.ts`, `packages/shared/src/permissions.ts`
- Test: `packages/shared/src/permissions.test.ts`

**Interfaces:**
- Produces:
  - tuples `LEAD_STATUSES`, `PROJECT_STAGES`, `PO_STATUSES`, `PO_MILESTONE_STATUSES`, `QUOTATION_STATUSES`, `OPEN_QUOTATION_STATUSES`, `VO_STATUSES`, `MILESTONE_STATUSES`, `INVOICE_STATUSES`, `PERFORMED_BY`, `UPLOAD_PURPOSES`, with the matching union types (`LeadStatus`, `ProjectStage`, `PoStatus`, `PoMilestoneStatus`, `QuotationStatus`, `VoStatus`, `MilestoneStatus`, `InvoiceStatus`, `PerformedBy`, `UploadPurpose`)
  - the labels and lists that move unchanged from `lib/types.ts`
  - `VO_REASONS`, `UPLOAD_RULES`, `CONTENT_TYPES`, `MAX_UPLOAD_BYTES`
  - `MY_STATES`, `AddressParts`, `addressLines`, `composeAddress`, `hasStructuredAddress`, `isPostcode`
  - `TERM_TEMPLATES`, `TermRow`
  - `ROLES`, `Role`, `PERMISSIONS`, `Permission`, `ROLE_PERMISSIONS`, `PROJECT_SCOPED_ROLES`, `ASSIGNABLE_ROLES`, `can(role, permission)`, `isProjectScoped(role)`

- [x] **Step 1: Write the failing test** `packages/shared/src/permissions.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { can, isProjectScoped, PERMISSIONS, ROLES } from "./permissions";

describe("permission matrix", () => {
  it("gives owner and admin every permission", () => {
    for (const p of PERMISSIONS) {
      expect(can("owner", p)).toBe(true);
      expect(can("admin", p)).toBe(true);
    }
  });
  it("matches the spec for the restricted roles", () => {
    expect(can("sales", "lead:write")).toBe(true);
    expect(can("sales", "bom:write")).toBe(false);
    expect(can("project_manager", "quotation:send")).toBe(true);
    expect(can("project_manager", "lead:read")).toBe(false);
    expect(can("site_staff", "file:write")).toBe(true);
    expect(can("site_staff", "vendor:read")).toBe(false);
    expect(can("finance", "billing:mark_paid")).toBe(true);
    expect(can("procurement", "billing:write")).toBe(false);
  });
  it("scopes only project managers and site staff to assigned projects", () => {
    expect(ROLES.filter(isProjectScoped)).toEqual(["project_manager", "site_staff"]);
  });
});
```

- [x] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @veenix/shared test permissions`
Expected: FAIL. `Failed to resolve import "./permissions"`.

- [x] **Step 3: Write `packages/shared/src/enums.ts`**

Copy `PROPERTY_TYPES`, `LEAD_SOURCES`, `WORK_UNIT_GROUPS`, `WORK_UNITS` and `MATERIAL_UNITS` **unchanged** from `apps/web/lib/types.ts`. Replace the union types with `as const` tuples so Zod can use them:

```ts
export const LEAD_STATUSES = ["NEW", "CONTACTED", "SITE_SURVEY", "QUOTED", "CONVERTED", "LOST"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const PROJECT_STAGES = ["SITE_VISIT", "QUOTING", "WORK_IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;
export type ProjectStage = (typeof PROJECT_STAGES)[number];

export const PO_STATUSES = ["ISSUED", "PAID"] as const;
export type PoStatus = (typeof PO_STATUSES)[number];

export const PO_MILESTONE_STATUSES = ["PENDING", "INVOICED", "PAID"] as const;
export type PoMilestoneStatus = (typeof PO_MILESTONE_STATUSES)[number];

export const QUOTATION_STATUSES = ["DRAFT", "SENT", "VIEWED", "QUESTIONED", "ACCEPTED", "SUPERSEDED"] as const;
export type QuotationStatus = (typeof QUOTATION_STATUSES)[number];
/** Versions that are with the client and waiting on them. */
export const OPEN_QUOTATION_STATUSES: readonly QuotationStatus[] = ["SENT", "VIEWED", "QUESTIONED"];

export const VO_STATUSES = ["DRAFT", "CLIENT_REVIEW", "ACCEPTED"] as const;
export type VoStatus = (typeof VO_STATUSES)[number];

export const MILESTONE_STATUSES = ["NOT_YET_DUE", "AWAITING_PAYMENT", "PAID", "HELD", "PENDING_SIGNOFF"] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

export const INVOICE_STATUSES = ["ISSUED", "SENT", "PAID"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const PERFORMED_BY = ["OUTSOURCED", "SELF"] as const;
export type PerformedBy = (typeof PERFORMED_BY)[number];

export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  SITE_SURVEY: "Site Survey",
  QUOTED: "Quoted",
  CONVERTED: "Converted",
  LOST: "Lost",
};

export const PROJECT_STAGE_LABEL: Record<ProjectStage, string> = {
  SITE_VISIT: "Site Visit",
  QUOTING: "Quoting",
  WORK_IN_PROGRESS: "Work in Progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

// PROPERTY_TYPES, LEAD_SOURCES, WORK_UNIT_GROUPS, WORK_UNITS, MATERIAL_UNITS: paste from apps/web/lib/types.ts

export const VO_REASONS = ["Client request", "Design change", "Site condition", "Additional scope", "Other"];

// ---- Uploads (rules moved from apps/web/lib/uploads.ts) --------------------

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const CONTENT_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export const UPLOAD_PURPOSES = ["quotes", "invoices", "photos", "vo", "files", "logos"] as const;
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

const IMAGE_EXT = [".png", ".jpg", ".jpeg", ".webp"];
const DOCUMENT_EXT = [".pdf", ...IMAGE_EXT];

export const UPLOAD_RULES: Record<UploadPurpose, { exts: string[]; label: string }> = {
  quotes: { exts: DOCUMENT_EXT, label: "Upload a PDF, PNG, JPG or WEBP file" },
  invoices: { exts: DOCUMENT_EXT, label: "Upload a PDF, PNG, JPG or WEBP file" },
  vo: { exts: DOCUMENT_EXT, label: "Upload a PDF, PNG, JPG or WEBP file" },
  photos: { exts: IMAGE_EXT, label: "Upload a PNG, JPG or WEBP image" },
  logos: { exts: IMAGE_EXT, label: "Upload a PNG, JPG or WEBP image" },
  files: { exts: Object.keys(CONTENT_TYPES), label: "Upload a PDF, image, Word or Excel file" },
};
```

- [x] **Step 4: Write `packages/shared/src/address.ts`**

Copy `MY_STATES`, `AddressParts`, `addressLines`, `composeAddress`, `hasStructuredAddress` and `isPostcode` **unchanged** from `apps/web/lib/address.ts`. Leave `parseAddress(formData, …)` out: it reads `FormData`, so it stays in the web app.

- [x] **Step 5: Write `packages/shared/src/payment-terms.ts`**

Copy `TermRow` and `TERM_TEMPLATES` unchanged from `apps/web/lib/paymentTerms.ts`. `allocate` now lives in `money.ts`, and term validation is in the Zod schemas (Task 2.5).

- [x] **Step 6: Write `packages/shared/src/permissions.ts`**

```ts
export const ROLES = ["owner", "admin", "sales", "project_manager", "site_staff", "procurement", "finance"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "org:manage",
  "member:manage",
  "lead:read",
  "lead:write",
  "project:read",
  "project:write",
  "project:assign",
  "bom:write",
  "vendor:read",
  "vendor:write",
  "procurement:write",
  "vendor_payment:write",
  "quotation:write",
  "quotation:send",
  "quotation:record",
  "vo:write",
  "vo:record",
  "billing:write",
  "billing:mark_paid",
  "einvoice:submit",
  "file:write",
  "document:send",
  "report:read",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

// The one place role permissions are defined (spec §7). Edit here to change a role.
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: PERMISSIONS,
  admin: PERMISSIONS,
  sales: ["lead:read", "lead:write", "project:read", "vendor:read"],
  project_manager: [
    "project:read",
    "project:write",
    "bom:write",
    "vendor:read",
    "procurement:write",
    "quotation:write",
    "quotation:send",
    "quotation:record",
    "vo:write",
    "vo:record",
    "file:write",
    "document:send",
  ],
  site_staff: ["project:read", "file:write"],
  procurement: ["project:read", "vendor:read", "vendor:write", "procurement:write", "file:write", "document:send"],
  finance: [
    "project:read",
    "vendor:read",
    "vendor_payment:write",
    "billing:write",
    "billing:mark_paid",
    "einvoice:submit",
    "document:send",
    "report:read",
  ],
};

/** Roles that only see projects they are assigned to. */
export const PROJECT_SCOPED_ROLES: readonly Role[] = ["project_manager", "site_staff"];

/** Roles a project assignment can carry. */
export const ASSIGNABLE_ROLES = ["project_manager", "site_staff"] as const;

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function isProjectScoped(role: Role): boolean {
  return PROJECT_SCOPED_ROLES.includes(role);
}
```

- [x] **Step 7: Run the tests**

Run: `pnpm --filter @veenix/shared test`
Expected: PASS.

- [x] **Step 8: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): enums, address, payment terms, permission matrix"
```

---

### Task 2.4: Domain functions

**Files:**
- Create: `packages/shared/src/bom.ts`, `packages/shared/src/quotation.ts`, `packages/shared/src/procurement.ts`, `packages/shared/src/attention.ts`
- Test: `packages/shared/src/bom.test.ts`, `packages/shared/src/quotation.test.ts`

**Interfaces:**
- Consumes: `lineTotal`, `sstOn` (Task 2.2); the enums (Task 2.3); the DTO types (Task 2.6). **Write Task 2.6's `dto.ts` first if your editor complains**: Tasks 2.4 and 2.6 only depend on each other's types.
- Produces:
  - `calcBomTotal({qty, unitCost, materials?}) → {base, materials, total}`, all in sen
  - `type BomCost = { cost: Sen; priced: boolean; source: "PO" | "SELF" | "ESTIMATE" }`
  - `bomCosts(bomItems: BomItemDto[]): Record<string, BomCost>`
  - `type Blocker = { message: string; tab: "bom" | "vendors" }`
  - `type Readiness = { ready: boolean; blockers: Blocker[]; total: number; priced: number }`
  - `quotationReadiness(workItems: WorkItemDto[], bomItems: BomItemDto[]): Readiness`
  - `type QuotationTotals = { cost; subtotal; sst; total; profit; marginPct }`
  - `quotationTotals(lines, sstBps): QuotationTotals`
  - `groupByWorkItem(lines)`, `unitPrice(clientPrice, qty)`, `markupToMarginPct(markupPct)`
  - `type PackageStage`, `getPackageStage(rfq, po)`, `getPackages(project)`
  - `type Priority`, `type AttentionItem`, `PRIORITY_ORDER`, `getAttention(project, readiness)`

- [x] **Step 1: Write the failing tests**

`packages/shared/src/bom.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { bomCosts, calcBomTotal, quotationReadiness } from "./bom";
import type { BomItemDto, WorkItemDto } from "./dto";

const line = (over: Partial<BomItemDto>): BomItemDto => ({
  id: "b1", workItemId: "w1", seq: 1, workPackage: "Kitchen cabinets", description: null,
  qty: 1, unit: "lot", unitCost: 0, estTotal: 0, performedBy: "OUTSOURCED", materials: [], awarded: null, ...over,
});
const kitchen: WorkItemDto = { id: "w1", seq: 1, name: "Kitchen", description: null };

describe("calcBomTotal", () => {
  it("adds labour and materials in sen", () => {
    expect(calcBomTotal({ qty: 10, unitCost: 1250, materials: [{ qty: 2.5, unitCost: 333 }] })).toEqual({ base: 12500, materials: 833, total: 13333 });
  });
});

describe("bomCosts", () => {
  it("prices outsourced work from the awarded PO and self work from its estimate", () => {
    const costs = bomCosts([
      line({ id: "a", estTotal: 500000 }),
      line({ id: "b", estTotal: 500000, awarded: { poId: "p", amount: 450000 } }),
      line({ id: "c", performedBy: "SELF", estTotal: 120000 }),
    ]);
    expect(costs.a).toEqual({ cost: 500000, priced: false, source: "ESTIMATE" });
    expect(costs.b).toEqual({ cost: 450000, priced: true, source: "PO" });
    expect(costs.c).toEqual({ cost: 120000, priced: true, source: "SELF" });
  });
});

describe("quotationReadiness", () => {
  it("blocks on unpriced outsourced lines and empty work items", () => {
    const r = quotationReadiness([kitchen, { id: "w2", seq: 2, name: "Bathroom", description: null }], [line({ id: "a", estTotal: 1 })]);
    expect(r.ready).toBe(false);
    expect(r.blockers.map((b) => b.message)).toEqual([
      'Work item "Bathroom" has no BOM lines yet',
      '"Kitchen cabinets" is waiting for an accepted vendor quote',
    ]);
  });
  it("is ready when every line is priced", () => {
    const r = quotationReadiness([kitchen], [line({ awarded: { poId: "p", amount: 100 } })]);
    expect(r).toEqual({ ready: true, blockers: [], total: 1, priced: 1 });
  });
});
```

`packages/shared/src/quotation.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { quotationTotals } from "./quotation";

describe("quotationTotals", () => {
  it("totals cost, price, SST and margin in sen", () => {
    const t = quotationTotals([{ bomCost: 100000, clientPrice: 140000 }, { bomCost: 50000, clientPrice: 70000 }], 800);
    expect(t).toEqual({ cost: 150000, subtotal: 210000, sst: 16800, total: 226800, profit: 60000, marginPct: (60000 / 210000) * 100 });
  });
});
```

- [x] **Step 2: Run them to confirm they fail**

Run: `pnpm --filter @veenix/shared test`
Expected: FAIL on the missing `./bom` and `./quotation`.

- [x] **Step 3: Write `packages/shared/src/bom.ts`**

```ts
import { lineTotal, type Sen } from "./money";
import type { BomItemDto, WorkItemDto } from "./dto";

export function calcBomTotal(input: { qty: number; unitCost: Sen; materials?: { qty: number; unitCost: Sen }[] }) {
  const base = lineTotal(input.qty, input.unitCost);
  const materials = (input.materials ?? []).reduce((s, m) => s + lineTotal(m.qty, m.unitCost), 0);
  return { base, materials, total: base + materials };
}

export type BomCost = { cost: Sen; priced: boolean; source: "PO" | "SELF" | "ESTIMATE" };

// What the quotation is priced from: the awarded PO for outsourced work,
// the labour + materials roll-up for self-performed work.
export function bomCosts(bomItems: BomItemDto[]): Record<string, BomCost> {
  const costs: Record<string, BomCost> = {};
  for (const b of bomItems) {
    if (b.performedBy === "SELF") costs[b.id] = { cost: b.estTotal, priced: b.estTotal > 0, source: "SELF" };
    else if (b.awarded) costs[b.id] = { cost: b.awarded.amount, priced: true, source: "PO" };
    else costs[b.id] = { cost: b.estTotal, priced: false, source: "ESTIMATE" };
  }
  return costs;
}

export type Blocker = { message: string; tab: "bom" | "vendors" };
export type Readiness = { ready: boolean; blockers: Blocker[]; total: number; priced: number };

// A quotation can only be built once every line has a firm price. Same rules
// and messages as the old lib/bom.ts getQuotationReadiness.
export function quotationReadiness(workItems: WorkItemDto[], bomItems: BomItemDto[]): Readiness {
  const costs = bomCosts(bomItems);
  const lines = [...bomItems].sort((a, b) => a.seq - b.seq);
  const blockers: Blocker[] = [];
  if (lines.length === 0) blockers.push({ message: "Add at least one BOM line", tab: "bom" });
  for (const w of [...workItems].sort((a, b) => a.seq - b.seq)) {
    if (!lines.some((b) => b.workItemId === w.id)) blockers.push({ message: `Work item "${w.name}" has no BOM lines yet`, tab: "bom" });
  }
  for (const b of lines) {
    if (!b.workItemId) blockers.push({ message: `"${b.workPackage}" is not under a work item`, tab: "bom" });
    else if (b.performedBy === "SELF" && !costs[b.id].priced) blockers.push({ message: `"${b.workPackage}" has no cost`, tab: "bom" });
    else if (b.performedBy !== "SELF" && !costs[b.id].priced)
      blockers.push({ message: `"${b.workPackage}" is waiting for an accepted vendor quote`, tab: "vendors" });
  }
  return { ready: blockers.length === 0, blockers, total: lines.length, priced: Object.values(costs).filter((c) => c.priced).length };
}
```

- [x] **Step 4: Write `packages/shared/src/quotation.ts`**

Move `groupByWorkItem`, `unitPrice` and `markupToMarginPct` unchanged from `apps/web/lib/quotation.ts`. Delete `SST_RATE`, and replace `quotationTotals` with:

```ts
import { sstOn, type Sen } from "./money";

export type QuotationTotals = { cost: Sen; subtotal: Sen; sst: Sen; total: Sen; profit: Sen; marginPct: number };

export function quotationTotals(lines: { bomCost: Sen; clientPrice: Sen }[], sstBps: number): QuotationTotals {
  const cost = lines.reduce((s, l) => s + l.bomCost, 0);
  const subtotal = lines.reduce((s, l) => s + l.clientPrice, 0);
  const sst = sstOn(subtotal, sstBps);
  const profit = subtotal - cost;
  return { cost, subtotal, sst, total: subtotal + sst, profit, marginPct: subtotal > 0 ? (profit / subtotal) * 100 : 0 };
}
```

- [x] **Step 5: Write `packages/shared/src/procurement.ts`**

Copy from `apps/web/lib/procurement.ts` and change only the types:

```ts
import type { ProjectCore } from "./dto";

type Rfq = ProjectCore["rfqs"][number];
type Po = ProjectCore["purchaseOrders"][number];

export type PackageStage = "REQUEST" | "AWAITING" | "COMPARE" | "PAYING" | "DONE";

export function getPackageStage(rfq: Rfq | undefined, po: Po | undefined): PackageStage {
  if (po) return po.milestones.length > 0 && po.milestones.every((m) => m.status === "PAID") ? "DONE" : "PAYING";
  const quotes = rfq?.quotes ?? [];
  if (quotes.length === 0) return "REQUEST";
  return quotes.some((q) => q.receivedAt) ? "COMPARE" : "AWAITING";
}

export function getPackages(project: ProjectCore) {
  return project.bomItems
    .filter((b) => b.performedBy !== "SELF")
    .map((bom) => {
      const rfq = project.rfqs.find((r) => r.bomItemId === bom.id);
      const po = rfq ? project.purchaseOrders.find((p) => p.rfqId === rfq.id) : undefined;
      return { bom, rfq, po, stage: getPackageStage(rfq, po) };
    });
}
```

- [x] **Step 6: Write `packages/shared/src/attention.ts`**

Copy `apps/web/lib/attention.ts` line for line, with these changes only:
- `import type { ProjectCore } from "./dto";` and `import type { Blocker } from "./bom";` replace the Prisma imports.
- `import { formatCurrency, formatDate } from "./format";` and `import { getPackages } from "./procurement";`.
- `ProjectTabKey` is defined here, `export type ProjectTabKey = "overview" | "bom" | "vendors" | "quotation" | "variations" | "payments" | "files";`, instead of being imported.
- The signature becomes `getAttention(project: ProjectCore, readiness: { ready: boolean; blockers: Blocker[] }): AttentionItem[]`.
- The body is unchanged. Amounts are already sen and `formatCurrency` now takes sen, so the texts read the same.

- [x] **Step 7: Run the tests**

Run: `pnpm --filter @veenix/shared test`
Expected: PASS.

- [x] **Step 8: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): BOM costing, readiness, quotation totals, procurement stage, attention"
```

---

### Task 2.5: Zod input schemas

**Files:**
- Create: `packages/shared/src/schemas/common.ts`, `leads.ts`, `projects.ts`, `vendors.ts`, `procurement.ts`, `quotations.ts`, `variations.ts`, `billing.ts`, `files.ts`, `org.ts`, `index.ts` (all under `packages/shared/src/schemas/`)
- Test: `packages/shared/src/schemas/schemas.test.ts`

**Interfaces:**
- Produces each schema plus its `z.infer` type, named `XxxInput`:
  - common: `objectId`, `sen`, `positiveSen`, `qty`, `optText(max)`, `dateOrNull`, `uploadRef`, `addressParts`, `requiredAddress`
  - leads: `leadInput`, `leadActivityInput`, `convertLeadInput`, `leadListQuery`
  - projects: `projectUpdateInput`, `assigneesInput`, `workItemInput`, `bomItemInput`
  - vendors: `vendorInput`, `vendorActiveInput`, `vendorListQuery`
  - procurement: `poTerms`, `requestQuotesInput`, `quoteInput`, `acceptQuoteInput`, `poTermsInput`, `vendorInvoiceInput`, `vendorPaymentInput`
  - quotations: `clientTerms`, `buildQuotationInput`, `markupInput`, `termsInput`, `clientQuestionInput`, `replyInput`, `clientSignedInput`
  - variations: `voInput`
  - billing: `scheduleInput`
  - files: `presignInput`, `projectFilesInput`
  - org: `createOrgInput`, `letterheadInput`, `bankInput`, `pricingInput`, `taxInput`, `inviteInput`, `roleInput`, `acceptInviteInput`, `searchQuery`, `documentEmailInput`, `documentShareInput`

- [x] **Step 1: Write the failing test** `packages/shared/src/schemas/schemas.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { leadInput, poTermsInput, termsInput, bomItemInput } from "./index";

describe("schemas", () => {
  it("turns blank optional text into null and rejects unknown keys", () => {
    const ok = leadInput.parse({ name: "Aisyah", phone: "012", campaign: "  " });
    expect(ok.campaign).toBeNull();
    expect(() => leadInput.parse({ name: "A", phone: "1", orgId: "x" })).toThrow();
  });
  it("keeps today's messages", () => {
    const r = leadInput.safeParse({ name: "", phone: "1" });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0].message).toBe("Lead name is required");
  });
  it("names the actual sum when terms do not total 100%", () => {
    const r = termsInput.safeParse({ terms: [{ name: "Deposit", trigger: "", pct: 30 }, { name: "Final", trigger: "", pct: 60 }] });
    expect(r.error!.issues[0].message).toBe("Payment terms add up to 90%. They must total 100%.");
    const po = poTermsInput.safeParse({ terms: [{ label: "All", pct: 100 }] });
    expect(po.success).toBe(true);
  });
  it("rejects fractional sen and operator injection", () => {
    expect(bomItemInput.safeParse({ workItemId: "a".repeat(24), workPackage: "Tiling", unit: "sq ft", qty: 1, unitCost: 12.5, performedBy: "SELF" }).success).toBe(false);
    expect(leadInput.safeParse({ name: { $ne: null }, phone: "1" }).success).toBe(false);
  });
});
```

- [x] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @veenix/shared test schemas`
Expected: FAIL (module not found).

- [x] **Step 3: Write `schemas/common.ts`**

```ts
import { z } from "zod";
import { MY_STATES } from "../address";

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");

/** A non-negative whole number of sen. */
export const sen = z.int({ error: "Enter an amount in whole sen" }).nonnegative("Amount cannot be negative");
export const positiveSen = z.int({ error: "Enter an amount in whole sen" }).positive("Enter an amount greater than zero");

/** A quantity: positive, at most 3 decimals. */
export const qty = z
  .number({ error: "Quantity must be greater than zero" })
  .positive("Quantity must be greater than zero")
  .refine((v) => /^\d+(\.\d{1,3})?$/.test(String(v)), "Quantity can have at most 3 decimals");

/** Optional text. Blank becomes null. */
export const optText = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .default(null);

export const dateOrNull = z.coerce.date().nullable().default(null);

/** A file already PUT to storage via a presigned URL (plan 05). */
export const uploadRef = z.strictObject({
  key: z.string().min(1).max(300),
  name: z.string().trim().min(1).max(120),
});

const postcode = z
  .string()
  .regex(/^\d{5}$/, "Postcode must be 5 digits, e.g. 47300")
  .nullable()
  .default(null);
const state = z.enum(MY_STATES, { error: "Choose a valid state" }).nullable().default(null);

/** Address fields for leads: anything may be missing. */
export const addressParts = {
  addressLine1: optText(160),
  addressLine2: optText(160),
  addressLine3: optText(160),
  postcode,
  city: optText(80),
  state,
};

/** Address fields for projects: line 1, postcode, city and state are required. */
export const requiredAddress = {
  addressLine1: z.string().trim().min(1, "Address line 1 is required (unit or house number, building)").max(160),
  addressLine2: optText(160),
  addressLine3: optText(160),
  postcode: z.string().regex(/^\d{5}$/, "Postcode must be 5 digits, e.g. 47300"),
  city: z.string().trim().min(1, "City is required").max(80),
  state: z.enum(MY_STATES, { error: "Choose a state" }),
};
```

- [x] **Step 4: Write the module schemas**

`schemas/leads.ts`:
```ts
import { z } from "zod";
import { LEAD_STATUSES, PROJECT_STAGES } from "../enums";
import { addressParts, dateOrNull, optText, requiredAddress, sen } from "./common";

export const leadInput = z
  .strictObject({
    name: z.string().trim().min(1, "Lead name is required").max(200),
    phone: z.string().trim().min(1, "Phone / WhatsApp is required").max(40),
    email: z.email({ error: "Enter a valid email" }).nullable().default(null),
    source: z.string().trim().max(60).default("Other"),
    campaign: optText(),
    propertyType: optText(),
    builtUpArea: optText(60),
    budgetMin: sen.nullable().default(null),
    budgetMax: sen.nullable().default(null),
    ...addressParts,
    targetStart: optText(60),
    assignedTo: optText(120),
    surveyAt: dateOrNull,
    status: z.enum(LEAD_STATUSES).optional(),
  })
  .refine((d) => d.budgetMin == null || d.budgetMax == null || d.budgetMax > d.budgetMin, {
    error: "Max budget must be greater than min budget",
    path: ["budgetMax"],
  });
export type LeadInput = z.infer<typeof leadInput>;

export const leadActivityInput = z.strictObject({
  note: z.string().trim().min(1, "Write a note").max(4000),
  author: optText(120),
});

export const convertLeadInput = z
  .strictObject({
    projectName: z.string().trim().min(1, "Project name is required").max(200),
    targetStart: dateOrNull,
    targetHandover: dateOrNull,
    projectOwner: optText(120),
    nextStage: z.enum(PROJECT_STAGES).default("SITE_VISIT"),
    /** Sent only when the lead has no full address yet. */
    address: z.strictObject(requiredAddress).nullable().default(null),
  })
  .refine((d) => !d.targetStart || !d.targetHandover || d.targetHandover >= d.targetStart, {
    error: "Target handover must be after the target start",
    path: ["targetHandover"],
  });
export type ConvertLeadInput = z.infer<typeof convertLeadInput>;

export const leadListQuery = z.strictObject({
  view: z.enum(["open", "converted", "all"]).default("open"),
  q: z.string().trim().max(100).default(""),
  source: z.string().trim().max(60).optional(),
  status: z.enum(LEAD_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
});
```

`schemas/projects.ts`:
```ts
import { z } from "zod";
import { PERFORMED_BY, PROJECT_STAGES } from "../enums";
import { ASSIGNABLE_ROLES } from "../permissions";
import { dateOrNull, objectId, optText, qty, requiredAddress, sen, uploadRef } from "./common";

export const projectUpdateInput = z
  .strictObject({
    name: z.string().trim().min(1, "Project name is required").max(200),
    clientName: z.string().trim().min(1, "Client name is required").max(200),
    clientPhone: optText(40),
    clientEmail: z.email({ error: "Enter a valid email" }).nullable().default(null),
    ...requiredAddress,
    propertyType: optText(),
    builtUpArea: optText(60),
    budgetMin: sen.nullable().default(null),
    budgetMax: sen.nullable().default(null),
    pmName: optText(120),
    siteName: optText(120),
    targetStart: dateOrNull,
    targetHandover: dateOrNull,
    stage: z.enum(PROJECT_STAGES),
    cancelReason: optText(500),
    /** A new photo, "remove", or null to keep the current one. */
    photo: z.union([uploadRef, z.literal("remove")]).nullable().default(null),
  })
  .refine((d) => !d.targetStart || !d.targetHandover || d.targetHandover >= d.targetStart, {
    error: "Target handover must be after the site start",
    path: ["targetHandover"],
  })
  .refine((d) => d.budgetMin == null || d.budgetMax == null || d.budgetMax > d.budgetMin, {
    error: "Max budget must be greater than min budget",
    path: ["budgetMax"],
  });
export type ProjectUpdateInput = z.infer<typeof projectUpdateInput>;

export const assigneesInput = z.strictObject({
  assignees: z.array(z.strictObject({ userId: objectId, role: z.enum(ASSIGNABLE_ROLES) })).max(50),
});

export const workItemInput = z.strictObject({
  name: z.string().trim().min(1, "Work item name is required").max(120),
  description: optText(1000),
});

const materialInput = z.strictObject({
  name: z.string().trim().min(1, "Every material needs a name").max(120),
  qty,
  unit: z.string().trim().max(20).default("nos"),
  unitCost: z.int({ error: "Every material needs a quantity and a unit cost" }).positive("Every material needs a quantity and a unit cost"),
});

export const bomItemInput = z.strictObject({
  workItemId: z.string().regex(/^[a-f\d]{24}$/i, "Choose the work item this line belongs to"),
  workPackage: z.string().trim().min(1, "Job name is required").max(200),
  description: optText(1000),
  unit: z.string().trim().min(1, "Choose what the quantity is measured in").max(20),
  qty,
  unitCost: sen,
  performedBy: z.enum(PERFORMED_BY),
  materials: z.array(materialInput).max(100).default([]),
});
export type BomItemInput = z.infer<typeof bomItemInput>;
```

`schemas/vendors.ts`:
```ts
import { z } from "zod";
import { optText } from "./common";

export const vendorInput = z.strictObject({
  name: z.string().trim().min(1, "Vendor name is required").max(120),
  type: optText(200),
  registrationNo: optText(60),
  contactPerson: optText(120),
  phone: optText(40),
  email: z.email({ error: "Enter a valid email" }).nullable().default(null),
  location: optText(120),
  experienceYears: z.int().min(0).max(100).nullable().default(null),
  notes: optText(4000),
});
export type VendorInput = z.infer<typeof vendorInput>;

export const vendorActiveInput = z.strictObject({ active: z.boolean() });

export const vendorListQuery = z.strictObject({
  q: z.string().trim().max(100).default(""),
  trade: z.string().trim().max(60).optional(),
  status: z.enum(["active", "inactive"]).optional(),
});
```

`schemas/procurement.ts`:
```ts
import { z } from "zod";
import { dateOrNull, objectId, optText, uploadRef } from "./common";

const sumIs100 = (rows: { pct: number }[], ctx: z.RefinementCtx) => {
  const sum = rows.reduce((s, r) => s + r.pct, 0);
  if (sum !== 100) ctx.addIssue({ code: "custom", message: `Payment terms add up to ${sum}%. They must total 100%.` });
};

const termPct = (label: string) => z.int({ error: `${label} needs a percentage between 1 and 100` }).min(1, `${label} needs a percentage between 1 and 100`).max(100, `${label} needs a percentage between 1 and 100`);

export const poTerms = z
  .array(z.strictObject({ label: z.string().trim().min(1, "Every payment term needs a name").max(120), pct: termPct("Each term") }))
  .min(1, "Add at least one payment term")
  .max(20)
  .superRefine(sumIs100);

export const requestQuotesInput = z.strictObject({
  vendorIds: z.array(objectId).min(1, "Pick at least one vendor").max(20),
  respondBy: dateOrNull,
  note: optText(1000),
});

const nonNeg = z.int().min(0, "Lead time and warranty cannot be negative").max(3650).default(0);

export const quoteInput = z.strictObject({
  quotedPrice: z.int({ error: "Enter the quoted price" }).positive("Enter the quoted price"),
  leadTimeDays: nonNeg,
  warrantyMonths: nonNeg,
  notes: optText(4000),
  file: uploadRef.nullable().default(null),
});
export type QuoteInput = z.infer<typeof quoteInput>;

export const acceptQuoteInput = z.strictObject({ terms: poTerms, deliveryBy: dateOrNull, remarks: optText(2000) });
export const poTermsInput = z.strictObject({ terms: poTerms });

export const vendorInvoiceInput = z.strictObject({
  invoiceNo: z.string().trim().min(1, "Enter the vendor's invoice number").max(60),
  invoiceDate: dateOrNull,
  file: uploadRef.nullable().default(null),
});

export const vendorPaymentInput = z.strictObject({
  paidAmount: z.int({ error: "Enter the amount paid" }).positive("Enter the amount paid"),
  paidDate: dateOrNull,
  method: z.string().trim().max(40).default("Bank Transfer"),
  bankRef: optText(80),
  paidFrom: optText(80),
});

export { sumIs100 };
```

`schemas/quotations.ts`:
```ts
import { z } from "zod";
import { optText } from "./common";
import { sumIs100 } from "./procurement";

export const clientTerms = z
  .array(
    z.strictObject({
      name: z.string().trim().min(1, "Every payment term needs a name").max(120),
      trigger: z.string().trim().max(200).transform((v) => v || "-"),
      pct: z.int({ error: "Each term needs a percentage between 1 and 100" }).min(1, "Each term needs a percentage between 1 and 100").max(100, "Each term needs a percentage between 1 and 100"),
    }),
  )
  .min(1, "Add at least one payment term")
  .max(20)
  .superRefine(sumIs100);

export const buildQuotationInput = z.strictObject({
  markupPct: z.int({ error: "Enter a markup of 0% or more" }).min(0, "Enter a markup of 0% or more").max(500, "Enter a markup between 0% and 500%"),
});
export const markupInput = z.strictObject({
  markupPct: z.int({ error: "Enter a markup between 0% and 500%" }).min(0, "Enter a markup between 0% and 500%").max(500, "Enter a markup between 0% and 500%"),
});
export const termsInput = z.strictObject({ terms: clientTerms });
export const clientQuestionInput = z.strictObject({ comment: z.string().trim().min(3, "Write what the client asked or commented").max(4000) });
export const replyInput = z.strictObject({ reply: z.string().trim().min(3, "Write the reply you gave the client").max(4000) });
export const clientSignedInput = z.strictObject({ signedBy: optText(120) });
```

`schemas/variations.ts`:
```ts
import { z } from "zod";
import { objectId, optText, uploadRef } from "./common";

export const voInput = z.strictObject({
  title: z.string().trim().min(1, "Give the variation a short title").max(200),
  description: z.string().trim().min(1, "Describe the additional work").max(4000),
  reason: optText(120),
  raisedBy: optText(120),
  amount: z.int({ error: "Enter the additional cost" }).positive("Enter the additional cost"),
  bomItemId: objectId.nullable().default(null),
  programmeImpact: optText(500),
  file: uploadRef.nullable().default(null),
});
export type VoInput = z.infer<typeof voInput>;
```

`schemas/billing.ts`:
```ts
import { z } from "zod";
import { clientTerms } from "./quotations";

export const scheduleInput = z.strictObject({ terms: clientTerms });
```

`schemas/files.ts`:
```ts
import { z } from "zod";
import { MAX_UPLOAD_BYTES, UPLOAD_PURPOSES } from "../enums";
import { uploadRef } from "./common";

export const presignInput = z.strictObject({
  purpose: z.enum(UPLOAD_PURPOSES),
  filename: z.string().trim().min(1).max(200),
  contentType: z.string().trim().max(120),
  size: z.int().positive("The file is empty").max(MAX_UPLOAD_BYTES, "File is larger than 10 MB"),
});
export type PresignInput = z.infer<typeof presignInput>;

export const projectFilesInput = z.strictObject({ files: z.array(uploadRef).min(1, "Choose at least one file").max(20) });
```

`schemas/org.ts`:
```ts
import { z } from "zod";
import { ROLES } from "../permissions";
import { optText, uploadRef } from "./common";

export const createOrgInput = z.strictObject({ companyName: z.string().trim().min(2, "Enter your company name").max(160) });

export const letterheadInput = z.strictObject({
  companyName: z.string().trim().min(1, "Company name is required").max(160),
  companyReg: z.string().trim().max(160).default(""),
  companyAddress: z.string().trim().max(400).default(""),
  companyPhone: z.string().trim().max(60).default(""),
  logo: z.union([uploadRef, z.literal("remove")]).nullable().default(null),
});

export const bankInput = z.strictObject({
  bankName: z.string().trim().min(1, "Bank name is required").max(120),
  bankAccountName: z.string().trim().max(160).default(""),
  bankAccount: z.string().trim().min(1, "Account number is required").max(40),
  swiftCode: optText(20),
});

export const pricingInput = z.strictObject({
  defaultMarkupPct: z.int({ error: "Enter a default markup of 0% or more" }).min(0, "Enter a default markup of 0% or more").max(500),
  minMarkupPct: z.int({ error: "Enter a minimum markup of 0% or more" }).min(0, "Enter a minimum markup of 0% or more").max(500),
});

export const taxInput = z.strictObject({ sstBps: z.int().min(0).max(2000) });

export const inviteInput = z.strictObject({ email: z.email({ error: "Enter a valid email" }).transform((e) => e.toLowerCase()), role: z.enum(ROLES) });
export const roleInput = z.strictObject({ role: z.enum(ROLES) });
export const acceptInviteInput = z.strictObject({ token: z.string().min(20).max(200) });

export const searchQuery = z.strictObject({ q: z.string().trim().min(2, "Type at least 2 characters").max(100) });

export const documentEmailInput = z.strictObject({ to: z.email({ error: "Enter a valid email" }), message: optText(2000) });
export const documentShareInput = z.strictObject({ phone: optText(30) });
```

`schemas/index.ts`:
```ts
export * from "./common";
export * from "./leads";
export * from "./projects";
export * from "./vendors";
export * from "./procurement";
export * from "./quotations";
export * from "./variations";
export * from "./billing";
export * from "./files";
export * from "./org";
```

⚠ Verify: in Zod 4, `z.int()`, `z.email()`, `z.strictObject()`, `{ error: "…" }` params and string messages on `.min()` behave as written. If an issue message comes out as Zod's default text, check the installed version's error-customization guide.

- [x] **Step 5: Run the tests**

Run: `pnpm --filter @veenix/shared test`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): Zod input schemas with the app's messages"
```

---

### Task 2.6: DTO types and the package index

**Files:**
- Create: `packages/shared/src/dto.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces the response shapes the API returns and the web components read. Field names copy the Prisma models, so components keep compiling. Dates are `Date` (the web client turns ISO strings back into dates) and ids are `string`.

- [x] **Step 1: Write `packages/shared/src/dto.ts`**

```ts
import type { AttentionItem } from "./attention";
import type { BomCost, Readiness } from "./bom";
import type {
  InvoiceStatus, LeadStatus, MilestoneStatus, PerformedBy, PoMilestoneStatus, PoStatus,
  ProjectStage, QuotationStatus, VoStatus,
} from "./enums";
import type { Sen } from "./money";
import type { Role } from "./permissions";
import type { QuotationTotals } from "./quotation";

export type Id = string;

// ---- Leads -------------------------------------------------------------------
export interface LeadActivityDto { id: Id; note: string; author: string; authorId: Id | null; createdAt: Date }
export interface LeadDto {
  id: Id; code: string; name: string; phone: string; email: string | null; source: string; campaign: string | null;
  propertyType: string | null; builtUpArea: string | null; budgetMin: Sen | null; budgetMax: Sen | null;
  addressLine1: string | null; addressLine2: string | null; addressLine3: string | null; postcode: string | null;
  city: string | null; state: string | null; siteAddress: string | null; targetStart: string | null;
  assignedTo: string | null; status: LeadStatus; surveyAt: Date | null; createdAt: Date;
}
export interface LeadDetailDto extends LeadDto { activities: LeadActivityDto[]; project: { id: Id; code: string; name: string } | null }
export interface LeadListDto {
  leads: (LeadDto & { project: { id: Id } | null })[];
  counts: { open: number; converted: number; all: number };
  total: number; page: number; pages: number; pageSize: number;
}

// ---- Vendors -----------------------------------------------------------------
export interface VendorDto {
  id: Id; name: string; type: string | null; registrationNo: string | null; contactPerson: string | null;
  phone: string | null; email: string | null; location: string | null; experienceYears: number | null;
  active: boolean; jobsCount: number; notes: string | null;
}

// ---- Projects and BOM --------------------------------------------------------
export interface AssigneeDto { userId: Id; role: "project_manager" | "site_staff"; name: string; email: string }
export interface ProjectDto {
  id: Id; code: string; name: string; clientName: string; clientPhone: string | null; clientEmail: string | null;
  addressLine1: string | null; addressLine2: string | null; addressLine3: string | null; postcode: string | null;
  city: string | null; state: string | null; siteAddress: string; propertyType: string | null; builtUpArea: string | null;
  budgetMin: Sen | null; budgetMax: Sen | null; campaign: string | null; surveyAt: Date | null; photoPath: string | null;
  contractValue: Sen; targetStart: Date | null; targetHandover: Date | null; pmName: string | null; siteName: string | null;
  stage: ProjectStage; stageEnteredAt: Date; cancelReason: string | null; createdAt: Date; leadId: Id | null;
  assignees: AssigneeDto[];
}
export interface WorkItemDto { id: Id; seq: number; name: string; description: string | null }
export interface BomMaterialDto { id: Id; name: string; qty: number; unit: string; unitCost: Sen; total: Sen }
export interface BomItemDto {
  id: Id; workItemId: Id | null; seq: number; workPackage: string; description: string | null; qty: number; unit: string;
  unitCost: Sen; estTotal: Sen; performedBy: PerformedBy; materials: BomMaterialDto[]; awarded: { poId: Id; amount: Sen } | null;
}

// ---- Procurement -------------------------------------------------------------
export interface RfqQuoteRevisionDto {
  id: Id; round: number; quotedPrice: Sen; leadTimeDays: number; warrantyMonths: number; notes: string | null;
  attachmentPath: string | null; attachmentName: string | null; receivedAt: Date; createdAt: Date;
}
export interface RfqQuoteDto {
  id: Id; rfqId: Id; vendorId: Id; requestedAt: Date; receivedAt: Date | null; quotedPrice: Sen; leadTimeDays: number;
  warrantyMonths: number; notes: string | null; attachmentPath: string | null; attachmentName: string | null; selected: boolean;
  revisions: RfqQuoteRevisionDto[];
}
export interface RfqDto { id: Id; code: string; projectId: Id; bomItemId: Id; quantity: string; respondBy: Date | null; note: string | null; createdAt: Date }
export interface PoMilestoneDto {
  id: Id; poId: Id; seq: number; label: string; pct: number; amount: Sen; status: PoMilestoneStatus; invoiceNo: string | null;
  invoiceDate: Date | null; invoicePath: string | null; invoiceName: string | null; paidAmount: Sen | null; paidDate: Date | null;
  method: string | null; bankRef: string | null; paidFrom: string | null;
}
export interface PurchaseOrderDto {
  id: Id; code: string; projectId: Id; rfqId: Id | null; vendorId: Id; description: string; qty: string; amount: Sen;
  issueDate: Date; deliveryBy: Date | null; remarks: string | null; status: PoStatus;
}

// ---- Quotations, VOs, billing, files -----------------------------------------
export interface QuotationLineDto {
  id: Id; bomItemId: Id | null; workItemName: string | null; workPackage: string; qty: number; unit: string;
  bomCost: Sen; markupPct: number; clientPrice: Sen; seq: number;
}
export interface QuotationTermDto { id: Id; seq: number; name: string; trigger: string; pct: number }
export interface QuotationEventDto { id: Id; type: string; note: string | null; createdAt: Date }
export interface QuotationDto {
  id: Id; code: string; revision: number; projectId: Id; status: QuotationStatus; createdAt: Date; sentAt: Date | null;
  viewedAt: Date | null; acceptedAt: Date | null; signedBy: string | null;
}
export interface VariationOrderDto {
  id: Id; code: string; projectId: Id; title: string | null; description: string; reason: string | null; raisedBy: string | null;
  amount: Sen; status: VoStatus; raisedAt: Date; bomItemId: Id | null; programmeImpact: string | null;
  attachmentPath: string | null; attachmentName: string | null;
}
export interface PaymentMilestoneDto { id: Id; projectId: Id; seq: number; name: string; trigger: string; pct: number | null; amount: Sen; status: MilestoneStatus }
export interface InvoiceDto {
  id: Id; code: string; milestoneId: Id; invoiceDate: Date; dueDate: Date | null; amount: Sen; sstAmount: Sen; status: InvoiceStatus;
  eInvoiceStatus: "NOT_SUBMITTED" | "SUBMITTED" | "VALID" | "INVALID" | "CANCELLED";
  eInvoiceUuid: string | null; eInvoiceValidatedAt: Date | null;
}
export interface ProjectFileDto { id: Id; projectId: Id; name: string; path: string; size: number; contentType: string; createdAt: Date }

// ---- Composites --------------------------------------------------------------
/** The project page payload, without the computed fields. Pure functions (attention, procurement) take this. */
export interface ProjectCore extends ProjectDto {
  workItems: WorkItemDto[];
  bomItems: BomItemDto[];
  rfqs: (RfqDto & { bomItem: BomItemDto; quotes: (RfqQuoteDto & { vendor: VendorDto })[] })[];
  purchaseOrders: (PurchaseOrderDto & { vendor: VendorDto; rfq: RfqDto | null; milestones: PoMilestoneDto[] })[];
  quotations: (QuotationDto & { lineItems: QuotationLineDto[]; events: QuotationEventDto[]; terms: QuotationTermDto[]; totals: QuotationTotals; termAmounts: Sen[] })[];
  variationOrders: (VariationOrderDto & { bomItem: BomItemDto | null })[];
  milestones: (PaymentMilestoneDto & { invoice: InvoiceDto | null })[];
  files: ProjectFileDto[];
}
/** GET /v1/projects/:id */
export interface ProjectDetailDto extends ProjectCore {
  costs: Record<Id, BomCost>;
  readiness: Readiness;
  attention: AttentionItem[];
  pricing: { defaultMarkupPct: number; minMarkupPct: number; sstBps: number };
}
/** GET /v1/projects */
export type ProjectListItemDto = ProjectDto & { milestones: PaymentMilestoneDto[]; purchaseOrders: PurchaseOrderDto[] };

/** GET /v1/vendors */
export interface VendorListDto { vendors: (VendorDto & { purchaseOrders: PurchaseOrderDto[] })[]; trades: string[] }
/** GET /v1/vendors/:id */
export interface VendorDetailDto extends VendorDto {
  purchaseOrders: (PurchaseOrderDto & { project: ProjectDto; rfq: (RfqDto & { bomItem: BomItemDto | null }) | null; milestones: PoMilestoneDto[] })[];
  rfqQuotes: (RfqQuoteDto & { rfq: RfqDto & { project: ProjectDto; bomItem: BomItemDto | null } })[];
}

// ---- Organization, members, me -----------------------------------------------
export interface OrgDto {
  id: Id; companyName: string; companyReg: string; companyAddress: string; companyPhone: string; logoPath: string | null;
  bankName: string; bankAccountName: string; bankAccount: string; swiftCode: string | null;
  defaultMarkupPct: number; minMarkupPct: number; sstBps: number;
}
export interface MeDto {
  user: { id: Id; name: string; email: string; platformRole: "superadmin" | null };
  memberships: { orgId: Id; companyName: string; role: Role }[];
}
export interface MemberDto { id: Id; userId: Id; name: string; email: string; role: Role; createdAt: Date }
export interface InvitationDto { id: Id; email: string; role: Role; expiresAt: Date; createdAt: Date }

// ---- Dashboard, reports, search ----------------------------------------------
export interface DashboardRowDto {
  key: string; priority: "high" | "medium" | "low"; name: string; sub: string; place: string | null;
  title: string; text: string; status: string;
  target: { kind: "project"; id: Id; tab: string } | { kind: "lead"; id: Id };
}
export interface DashboardDto {
  userName: string;
  kpis: {
    openLeads: number; newLeads7d: number; activeProjects: number; newProjects7d: number;
    contractValue: Sen; signedLast30d: Sen; collected: Sen; collectedPct: number; quotedLeads: number; completedProjects: number;
  };
  leadCounts: Record<LeadStatus, number>;
  rows: DashboardRowDto[];
}
export interface SearchResultDto { kind: "lead" | "project" | "vendor" | "quotation" | "po" | "invoice"; refId: Id; projectId: Id | null; title: string; subtitle: string }
```

- [x] **Step 2: Write `packages/shared/src/index.ts`**

```ts
export * from "./money";
export * from "./time";
export * from "./format";
export * from "./enums";
export * from "./address";
export * from "./payment-terms";
export * from "./permissions";
export * from "./bom";
export * from "./quotation";
export * from "./procurement";
export * from "./attention";
export * from "./dto";
export * from "./schemas";
```

- [x] **Step 3: Build, type-check and test**

Run: `pnpm --filter @veenix/shared build && pnpm --filter @veenix/shared test`
Expected: the build exits 0 with no errors, and all tests PASS.

- [x] **Step 4: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): DTO types and package index"
```
