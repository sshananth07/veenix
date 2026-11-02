"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { apiRaw, ORG_COOKIE } from "@/lib/session";

export async function createOrganization(form: FormData) {
  const { orgId } = await apiRaw<{ orgId: string }>("/orgs", { method: "POST", body: { companyName: String(form.get("companyName") ?? "").trim() } });
  (await cookies()).set(ORG_COOKIE, orgId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
  redirect("/");
}

export async function acceptInvitation(token: string) {
  const { orgId } = await apiRaw<{ orgId: string }>("/invitations/accept", { method: "POST", body: { token } });
  (await cookies()).set(ORG_COOKIE, orgId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
  redirect("/");
}

export async function switchOrganization(orgId: string) {
  (await cookies()).set(ORG_COOKIE, orgId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
  redirect("/");
}
