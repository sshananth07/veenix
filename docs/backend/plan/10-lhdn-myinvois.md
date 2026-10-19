# 10: LHDN MyInvois e-invoicing

> For whoever implements this (you or Claude): work task by task and tick each one off in [../README.md](../README.md).

**Goal:** when an organization has e-invoicing on, each generated invoice is submitted to LHDN MyInvois and its validation result (UUID, long id, validated time, or errors) is stored on the invoice. The UI's existing "validated" badge then reflects the real result.

**Architecture:**
- Each organization keeps its own MyInvois credentials and signing certificate, encrypted with AES-256-GCM.
- Generating an invoice enqueues `einvoice.submit`. That job builds the UBL 2.1 JSON document, signs it, submits it, and enqueues `einvoice.poll`. Polling stores the outcome.
- Everything runs against **pre-production** first.

**Tech stack:** `node:crypto` (AES-GCM, SHA-256, signing), `fetch`, the job queue (plan 05), Redis (token cache).

**Spec:** [../spec.md](../spec.md) §16.

## Global constraints
- **Base URLs:**
  - pre-production `https://preprod-api.myinvois.hasil.gov.my`
  - production `https://api.myinvois.hasil.gov.my`
- **Secrets** (`clientSecret`, the certificate and its password) are encrypted at rest and never returned by the API. GET returns `hasClientSecret` / `hasCertificate` flags.
- **Submission is never blocking:** generating an invoice succeeds even if LHDN is down. The job retries with backoff.
- **⚠ Verify first.** The official SDK documentation at `https://sdk.myinvois.hasil.gov.my` is the source of truth for:
  - the document format version (1.1, signed)
  - the field codes
  - the signing steps
  - the endpoint paths and response shapes

  Everything marked ⚠ below must be checked there before coding.

## Review focus
- **LHDN rejects the document:** the invoice shows `INVALID` with LHDN's error text, and staff can fix the data and resubmit (`POST /v1/invoices/:id/einvoice`). Tested with a mocked response in Task 10.2.
- **A ciphertext edited in the database:** decryption fails loudly instead of returning garbage. Tested in Task 10.1.
- **A token that expires mid-batch:** the cached token is refreshed 60 s before expiry. Covered by the cache TTL.
- **An organization without e-invoicing turned on:** no job is enqueued and the invoice stays `NOT_SUBMITTED`.
- **A buyer with no TIN** (most homeowners): uses LHDN's general-public TIN and their identity number. ⚠ Verify the current rule in the SDK.

---

### Task 10.1: Encrypted per-organization e-invoice settings

**Files:**
- Create: `apps/api/src/common/crypto.ts`, `apps/api/src/einvoice/einvoice.settings.ts`
- Modify:
  - `packages/shared/src/schemas/org.ts` (`einvoiceSettingsInput`)
  - `packages/shared/src/schemas/projects.ts` (client tax fields)
  - `apps/api/src/projects/project.model.ts` (`clientTin`, `clientIdType`, `clientIdNo`)
  - `apps/api/src/orgs/settings.controller.ts` (`GET`/`PATCH /v1/org/einvoice`)
- Test: `apps/api/src/common/crypto.test.ts`

**Interfaces:**
- Produces:
  - `encrypt(plain: string): string` (the format `v1.<iv>.<tag>.<ciphertext>`, base64url) and `decrypt(token: string): string`
  - `EinvoiceSettings = { enabled, environment: 'preprod' | 'prod', tin, brn, sstNo, msicCode, businessActivity, clientId, clientSecretEnc, certificateEnc, certificatePasswordEnc }`
  - `einvoiceSettings(): Promise<EinvoiceSettings | null>` (decrypts nothing)
  - `einvoiceSecrets(): Promise<{ clientSecret; certificate: Buffer; certificatePassword }>`
  - routes `GET /v1/org/einvoice` and `PATCH /v1/org/einvoice` (`org:manage`), audit action `org.einvoice_changed`

- [ ] **Step 1: Write the failing test** `src/common/crypto.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "./crypto";

describe("field encryption", () => {
  it("round-trips and never repeats a ciphertext", () => {
    const a = encrypt("client-secret"), b = encrypt("client-secret");
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe("client-secret");
  });
  it("refuses a tampered value", () => {
    const t = encrypt("x").split(".");
    t[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decrypt(t.join("."))).toThrow();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails, then write `src/common/crypto.ts`**

```ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "../config/env";

const KEY = Buffer.from(env.FIELD_ENCRYPTION_KEY, "base64"); // 32 bytes, checked in env.ts

/** AES-256-GCM with a random 96-bit IV. The auth tag makes any tampering fail on decrypt. */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function decrypt(token: string): string {
  const [v, iv, tag, data] = token.split(".");
  if (v !== "v1") throw new Error("Unknown encryption format");
  const decipher = createDecipheriv("aes-256-gcm", KEY, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}
```

Run: `pnpm --filter api test crypto`
Expected: PASS.

- [ ] **Step 3: Settings input, storage and routes**

Add to `schemas/org.ts`:
```ts
export const einvoiceSettingsInput = z.strictObject({
  enabled: z.boolean(),
  environment: z.enum(["preprod", "prod"]).default("preprod"),
  tin: z.string().trim().min(1, "Enter your company's TIN").max(20),
  brn: z.string().trim().min(1, "Enter your business registration number").max(30),
  sstNo: optText(30),
  msicCode: z.string().trim().regex(/^\d{5}$/, "MSIC code is 5 digits"),
  businessActivity: z.string().trim().min(1).max(300),
  clientId: z.string().trim().min(1).max(100),
  /** Omit to keep the stored value. */
  clientSecret: z.string().min(1).max(500).optional(),
  certificateBase64: z.string().min(1).max(20_000).optional(), // the .p12 file, base64
  certificatePassword: z.string().min(1).max(200).optional(),
});
```

Add to `projectUpdateInput`:
```ts
clientTin: optText(20),
clientIdType: z.enum(["NRIC", "PASSPORT", "BRN", "ARMY"]).nullable().default(null),
clientIdNo: optText(30),
```
Add `clientTin: text(), clientIdType: text(), clientIdNo: text()` to the project schema, and the same three fields to `ProjectDto`. Add the three inputs to `EditProjectDialog` (a "Client tax details (for e-invoices)" section) and to `updateProject`'s body.

`src/einvoice/einvoice.settings.ts`:
- `einvoiceSettings()` reads `loadOrg().einvoice`.
- `saveEinvoiceSettings(input)` `$set`s `einvoice` with each secret run through `encrypt()` when present, keeping the stored one when omitted, and calls `audit("org.einvoice_changed", "organization", orgId, { enabled, environment })`.
- `einvoiceSecrets()` decrypts them.

The `GET` route returns everything except the `*Enc` fields, plus `hasClientSecret` and `hasCertificate`.

- [ ] **Step 4: Commit**

```bash
git add apps/api packages/shared apps/web
git commit -m "feat(einvoice): encrypted per-organization MyInvois settings and buyer tax fields"
```

---

### Task 10.2: MyInvois client, submission and polling (pre-production)

**Files:**
- Create: `apps/api/src/einvoice/myinvois.ts`, `apps/api/src/einvoice/ubl.ts`, `apps/api/src/einvoice/sign.ts`, `apps/api/src/einvoice/einvoice.jobs.ts`
- Modify: `apps/api/src/billing/billing.service.ts` (enqueue), `apps/api/src/billing/billing.controller.ts` (resubmit), `apps/api/src/app.module.ts` (import `./einvoice/einvoice.jobs`)
- Test: `apps/api/src/einvoice/einvoice.test.ts`

**Interfaces:**
- Produces:
  - `token(settings, secrets): Promise<string>` (cached in Redis as `myinvois:token:<orgId>`)
  - `submit(settings, token, doc: { json: string; hash: string; codeNumber: string }): Promise<{ submissionUid: string; uuid: string | null; rejected?: unknown }>`
  - `getSubmission(settings, token, uid): Promise<{ status: 'InProgress' | 'Valid' | 'Invalid' | 'Partially Valid'; documents: { uuid; status; longId?; dateTimeValidated? }[] }>`
  - `documentDetails(settings, token, uuid): Promise<{ validationResults?: unknown }>`
  - `buildInvoiceDocument(input): object` (UBL JSON)
  - `signDocument(doc, cert): object`
  - job handlers `einvoice.submit` and `einvoice.poll`
  - the route `POST /v1/invoices/:id/einvoice` (`einvoice:submit`): resubmit after fixing data

- [ ] **Step 1: Write `src/einvoice/myinvois.ts`** ⚠ Verify each path and field name against the SDK "API" section.

```ts
import { redis } from "../common/redis";
import { ctx } from "../common/context";
import type { EinvoiceSettings } from "./einvoice.settings";

const BASE = { preprod: "https://preprod-api.myinvois.hasil.gov.my", prod: "https://api.myinvois.hasil.gov.my" } as const;

async function json(res: Response) {
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`MyInvois ${res.status}: ${text.slice(0, 500)}`);
  return body;
}

/** OAuth client-credentials token, cached until 60 s before it expires. */
export async function token(s: EinvoiceSettings, secrets: { clientSecret: string }): Promise<string> {
  const cacheKey = `myinvois:token:${ctx().orgId}`;
  const cached = await redis.get(cacheKey);
  if (cached) return cached;
  const body = await json(await fetch(`${BASE[s.environment]}/connect/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: s.clientId, client_secret: secrets.clientSecret, grant_type: "client_credentials", scope: "InvoicingAPI" }),
  }));
  await redis.set(cacheKey, body.access_token, "EX", Math.max(60, Number(body.expires_in) - 60));
  return body.access_token;
}

export async function submit(s: EinvoiceSettings, accessToken: string, doc: { json: string; hash: string; codeNumber: string }) {
  const body = await json(await fetch(`${BASE[s.environment]}/api/v1.0/documentsubmissions/`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ documents: [{ format: "JSON", document: Buffer.from(doc.json).toString("base64"), documentHash: doc.hash, codeNumber: doc.codeNumber }] }),
  }));
  return { submissionUid: body.submissionUid as string, uuid: (body.acceptedDocuments?.[0]?.uuid as string) ?? null, rejected: body.rejectedDocuments?.[0] };
}

export async function getSubmission(s: EinvoiceSettings, accessToken: string, uid: string) {
  const body = await json(await fetch(`${BASE[s.environment]}/api/v1.0/documentsubmissions/${uid}`, { headers: { authorization: `Bearer ${accessToken}` } }));
  return { status: body.overallStatus, documents: body.documentSummary ?? [] } as {
    status: "InProgress" | "Valid" | "Invalid" | "Partially Valid";
    documents: { uuid: string; status: string; longId?: string; dateTimeValidated?: string }[];
  };
}

export async function documentDetails(s: EinvoiceSettings, accessToken: string, uuid: string) {
  return json(await fetch(`${BASE[s.environment]}/api/v1.0/documents/${uuid}/details`, { headers: { authorization: `Bearer ${accessToken}` } }));
}
```

- [ ] **Step 2: Write `src/einvoice/ubl.ts`**

`buildInvoiceDocument({ invoice, org, settings, project, milestoneName })` returns the UBL 2.1 JSON invoice. Build it from this mapping and the SDK's "Invoice v1.1" JSON sample. ⚠ Copy the sample's exact structure (`_D`, `_A`, `_B` namespaces, `Invoice: [ { … } ]` arrays).

| UBL element | Value |
|---|---|
| `ID` | `invoice.code` |
| `IssueDate` / `IssueTime` | `invoice.invoiceDate` in **UTC** (`YYYY-MM-DD`, `HH:mm:ssZ`) |
| `InvoiceTypeCode` (`listVersionID: "1.1"`) | `"01"` (invoice) |
| `DocumentCurrencyCode` | `"MYR"` |
| Supplier party | `settings.tin` (TIN), `settings.brn` (BRN), `settings.sstNo` (SST, or `"NA"`), `settings.msicCode` and `settings.businessActivity`, `org.companyName`, `org.companyAddress`, `org.companyPhone` |
| Buyer party | `project.clientTin` (TIN) and its ID type and number. If the TIN is empty, use the general-public TIN from the SDK's "TIN for general public" page with the buyer's NRIC. Plus `project.clientName`, the project address fields (state code from the SDK's state code list), `project.clientPhone`, `project.clientEmail` |
| One `InvoiceLine` | description `` `${project.name}: ${milestoneName}` ``, quantity 1, unit price and line extension = `invoice.amount / 100`, classification code from the SDK list (e.g. `"022"` for others; ⚠ verify), tax category for service tax at `org.sstBps / 100` % |
| `TaxTotal` | `invoice.sstAmount / 100` |
| `LegalMonetaryTotal` | `TaxExclusiveAmount = amount / 100`, `TaxInclusiveAmount = PayableAmount = (amount + sstAmount) / 100` |

Amounts are sen in our data and ringgit with 2 decimals in UBL. Convert with `(sen / 100).toFixed(2)` passed through `Number(...)`, never float arithmetic on ringgit.

- [ ] **Step 3: Write `src/einvoice/sign.ts`**

`signDocument(doc, { p12: Buffer, password: string })` adds the `UBLExtensions` signature block and the `Signature` element exactly as the SDK's "Signature" guide describes for v1.1:
1. canonicalise the document without the signature parts
2. take its SHA-256 digest
3. sign the digest with the certificate's RSA key (SHA-256)
4. add the signed properties (signing time, certificate digest, issuer name, serial number)
5. digest the signed properties
6. assemble the `ds:Signature` structure

Extract the key and certificate from the `.p12` with `node:crypto`. If PKCS#12 can't be read with `node:crypto` alone, convert it once when the settings are saved, storing PEM key and certificate (both encrypted) instead of the `.p12`. ⚠ This is the most error-prone part. Test it against the SDK's signature validation tool or the pre-production environment before relying on it.

- [ ] **Step 4: Write `src/einvoice/einvoice.jobs.ts`**

```ts
import { createHash } from "node:crypto";
import { Types } from "mongoose";
import { registerJob, enqueue } from "../jobs/jobs";
import { findSub } from "../common/fields";
import { tx } from "../common/tx";
import { loadOrg } from "../orgs/org.model";
import { ProjectModel } from "../projects/project.model";
import { InvoiceModel } from "../billing/invoice.model";
import { changed } from "../live/live";
import { einvoiceSecrets, einvoiceSettings } from "./einvoice.settings";
import { documentDetails, getSubmission, submit, token } from "./myinvois";
import { buildInvoiceDocument } from "./ubl";
import { signDocument } from "./sign";

registerJob<{ invoiceId: string }>("einvoice.submit", async ({ invoiceId }) => {
  const settings = await einvoiceSettings();
  if (!settings?.enabled) return;
  const invoice = await InvoiceModel.findById(invoiceId);
  if (!invoice || ["SUBMITTED", "VALID"].includes(invoice.einvoice.status)) return; // done already (jobs can run twice)
  const [org, project, secrets] = await Promise.all([loadOrg(), ProjectModel.findById(invoice.projectId).lean(), einvoiceSecrets()]);
  const milestone = findSub(project!.milestones, invoice.milestoneId);
  const signed = signDocument(buildInvoiceDocument({ invoice, org, settings, project: project!, milestoneName: milestone?.name ?? "" }), { p12: secrets.certificate, password: secrets.certificatePassword });
  const jsonText = JSON.stringify(signed);
  const hash = createHash("sha256").update(jsonText).digest("hex");
  const result = await submit(settings, await token(settings, secrets), { json: jsonText, hash, codeNumber: invoice.code });
  if (result.rejected) {
    invoice.set("einvoice", { ...invoice.einvoice, status: "INVALID", errors: result.rejected });
    await invoice.save();
    changed({ kind: "project", projectId: String(invoice.projectId) });
    return;
  }
  await tx(async () => {
    invoice.set("einvoice", { ...invoice.einvoice, status: "SUBMITTED", submissionUid: result.submissionUid, uuid: result.uuid, errors: null });
    await invoice.save();
    await enqueue("einvoice.poll", { invoiceId }, new Date(Date.now() + 10_000));
  });
});

registerJob<{ invoiceId: string }>("einvoice.poll", async ({ invoiceId }) => {
  const settings = (await einvoiceSettings())!;
  const invoice = await InvoiceModel.findById(invoiceId);
  if (!invoice?.einvoice.submissionUid || invoice.einvoice.status !== "SUBMITTED") return;
  const accessToken = await token(settings, await einvoiceSecrets());
  const sub = await getSubmission(settings, accessToken, invoice.einvoice.submissionUid);
  // Throwing makes the job runner retry with backoff while LHDN is still validating.
  if (sub.status === "InProgress") throw new Error("MyInvois still validating");
  const doc = sub.documents.find((d) => d.uuid === invoice.einvoice.uuid) ?? sub.documents[0];
  if (doc?.status === "Valid") {
    invoice.set("einvoice", { ...invoice.einvoice, status: "VALID", uuid: doc.uuid, longId: doc.longId ?? null, validatedAt: doc.dateTimeValidated ? new Date(doc.dateTimeValidated) : new Date(), errors: null });
  } else {
    const details = doc ? await documentDetails(settings, accessToken, doc.uuid) : null;
    invoice.set("einvoice", { ...invoice.einvoice, status: "INVALID", errors: details?.validationResults ?? sub });
  }
  await invoice.save();
  changed({ kind: "project", projectId: String(invoice.projectId) });
});

export async function requestSubmission(invoiceId: Types.ObjectId) {
  const settings = await einvoiceSettings();
  if (settings?.enabled) await enqueue("einvoice.submit", { invoiceId: String(invoiceId) });
}
```

- [ ] **Step 5: Wire it in**

- **On invoice generation:** in `BillingService.generateInvoice`, replace the `// plan 10 adds:` comment with `await requestSubmission(invoice._id);`
- **Resubmit:** in `billing.controller.ts`, add `@Can("einvoice:submit") @Post("invoices/:id/einvoice")`. It refuses unless `einvoice.status` is `INVALID` or `NOT_SUBMITTED` ("This invoice is already with LHDN"), resets the status to `NOT_SUBMITTED`, then calls `requestSubmission(id)`.
- **The QR link:** on the invoice PDF and screen, the LHDN validation link is `https://myinvois.hasil.gov.my/<uuid>/share/<longId>` (⚠ verify; pre-production uses `preprod.myinvois.hasil.gov.my`). Show it only when `eInvoiceStatus === "VALID"`.

- [ ] **Step 6: Write the test** (LHDN mocked, so the flow is checked without the network) `src/einvoice/einvoice.test.ts`

```ts
import { describe, expect, it, vi } from "vitest";
import "./einvoice.jobs";
import { runDue, enqueue } from "../jobs/jobs";
import { tx } from "../common/tx";
import { InvoiceModel } from "../billing/invoice.model";
import { asOrg, newId } from "../../test/ctx";

// Module mocks (hoisted above the imports by Vitest): no network, no real credentials.
vi.mock("./einvoice.settings", () => ({
  einvoiceSettings: async () => ({ enabled: true, environment: "preprod" }),
  einvoiceSecrets: async () => ({ clientSecret: "s" }),
}));
vi.mock("./myinvois", () => ({
  token: async () => "t",
  submit: async () => ({ submissionUid: "S1", uuid: "U1" }),
  documentDetails: async () => ({}),
  getSubmission: async () => ({ status: "Valid", documents: [{ uuid: "U1", status: "Valid", longId: "L1", dateTimeValidated: "2026-10-19T02:00:00Z" }] }),
}));

describe("e-invoice polling", () => {
  it("stores LHDN's validation result on the invoice", async () => {
    const org = newId();
    const [inv] = await asOrg(org, () => InvoiceModel.create([{ code: "INV-2026-0001", projectId: newId(), milestoneId: newId(), amount: 100_000, sstAmount: 8_000, einvoice: { status: "SUBMITTED", submissionUid: "S1", uuid: "U1" } }]));
    await asOrg(org, () => tx(() => enqueue("einvoice.poll", { invoiceId: String(inv._id) })));
    await runDue();

    const after = await asOrg(org, () => InvoiceModel.findById(inv._id).lean());
    expect(after!.einvoice).toMatchObject({ status: "VALID", uuid: "U1", longId: "L1" });
  });
});
```

- [ ] **Step 7: Run the tests, then try pre-production**

Run: `pnpm --filter api test einvoice`
Expected: PASS.

Then use real pre-production credentials:
1. Register at the MyInvois pre-production portal and create an ERP client id and secret.
2. Get a test signing certificate as the SDK describes.
3. Save them in Settings → E-invoice.
4. Generate an invoice.

Expected: within about a minute (a request after the job's run time kicks the queue), the invoice shows the validated badge with a working LHDN link. On `INVALID`, the errors show the LHDN rule that failed. Fix the data and use Resubmit.

- [ ] **Step 8: Commit**

```bash
git add apps/api
git commit -m "feat(einvoice): submit invoices to MyInvois and record validation results"
```
