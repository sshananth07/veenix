import { redis } from "../common/redis";
import { ctx } from "../common/context";
import type { EinvoiceSettings } from "./einvoice.settings";

// MyInvois API (SDK "e-Invoice API" and "Integration Practices"). Paths and fields checked against the SDK.
const API = { preprod: "https://preprod-api.myinvois.hasil.gov.my", prod: "https://api.myinvois.hasil.gov.my" } as const;
const PORTAL = { preprod: "https://preprod.myinvois.hasil.gov.my", prod: "https://myinvois.hasil.gov.my" } as const;

/** The public validation link; LHDN's QR code on the invoice encodes exactly this. */
export const validationUrl = (environment: keyof typeof PORTAL, uuid: string, longId: string) => `${PORTAL[environment]}/${uuid}/share/${longId}`;

/** Compares LHDN statuses loosely: the SDK documents both "in progress" and "InProgress" spellings. */
export const statusIs = (status: unknown, expected: "inprogress" | "valid" | "invalid" | "partiallyvalid") =>
  String(status ?? "").toLowerCase().replace(/\s/g, "") === expected;

type Settings = Pick<EinvoiceSettings, "environment" | "clientId">;
const tokenKey = (s: Settings) => `myinvois:token:${ctx().orgId}:${s.environment}:${s.clientId}`;

async function call(s: Settings, path: string, init: RequestInit = {}) {
  const res = await fetch(`${API[s.environment]}${path}`, { ...init, signal: AbortSignal.timeout(30_000) });
  const text = await res.text();
  if (res.status === 401) await redis.del(tokenKey(s)); // expired or revoked: the next attempt logs in again
  // Failures throw, so the job runner retries with backoff (which is longer than any Retry-After LHDN sends).
  if (!res.ok) throw new Error(`MyInvois ${res.status} ${path} (correlation ${res.headers.get("correlationId") ?? "-"}): ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

/** OAuth client-credentials token, reused until 60 s before it expires (login is limited to 12 per minute). */
export async function token(s: Settings, secrets: { clientSecret: string }): Promise<string> {
  const cached = await redis.get(tokenKey(s));
  if (cached) return cached;
  const body = await call(s, "/connect/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: s.clientId, client_secret: secrets.clientSecret, grant_type: "client_credentials", scope: "InvoicingAPI" }),
  });
  await redis.set(tokenKey(s), body.access_token, "EX", Math.max(60, Number(body.expires_in) - 60));
  return body.access_token;
}

const auth = (accessToken: string) => ({ authorization: `Bearer ${accessToken}`, accept: "application/json" });

/** `document` is the signed JSON as sent; `documentHash` is its SHA-256 in hex. */
export async function submit(s: Settings, accessToken: string, doc: { json: string; hash: string; codeNumber: string }) {
  const body = await call(s, "/api/v1.0/documentsubmissions/", {
    method: "POST",
    headers: { ...auth(accessToken), "content-type": "application/json" },
    body: JSON.stringify({ documents: [{ format: "JSON", document: Buffer.from(doc.json, "utf8").toString("base64"), documentHash: doc.hash, codeNumber: doc.codeNumber }] }),
  });
  return {
    submissionUid: (body.submissionUid ?? body.submissionUID) as string,
    uuid: (body.acceptedDocuments?.[0]?.uuid as string | undefined) ?? null,
    rejected: body.rejectedDocuments?.[0]?.error as LhdnError | undefined,
  };
}

export async function getSubmission(s: Settings, accessToken: string, uid: string) {
  const body = await call(s, `/api/v1.0/documentsubmissions/${uid}?pageNo=1&pageSize=10`, { headers: auth(accessToken) });
  return { status: body.overallStatus as string, documents: (body.documentSummary ?? []) as { uuid: string; status: string; longId?: string; dateTimeValidated?: string }[] };
}

/** Only for an invalid document: the SDK reserves this endpoint for fetching validation errors. */
export async function documentDetails(s: Settings, accessToken: string, uuid: string) {
  return (await call(s, `/api/v1.0/documents/${uuid}/details`, { headers: auth(accessToken) })) as {
    validationResults?: { validationSteps?: { name: string; status: string; error?: LhdnError }[] };
  };
}

/** The SDK's standard error object. Inner errors spell the Malay field both errorMS and errorMs. */
export type LhdnError = { errorCode?: string; error?: string; propertyPath?: string | null; innerError?: LhdnError[] | null; code?: string; message?: string };

/** Flattens LHDN errors into readable lines, innermost (most specific) first. */
export function errorLines(e: LhdnError | null | undefined, step?: string): string[] {
  if (!e) return [];
  const inner = (e.innerError ?? []).flatMap((x) => errorLines(x, step));
  if (inner.length > 0) return inner;
  const text = e.error ?? e.message ?? "Rejected";
  const code = e.errorCode ?? e.code;
  return [[step, code && `${code}:`, text].filter(Boolean).join(" ")];
}
