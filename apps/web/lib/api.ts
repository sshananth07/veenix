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

/** For server components: data or a Next.js 404/redirect. A role refusal shows /forbidden (production hides thrown messages). */

export async function api<T>(path: string, init?: Init): Promise<T> {
  try {
    return (await call(path, init)) as T;
  } catch (e) {
    onAuthError(e);
    if (e instanceof ApiError && e.status === 404) notFound();
    if (e instanceof ApiError && e.status === 403) redirect("/forbidden");
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
