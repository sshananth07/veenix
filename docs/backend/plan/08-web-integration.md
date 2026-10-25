# 08: Web integration

> For whoever implements this (you or Claude): work task by task and tick each one off in [../README.md](../README.md).

**Goal:** the Next.js app reads and writes only through the API, with as few component edits as possible. Then Prisma is removed.

**Architecture:**
- **Calls:** server components call `api<T>()`; server actions call `apiAction()` and keep their signatures and `ActionResult`, so the dialogs and buttons don't change.
- **Imports:** the files in `lib/` become one-line re-exports of `@veenix/shared`, so component imports don't change either.
- **Files:** uploads go from the browser straight to storage. Download and PDF URLs keep their current paths and proxy to the API.

**Tech stack:** Next.js 14 App Router, `@veenix/shared`, EventSource.

**Spec:** [../spec.md](../spec.md) §4, §8, §11, §12.

## Global constraints
- Server actions keep their exported names and parameters. Exception: `logLeadActivity` drops its `author` argument, because the API stamps the signed-in user.
- Money form fields are typed in ringgit and sent to the API as sen through `parseRinggit()`. Money defaults shown in forms use `senToInput()`.
- The browser never calls the API with cookies; only the SSE stream goes direct, using a ticket.
- `revalidatePath(...)` calls stay where they are.

## Review focus
- **Typing "1,250.50" into a price field:** saves 125050 sen and displays "RM 1,250.50". A value with 3 decimals is refused with "Enter a valid amount, e.g. 1234.50". Tested by hand in Task 8.2.
- **Editing a BOM line:** the dialog shows the stored price in ringgit, not sen. Checked by hand in Task 8.2.
- **A file over 4.5 MB:** uploads (it goes straight to storage). A 10.1 MB file is refused before upload. Checked in Task 8.4.
- **A session that expires while a page is open:** the next action redirects to `/login` instead of showing a raw error.
- **A site staff member opening `/reports`:** the nav doesn't show it, and the page answers "Your role cannot do this".

---

### Task 8.1: API client, `lib/` shims, money and date formatting

**Files:**
- Create: `apps/web/lib/api.ts`
- Modify (replace contents):
  - `apps/web/lib/types.ts`
  - `apps/web/lib/utils.ts`
  - `apps/web/lib/quotation.ts`
  - `apps/web/lib/bom-math.ts`
  - `apps/web/lib/attention.ts`
  - `apps/web/lib/procurement.ts`
  - `apps/web/lib/projectQuery.ts`
  - `apps/web/lib/variationOrders.ts`
  - `apps/web/lib/paymentTerms.ts`
  - `apps/web/lib/address.ts`
  - `apps/web/lib/actionResult.ts`

**Interfaces:**
- Consumes: `apiToken`, `requireOrg` (plan 04, Task 4.6).
- Produces:
  - `api<T>(path, { method?, body? }): Promise<T>`: 404 → `notFound()`; 401 → redirect to `/login` (or `/setup-mfa` for `MFA_REQUIRED`)
  - `apiAction(path, init): Promise<ActionResult>`: errors under 500 become `fail(message)`
  - `ApiError`
  - `money(formData, key): number | null`: sen, `null` when blank, `NaN` when invalid
  - `fileRef(formData, field): { key, name } | null`

- [x] **Step 1: Write `apps/web/lib/api.ts`**

```ts
import "server-only";
import { notFound, redirect } from "next/navigation";
import { fail, ok, type ActionResult } from "./actionResult";
import { apiToken, requireOrg } from "./session";

// The API sends dates as ISO strings; the components expect Date objects (as they did with Prisma).
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const revive = (_key: string, v: unknown) => (typeof v === "string" && ISO.test(v) ? new Date(v) : v);

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

type Init = { method?: string; body?: unknown };

async function call(path: string, init: Init = {}) {
  const { orgId } = await requireOrg();
  const res = await fetch(`${process.env.API_URL}/v1${path}`, {
    method: init.method ?? "GET",
    headers: {
      authorization: `Bearer ${await apiToken()}`,
      "x-org-id": orgId,
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });
  const text = await res.text();
  const data = text ? JSON.parse(text, revive) : null;
  if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? "HTTP", data?.error?.message ?? "Something went wrong. Try again.");
  return data;
}

function onAuthError(e: unknown) {
  if (e instanceof ApiError && e.status === 401) redirect(e.code === "MFA_REQUIRED" ? "/setup-mfa" : "/login");
}

/** For server components: data or a Next.js 404/redirect. */
export async function api<T>(path: string, init?: Init): Promise<T> {
  try {
    return (await call(path, init)) as T;
  } catch (e) {
    onAuthError(e);
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
}

/** For server actions: the API's message becomes the dialog's error. */
export async function apiAction(path: string, init: Init): Promise<ActionResult> {
  try {
    await call(path, init);
    return ok();
  } catch (e) {
    onAuthError(e);
    if (e instanceof ApiError && e.status < 500) return fail(e.message);
    throw e;
  }
}
```

- [x] **Step 2: Turn `lib/` into re-exports**

| File | New contents |
|---|---|
| `lib/types.ts` | `export * from "@veenix/shared";` |
| `lib/quotation.ts` | `export { groupByWorkItem, unitPrice, markupToMarginPct, quotationTotals } from "@veenix/shared";` |
| `lib/bom-math.ts` | `export { calcBomTotal } from "@veenix/shared";` |
| `lib/attention.ts` | `export { getAttention, PRIORITY_ORDER, type AttentionItem, type Priority } from "@veenix/shared";` |
| `lib/procurement.ts` | `export { getPackages, getPackageStage, type PackageStage } from "@veenix/shared";` |
| `lib/variationOrders.ts` | `export { VO_REASONS } from "@veenix/shared";` |
| `lib/projectQuery.ts` | keep `PROJECT_TABS` and `ProjectTabKey`; replace the Prisma include with `export type { ProjectDetailDto as ProjectDetail } from "@veenix/shared";` |
| `lib/utils.ts` | keep `cn` and `initials`; replace the rest with `export { formatCurrency, formatMoney2, formatNumber, formatBudget, formatDate, formatDateTime, toDateInput, daysBetween } from "@veenix/shared";` |
| `lib/paymentTerms.ts` | `export { TERM_TEMPLATES, allocate, type TermRow } from "@veenix/shared";` plus `parseTermRows(formData)` kept, but returning `{ ok: true, rows }` without the sum checks (the API validates) |
| `lib/address.ts` | `export { MY_STATES, addressLines, composeAddress, hasStructuredAddress, isPostcode, type AddressParts } from "@veenix/shared";` plus `parseAddress(formData)` kept, returning only the trimmed `parts` (the API validates) |

- [x] **Step 3: Add `money` and `fileRef` to `lib/actionResult.ts`**

```ts
import { parseRinggit } from "@veenix/shared";

/** A ringgit form field as sen: null when blank, NaN when not a valid amount. */
export function money(formData: FormData, key: string): number | null {
  const raw = str(formData, key);
  if (raw === "") return null;
  return parseRinggit(raw) ?? Number.NaN;
}

export const BAD_AMOUNT = "Enter a valid amount, e.g. 1234.50";

/** A file the browser already uploaded (FormDialog swaps File fields for <field>Key / <field>Name, Task 8.4). */
export function fileRef(formData: FormData, field: string) {
  const key = str(formData, `${field}Key`);
  return key ? { key, name: str(formData, `${field}Name`) || "file" } : null;
}
```

Delete `uniqueCode` from this file; codes come from the API now.

- [x] **Step 4: Show stored money as ringgit in forms**

Find every money default:
```bash
grep -rn "defaultValue={[^}]*\(Price\|Cost\|cost\|amount\|Amount\|budget\|Budget\)" apps/web/components apps/web/app
```
Wrap each value in `senToInput(...)` (import it from `@veenix/shared`). Example: `defaultValue={bom?.unitCost}` becomes `defaultValue={senToInput(bom?.unitCost)}`.

In `components/projects/bom/BomFormDialog.tsx`, the live total preview reads typed ringgit. Convert before calling `calcBomTotal`:
- `unitCost: parseRinggit(unitCostText) ?? 0`
- each material's `unitCost: parseRinggit(m.cost) ?? 0`

- [x] **Step 5: Type-check to find what still needs changing**

Run: `pnpm --filter @veenix/shared build && pnpm --filter web typecheck`

Expected: errors only in `actions/*`, `app/**/page.tsx`, `app/api/documents/*`, `lib/{bom,schedule,settings,uploads,prisma}.ts`, and the `quotationTotals(` calls in `QuotationTab.tsx` and `PaymentsTab.tsx`.

Fix those two components now:
- **`QuotationTab.tsx`:** use `current.totals` instead of `quotationTotals(current.lineItems)`, and `current.termAmounts` instead of `allocate(totals.total, current.terms)`.
- **`PaymentsTab.tsx`:** use `signed.totals.total` for `contractSum`.

The remaining errors are fixed in Tasks 8.2–8.6.

- [x] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): API client, lib re-exports from shared, sen in forms"
```

---

### Task 8.2: Server actions call the API

**Files:**
- Modify: every file in `apps/web/actions/`
- Create: `apps/web/actions/session.ts`, which holds the small actions client components need:
  - `presignUpload(input)` → `{ key, url, contentType }`
  - `liveTicket()` → `string`
  - `searchAction(q)` → `SearchResultDto[]`

**Interfaces:**
- Consumes: `api`, `apiAction`, `money`, `fileRef`, `BAD_AMOUNT` (Task 8.1).
- Produces: the same exported functions as before, with the same parameters.

- [x] **Step 1: Rewrite `actions/leads.ts` (worked example 1: plain fields, a redirect)**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api, apiAction } from "@/lib/api";
import { parseAddress } from "@/lib/address";
import { BAD_AMOUNT, date, fail, money, optStr, str, type ActionResult } from "@/lib/actionResult";

function leadBody(formData: FormData) {
  const budgetMin = money(formData, "budgetMin");
  const budgetMax = money(formData, "budgetMax");
  if (Number.isNaN(budgetMin) || Number.isNaN(budgetMax)) return null;
  return {
    name: str(formData, "name"),
    phone: str(formData, "phone"),
    email: optStr(formData, "email"),
    source: str(formData, "source") || "Other",
    campaign: optStr(formData, "campaign"),
    propertyType: optStr(formData, "propertyType"),
    builtUpArea: optStr(formData, "builtUpArea"),
    budgetMin,
    budgetMax,
    ...parseAddress(formData),
    targetStart: optStr(formData, "targetStart"),
    assignedTo: optStr(formData, "assignedTo"),
    surveyAt: date(formData, "surveyAt"),
    ...(str(formData, "status") ? { status: str(formData, "status") } : {}),
  };
}

export async function createLead(formData: FormData): Promise<ActionResult> {
  const body = leadBody(formData);
  if (!body) return fail(BAD_AMOUNT);
  const r = await apiAction("/leads", { method: "POST", body });
  revalidatePath("/leads");
  return r;
}

export async function updateLead(leadId: string, formData: FormData): Promise<ActionResult> {
  const body = leadBody(formData);
  if (!body) return fail(BAD_AMOUNT);
  const r = await apiAction(`/leads/${leadId}`, { method: "PATCH", body });
  revalidatePath("/leads");
  revalidatePath(`/leads/${leadId}`);
  return r;
}

export async function logLeadActivity(leadId: string, note: string) {
  if (!note.trim()) return;
  await apiAction(`/leads/${leadId}/activities`, { method: "POST", body: { note: note.trim(), author: null } });
  revalidatePath(`/leads/${leadId}`);
}

export async function convertLead(leadId: string, formData: FormData): Promise<ActionResult> {
  let projectId: string;
  try {
    ({ projectId } = await api<{ projectId: string }>(`/leads/${leadId}/convert`, {
      method: "POST",
      body: {
        projectName: str(formData, "projectName"),
        targetStart: date(formData, "targetStart"),
        targetHandover: date(formData, "targetHandover"),
        projectOwner: optStr(formData, "projectOwner"),
        nextStage: str(formData, "nextStage") || "SITE_VISIT",
        address: formData.has("addressLine1") ? parseAddress(formData) : null,
      },
    }));
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Could not convert the lead");
  }
  revalidatePath("/leads");
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/projects");
  redirect(`/projects/${projectId}`);
}
```

`LogActivityForm.tsx` calls `logLeadActivity(leadId, note, author)`. Drop the third argument there.

- [x] **Step 2: Rewrite `actions/bom.ts` (worked example 2: repeated fields to an array)**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { parseRinggit } from "@veenix/shared";
import { apiAction } from "@/lib/api";
import { BAD_AMOUNT, fail, money, optStr, str, type ActionResult } from "@/lib/actionResult";

export async function saveBomItem(projectId: string, bomItemId: string | null, formData: FormData): Promise<ActionResult> {
  const unit = str(formData, "unit");
  const unitCost = money(formData, "unitCost");
  if (unitCost == null || Number.isNaN(unitCost)) return fail(BAD_AMOUNT);
  const performedBy = str(formData, "performedBy") === "SELF" ? "SELF" : "OUTSOURCED";

  const names = formData.getAll("matName").map(String);
  const qtys = formData.getAll("matQty").map(String);
  const units = formData.getAll("matUnit").map(String);
  const costs = formData.getAll("matCost").map(String);
  const materials = performedBy !== "SELF" ? [] : names
    .map((name, i) => ({ name: name.trim(), qty: Number(qtys[i]), unit: (units[i] || "nos").trim(), unitCost: parseRinggit(costs[i] ?? "") ?? Number.NaN }))
    .filter((m, i) => m.name || qtys[i] || costs[i]);
  if (materials.some((m) => Number.isNaN(m.unitCost))) return fail(BAD_AMOUNT);

  const body = {
    workItemId: str(formData, "workItemId"),
    workPackage: str(formData, "workPackage"),
    description: optStr(formData, "description"),
    unit,
    qty: unit === "lot" ? 1 : Number(str(formData, "qty")),
    unitCost,
    performedBy,
    materials,
  };
  const r = bomItemId
    ? await apiAction(`/projects/${projectId}/bom-items/${bomItemId}`, { method: "PUT", body })
    : await apiAction(`/projects/${projectId}/bom-items`, { method: "POST", body });
  revalidatePath(`/projects/${projectId}`);
  return r;
}

export async function deleteBomItem(bomItemId: string): Promise<ActionResult> {
  const r = await apiAction(`/bom-items/${bomItemId}`, { method: "DELETE" });
  revalidatePath("/projects/[id]", "page");
  return r;
}
```

When an action doesn't know the project id, revalidate the route pattern (`revalidatePath("/projects/[id]", "page")`). The live refresh in Task 8.5 updates other open screens.

- [x] **Step 3: Rewrite the rest**

Each action builds its body from the same form fields it reads today, calls the route below, then runs the same `revalidatePath` as before:
- `money()` for amounts, returning `fail(BAD_AMOUNT)` on `NaN`.
- `fileRef(formData, "file" | "photo" | "logo")` for uploads.
- `Number(...)` for whole numbers (markup %, days, months, %).

| Action | Method and route | Body |
|---|---|---|
| `workItems.createWorkItem(projectId, fd)` | `POST /projects/:projectId/work-items` | `{ name, description }` |
| `workItems.updateWorkItem(id, fd)` | `PATCH /work-items/:id` | same |
| `workItems.deleteWorkItem(id)` | `DELETE /work-items/:id` | — |
| `projects.updateProject(id, fd)` | `PATCH /projects/:id` | all fields as today, plus `...parseAddress(fd)`, `budgetMin/Max` via `money`, and `photo: fileRef(fd, "photo") ?? (str(fd, "removePhoto") === "1" ? "remove" : null)` |
| `vendors.createVendor(fd)` / `updateVendor(id, fd)` | `POST /vendors` / `PATCH /vendors/:id` | `{ name, ...vendorFields }`, with `experienceYears` as `Number` or `null` |
| `vendors.setVendorActive(id, active)` | `PUT /vendors/:id/active` | `{ active }` |
| `vendors.requestQuotes(bomItemId, fd)` | `POST /bom-items/:bomItemId/rfq/invites` | `{ vendorIds: fd.getAll("vendorIds"), respondBy, note }` |
| `vendors.removeVendorRequest(quoteId)` | `DELETE /rfq-quotes/:quoteId` | — |
| `vendors.quoteReceived(quoteId, fd)` | `POST /rfq-quotes/:quoteId/received` | `{ quotedPrice: money, leadTimeDays, warrantyMonths, notes, file: fileRef(fd, "file") }` |
| `vendors.reviseQuote(quoteId, fd)` | `POST /rfq-quotes/:quoteId/revisions` | same |
| `vendors.acceptQuote(quoteId, fd)` | `POST /rfq-quotes/:quoteId/accept` | `{ terms: termLabel/termPct pairs as [{ label, pct }], deliveryBy, remarks }` |
| `vendors.setPoTerms(poId, fd)` | `PUT /purchase-orders/:poId/terms` | `{ terms }` |
| `vendors.attachVendorInvoice(milestoneId, fd)` | `POST /po-milestones/:id/invoice` | `{ invoiceNo, invoiceDate, file: fileRef(fd, "file") }` |
| `vendors.recordMilestonePayment(milestoneId, fd)` | `POST /po-milestones/:id/payment` | `{ paidAmount: money, paidDate, method, bankRef, paidFrom }` |
| `quotation.buildQuotation(projectId, fd)` | `POST /projects/:projectId/quotations` | `{ markupPct }` |
| `quotation.createRevision(id)` | `POST /quotations/:id/revisions` | — |
| `quotation.discardDraft(id)` | `DELETE /quotations/:id` | — |
| `quotation.updateLineMarkup(lineId, fd)` | `PATCH /quotation-lines/:lineId` | `{ markupPct }` |
| `quotation.applyMarkupToAll(id, fd)` | `POST /quotations/:id/markup` | `{ markupPct }` |
| `quotation.saveQuotationTerms(id, fd)` | `PUT /quotations/:id/terms` | `{ terms: parseTermRows(fd).rows }` |
| `quotation.sendQuotation(id)` | `POST /quotations/:id/send` | — |
| `quotation.recordClientResponse(id, "VIEWED")` | `POST /quotations/:id/viewed` | — |
| `quotation.recordClientResponse(id, "ACCEPTED", note)` | `POST /quotations/:id/accept` | `{ signedBy: note ?? null }` |
| `quotation.recordClientQuestion(id, fd)` | `POST /quotations/:id/questions` | `{ comment }` |
| `quotation.recordReply(id, fd)` | `POST /quotations/:id/replies` | `{ reply }` |
| `variationOrders.createVariationOrder(projectId, fd)` | `POST /projects/:projectId/variation-orders` | `{ title, description, reason, raisedBy, amount: money, bomItemId, programmeImpact, file: fileRef(fd, "file") }` |
| `variationOrders.sendVariationOrderToClient(id)` | `POST /variation-orders/:id/send` | — |
| `variationOrders.acceptVariationOrder(id)` | `POST /variation-orders/:id/accept` | — |
| `milestoneSchedule.createMilestoneSchedule(projectId, fd)` | `POST /projects/:projectId/payment-schedule` | `{ terms: parseTermRows(fd).rows }` |
| `milestones.generateInvoiceForMilestone(milestoneId)` | `POST /milestones/:id/invoice` | — (returns `invoiceId`, so use `api<{ invoiceId: string }>` and return it) |
| `milestones.markInvoicePaid(invoiceId)` | `POST /invoices/:id/paid` | — |
| `files.uploadProjectFiles(projectId, fd)` | `POST /projects/:projectId/files` | `{ files: fd.getAll("filesKey").map((key, i) => ({ key, name: fd.getAll("filesName")[i] })) }` |
| `files.deleteProjectFile(fileId)` | `DELETE /files/:id` | — |
| `settings.updateLetterhead(fd)` | `PATCH /org/letterhead` | `{ companyName, companyReg, companyAddress, companyPhone, logo: fileRef(fd, "logo") ?? (str(fd, "removeLogo") === "1" ? "remove" : null) }` |
| `settings.updateBankDetails(fd)` | `PATCH /org/bank` | `{ bankName, bankAccountName, bankAccount, swiftCode }` |
| `settings.updateMarkupSettings(fd)` | `PATCH /org/pricing` | `{ defaultMarkupPct, minMarkupPct }` |

Actions that used to `return` nothing (`sendVariationOrderToClient`, `acceptVariationOrder`, `markInvoicePaid`) now return the `ActionResult`, so `ActionButton` can show a refusal. If `ActionButton` ignores return values today, show the message with the same error box `FormDialog` uses.

Write `actions/session.ts`:
```ts
"use server";
import type { PresignInput, SearchResultDto } from "@veenix/shared";
import { api } from "@/lib/api";

export const presignUpload = (input: PresignInput) => api<{ key: string; url: string; contentType: string }>("/uploads", { method: "POST", body: input });
export const liveTicket = async () => (await api<{ ticket: string }>("/live/ticket", { method: "POST" })).ticket;
export const searchAction = (q: string) => (q.trim().length < 2 ? Promise.resolve([] as SearchResultDto[]) : api<SearchResultDto[]>(`/search?q=${encodeURIComponent(q.trim())}`));
```

- [x] **Step 4: Type-check and click through**

Run: `pnpm --filter web typecheck`
Expected: errors only in `app/**/page.tsx` and `app/api/documents/*` (fixed next).

- [x] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): server actions call the API"
```

---

### Task 8.3: Pages read from the API

**Files:**
- Modify: `app/(dashboard)/page.tsx`, `leads/page.tsx`, `leads/[id]/page.tsx`, `projects/page.tsx`, `projects/[id]/page.tsx`, `reports/page.tsx`, `settings/page.tsx`, `vendors/page.tsx`, `vendors/[id]/page.tsx` (all under `apps/web/app/(dashboard)/`)

**Interfaces:**
- Consumes: `api<T>` plus `LeadListDto`, `LeadDetailDto`, `ProjectListItemDto`, `ProjectDetailDto`, `ReportsDto`, `OrgDto`, `VendorListDto`, `VendorDetailDto` and `DashboardDto`.

- [x] **Step 1: Swap each page's queries for one API call**

In each page, delete the Prisma queries and the calculations the API now does. Keep the JSX.

| Page | Replace with | Notes |
|---|---|---|
| `page.tsx` (home) | `const d = await api<DashboardDto>("/dashboard")` | Use `d.kpis.*`, `d.leadCounts[s]` and `d.rows`. `href` is `r.target.kind === "lead" ? \`/leads/${r.target.id}\` : \`/projects/${r.target.id}?tab=${r.target.tab}\``. The greeting uses `d.userName` |
| `leads/page.tsx` | `api<LeadListDto>(\`/leads?${new URLSearchParams(cleanParams)}\`)` | `counts`, `total`, `page` and `pages` come back; `PAGE_SIZE` becomes `d.pageSize` |
| `leads/[id]/page.tsx` | `api<LeadDetailDto>(\`/leads/${params.id}\`)` | |
| `projects/page.tsx` | `api<ProjectListItemDto[]>("/projects")` | |
| `projects/[id]/page.tsx` | `api<ProjectDetailDto>(\`/projects/${params.id}\`)` | `costs`, `readiness` and the settings come from `project.costs`, `project.readiness` and `project.pricing`; delete the `getBomCosts`, `getQuotationReadiness` and `getSettings` calls |
| `reports/page.tsx` | `api<ReportsDto>("/reports")` | Build `kpis`, the source bars, margins and vendor spend from the returned numbers; the presentation code stays |
| `settings/page.tsx` | `api<OrgDto>("/org")` | Pass it as `settings`; the field names match |
| `vendors/page.tsx` | `api<VendorListDto>(\`/vendors?${…}\`)` | |
| `vendors/[id]/page.tsx` | `api<VendorDetailDto>(\`/vendors/${params.id}\`)` | |

- [x] **Step 2: Type-check and run**

Run: `pnpm --filter web typecheck`
Expected: errors only in `app/api/documents/*` and `lib/{bom,schedule,settings,uploads,prisma}.ts` (fixed next).

With the API and web running, after plan 09's migration or with new data, open each page. Expected: the same screens as before, with amounts identical to the old app.

- [x] **Step 3: Commit**

```bash
git add apps/web
git commit -m "feat(web): pages read from the API"
```

---

### Task 8.4: Uploads through presigned URLs, download redirects, PDF proxy

**Files:**
- Create: `apps/web/lib/upload-client.ts`, `apps/web/app/api/uploads/[kind]/[id]/route.ts`, `apps/web/app/api/documents/[type]/[id]/route.ts`
- Delete: `apps/web/app/api/documents/{invoice,po,quotation,rfq,rfqs}/` (the five old routes)
- Modify: `components/FormDialog.tsx` (an `uploadPurpose` prop), `components/projects/FileUploadDropzone.tsx`, the six dialogs with file inputs (pass `uploadPurpose`), `next.config.mjs`

**Interfaces:**
- Produces:
  - `uploadFile(file: File, purpose: UploadPurpose): Promise<{ key: string; name: string }>`
  - `<FormDialog uploadPurpose="quotes" …>`: before calling `action`, every non-empty `File` field `x` is uploaded and replaced by `xKey` and `xName`

- [x] **Step 1: Write `lib/upload-client.ts`**

```ts
"use client";
import { MAX_UPLOAD_BYTES, type UploadPurpose } from "@veenix/shared";
import { presignUpload } from "@/actions/session";

/** Sends the file straight to storage (past Vercel's 4.5 MB request limit) and returns its key for the form. */
export async function uploadFile(file: File, purpose: UploadPurpose) {
  if (file.size > MAX_UPLOAD_BYTES) throw new Error(`"${file.name}" is larger than 10 MB`);
  const { key, url, contentType } = await presignUpload({ purpose, filename: file.name, contentType: file.type, size: file.size });
  const put = await fetch(url, { method: "PUT", body: file, headers: { "content-type": contentType } });
  if (!put.ok) throw new Error(`Could not upload "${file.name}". Try again.`);
  return { key, name: file.name.slice(0, 120) };
}

/** Replaces every File in the form with <field>Key / <field>Name after uploading it. */
export async function uploadFormFiles(formData: FormData, purpose: UploadPurpose) {
  const out = new FormData();
  for (const [field, value] of formData.entries()) {
    if (value instanceof File) {
      if (value.size === 0) continue;
      const { key, name } = await uploadFile(value, purpose);
      out.append(`${field}Key`, key);
      out.append(`${field}Name`, name);
    } else {
      out.append(field, value);
    }
  }
  return out;
}
```

- [x] **Step 2: Upload before submitting in `FormDialog`**

Add the prop `uploadPurpose?: UploadPurpose`. In `run`:

```ts
const run = (formData: FormData) =>
  startTransition(async () => {
    setError(null);
    try {
      const data = uploadPurpose ? await uploadFormFiles(formData, uploadPurpose) : formData;
      const result = await action(data);
      if (result.ok) setOpen(false);
      else setError(result.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not upload the file");
    }
  });
```

Pass `uploadPurpose` where a dialog has a file input:

| Dialog | `uploadPurpose` |
|---|---|
| `VendorDialogs` (quote received, revised quote) | `"quotes"` |
| `VendorDialogs` (vendor invoice) | `"invoices"` |
| `EditProjectDialog` | `"photos"` |
| `NewVoDialog` | `"vo"` |
| `EditLetterheadDialog` | `"logos"` |

In `FileUploadDropzone`, call `uploadFormFiles(formData, "files")` before `uploadProjectFiles(projectId, data)`.

- [x] **Step 3: Write the download redirect** `app/api/uploads/[kind]/[id]/route.ts` (this also fixes the links that are broken today)

```ts
import { api } from "@/lib/api";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: { kind: string; id: string } }) {
  const path = params.kind === "logo" ? "/downloads/logo" : `/downloads/${params.kind}/${params.id}`;
  const { url } = await api<{ url: string }>(path);
  return Response.redirect(url, 302);
}
```

- [x] **Step 4: Write the PDF proxy** `app/api/documents/[type]/[id]/route.ts`

```ts
import { apiToken, requireOrg } from "@/lib/session";

export const runtime = "nodejs";

// Old URL /api/documents/rfqs/<projectId> is the bundle.
const TYPES: Record<string, string> = { quotation: "quotation", invoice: "invoice", po: "po", rfq: "rfq", rfqs: "rfq-bundle" };

export async function GET(req: Request, { params }: { params: { type: string; id: string } }) {
  const type = TYPES[params.type];
  if (!type) return new Response("Not found", { status: 404 });
  const { orgId } = await requireOrg();
  const search = new URL(req.url).search;
  const res = await fetch(`${process.env.API_URL}/v1/documents/${type}/${params.id}/pdf${search}`, {
    headers: { authorization: `Bearer ${await apiToken()}`, "x-org-id": orgId },
    cache: "no-store",
  });
  if (!res.ok) return new Response("Not found", { status: res.status === 404 ? 404 : 502 });
  return new Response(res.body, {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": res.headers.get("content-disposition") ?? "inline" },
  });
}
```

Delete the five old route folders. Change `next.config.mjs` `serverActions.bodySizeLimit` to `"1mb"`.

- [ ] **Step 5: Check by hand** (pending: needs a signed-in session)

- Upload a 6 MB PDF in Files. Expected: it succeeds, and the link opens it.
- Upload a `.pdf` that's really a renamed `.txt`. Expected: `"x.pdf" is not a real PDF file`.
- Open a quotation PDF and an RFQ bundle. Expected: they render as before.

- [x] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): direct uploads to storage, download redirects, single PDF proxy"
```

---

### Task 8.5: Live refresh, global search, team and members screens, sending documents

**Files:**
- Create:
  - `apps/web/components/LiveRefresh.tsx`
  - `apps/web/components/GlobalSearch.tsx`
  - `apps/web/components/projects/TeamDialog.tsx`
  - `apps/web/components/settings/MembersCard.tsx`
  - `apps/web/components/SendDocumentButtons.tsx`
  - `apps/web/actions/team.ts`
- Modify:
  - `app/(dashboard)/projects/[id]/page.tsx` and `app/(dashboard)/page.tsx` (mount `LiveRefresh`)
  - `components/NavBar.tsx` (search; hide nav items by role)
  - `components/projects/ProjectHeader.tsx` (team button)
  - `app/(dashboard)/settings/page.tsx` (members card)
  - `components/projects/QuotationTab.tsx`, `PaymentsTab.tsx` and `VendorsTab.tsx` (send buttons next to the existing PDF links)

**Interfaces:**
- Consumes: `liveTicket`, `searchAction` (Task 8.2); `can`, `MemberDto`, `InvitationDto`, `SearchResultDto`.
- Produces:
  - `<LiveRefresh projectId? />`
  - `<GlobalSearch />`
  - `<TeamDialog project members />`
  - `<MembersCard />`
  - `<SendDocumentButtons type id defaultEmail? defaultPhone? />`
  - in `actions/team.ts`: `setAssignees`, `inviteMember`, `changeMemberRole`, `removeMember`, `revokeInvitation`, `emailDocument`, `shareDocument`

- [ ] **Step 1: Write `components/LiveRefresh.tsx`**

```tsx
"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { liveTicket } from "@/actions/session";

/** Re-renders the page when something it shows changes. Events carry ids only; the refresh refetches through the API. */
export function LiveRefresh({ projectId }: { projectId?: string }) {
  const router = useRouter();
  useEffect(() => {
    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let retry = 1000;
    let stopped = false;

    const connect = async () => {
      if (stopped) return;
      try {
        source = new EventSource(`${process.env.NEXT_PUBLIC_API_URL}/v1/live?ticket=${encodeURIComponent(await liveTicket())}`);
      } catch {
        return void setTimeout(connect, (retry = Math.min(retry * 2, 30_000)));
      }
      source.onopen = () => (retry = 1000);
      source.onmessage = (m) => {
        const e = JSON.parse(m.data) as { projectId?: string };
        if (projectId && e.projectId !== projectId) return;
        clearTimeout(timer);
        timer = setTimeout(() => router.refresh(), 300);
      };
      // The stream ends at the function's time limit; reconnect with a fresh ticket.
      source.onerror = () => {
        source?.close();
        setTimeout(connect, (retry = Math.min(retry * 2, 30_000)));
      };
    };
    void connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      source?.close();
    };
  }, [projectId, router]);
  return null;
}
```

Mount `<LiveRefresh projectId={project.id} />` on the project page and `<LiveRefresh />` on the home page.

- [ ] **Step 2: Write `components/GlobalSearch.tsx`** and put it in place of the dead `<input placeholder="Search..." />` in `NavBar.tsx`

- It's a client component: an `<input>` with the same classes.
- On change, debounce 250 ms, then call `searchAction(q)` and show up to 20 results grouped by `kind` in a dropdown. Esc closes it.
- Result links:

  | Kind | Link |
  |---|---|
  | lead | `/leads/${refId}` |
  | project | `/projects/${refId}` |
  | vendor | `/vendors/${refId}` |
  | quotation | `/projects/${projectId}?tab=quotation` |
  | po | `/projects/${projectId}?tab=vendors` |
  | invoice | `/projects/${projectId}?tab=payments` |

- Empty state: "No matches".

- [ ] **Step 3: Hide nav items the role can't use**

- `NavBar` receives `role` from the layout (`requireOrg()` already returns it).
- Hide: Leads without `lead:read`, Vendors without `vendor:read`, Reports without `report:read`, Settings without `org:manage`.
- This is convenience only; the API enforces everything.

- [ ] **Step 4: Team and members**

`actions/team.ts` (all through `apiAction`):

| Action | Calls |
|---|---|
| `setAssignees(projectId, assignees)` | `PUT /projects/:id/assignees` |
| `inviteMember(fd)` | `POST /org/invitations` `{ email, role }` |
| `changeMemberRole(id, role)` | `PATCH /org/members/:id` |
| `removeMember(id)` | `DELETE /org/members/:id` |
| `revokeInvitation(id)` | `DELETE /org/invitations/:id` |
| `emailDocument(type, id, fd)` | `POST /documents/:type/:id/email` `{ to, message }` |
| `shareDocument(type, id, phone)` | `api<{ whatsappUrl: string }>` on `/documents/:type/:id/share`, then return the `whatsappUrl` |

- **`TeamDialog`** (`FormDialog` presentation): checkboxes for members whose role is `project_manager` or `site_staff`, pre-ticked from `project.assignees`. Render the "Team" button in `ProjectHeader` only when the role has `project:assign`. The project page loads `api<MemberDto[]>("/org/members")` only for those roles.
- **`MembersCard`** (settings page, only with `member:manage`): a members table with a role `<Select>` and Remove; an "Invite" form (email + role); pending invitations with Revoke. Data comes from `api<MemberDto[]>("/org/members")` and `api<InvitationDto[]>("/org/invitations")`.
- **`SendDocumentButtons`**:
  - "Email" opens a `FormDialog` with To (default the client's email) and a message.
  - "WhatsApp" calls `shareDocument` and does `window.open(whatsappUrl, "_blank")`.
  - Put it next to each existing "PDF" link: the quotation (`quotation`, `q.id`), each invoice (`invoice`, `inv.id`), each PO (`po`, `po.id`), and each RFQ (`rfq`, `rfq.id`).

- [ ] **Step 5: Check by hand**

1. Open the same project in two browsers as two users. Accept a vendor quote in one. Expected: the other updates within about 1 s.
2. Search "wawsan". Expected: Wawasan results.
3. Invite a project manager. Expected: the email arrives in Mailpit.
4. Sign up as that user, accept, and assign them to one project. Expected: they see only that project, and no Leads or Settings in the nav.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): live refresh, fuzzy search, team assignment, members, send documents"
```

---

### Task 8.6: Remove Prisma

**Files:**
- Delete: `apps/web/lib/prisma.ts`, `lib/bom.ts`, `lib/schedule.ts`, `lib/settings.ts`, `lib/uploads.ts`, `apps/web/prisma/schema.prisma`, `prisma/migrations/`, `prisma/seed.ts`
- Keep for now: `apps/web/prisma/dev.db` and `apps/web/uploads/`; plan 09 reads them
- Modify: `apps/web/package.json`, `apps/web/.env`, `apps/web/START-HERE.md`

- [ ] **Step 1: Delete and uninstall**

```bash
cd apps/web
git rm -r lib/prisma.ts lib/bom.ts lib/schedule.ts lib/settings.ts lib/uploads.ts prisma/schema.prisma prisma/migrations prisma/seed.ts
pnpm remove @prisma/client prisma tsx
cd ../..
```

In `apps/web/package.json`:
- Remove the `prisma` block and the `prisma:*` scripts.
- Change `build` to `next build`.

Remove `DATABASE_URL` from `apps/web/.env`.

- [ ] **Step 2: Check nothing still uses them**

Run: `grep -rn "prisma\|@/lib/settings\|@/lib/bom\"\|@/lib/uploads\|@/lib/schedule" apps/web --include=*.ts --include=*.tsx`
Expected: no output.

Run: `pnpm check`
Expected: the shared build, every type-check and every test pass.

- [ ] **Step 3: Update `apps/web/START-HERE.md`**

Replace sections 1–3 with:
```
1. Install Node 24, pnpm 10 and Docker Desktop.
2. pnpm install
3. pnpm services:up
4. pnpm --filter api storage:init && pnpm --filter api db:indexes
5. pnpm dev   (web on http://localhost:3100, API on http://localhost:4000)
6. Sign up at http://localhost:3100/signup. Emails arrive at http://localhost:8025.
```
Update section 5's "not finished" list: login and accounts exist now, and the uploads folder is replaced by storage.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(web): remove Prisma; the API owns all data"
```
