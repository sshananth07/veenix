import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { MeDto, Role } from "@veenix/shared";
import { auth } from "./auth";

const ABSOLUTE_SESSION_MS = 7 * 86_400_000;
export const ORG_COOKIE = "veenix_org";

export const requireSession = cache(async () => {
  const s = await auth.api.getSession({ headers: headers() });
  if (!s) redirect("/login");
  if (!s.user.emailVerified) redirect(`/verify-email?email=${encodeURIComponent(s.user.email)}`);
  if (!(s.user as { twoFactorEnabled?: boolean }).twoFactorEnabled) redirect("/setup-mfa");
  if (Date.now() - new Date(s.session.createdAt).getTime() > ABSOLUTE_SESSION_MS) {
    await auth.api.signOut({ headers: headers() });
    redirect("/login");
  }
  return s;
});

/** A JWT for the API, minted once per request. */
export const apiToken = cache(async () => {
  await requireSession();
  const { token } = await auth.api.getToken({ headers: headers() });
  return token;
});

/** Minimal API call used before plan 08's full client exists. */
export async function apiRaw<T>(path: string, init: { method?: string; body?: unknown; orgId?: string } = {}): Promise<T> {
  const res = await fetch(`${process.env.API_URL}/v1${path}`, {
    method: init.method ?? "GET",
    headers: {
      authorization: `Bearer ${await apiToken()}`,
      "content-type": "application/json",
      ...(init.orgId ? { "x-org-id": init.orgId } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message ?? "Request failed");
  return data as T;
}

export const requireOrg = cache(async (): Promise<{ me: MeDto; orgId: string; role: Role }> => {
  const me = await apiRaw<MeDto>("/me");
  if (me.memberships.length === 0) redirect("/onboarding");
  const chosen = cookies().get(ORG_COOKIE)?.value;
  const m = me.memberships.find((x) => x.orgId === chosen) ?? me.memberships[0];
  return { me, orgId: m.orgId, role: m.role };
});
