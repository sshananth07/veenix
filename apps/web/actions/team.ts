"use server";

import { revalidatePath } from "next/cache";
import type { Role } from "@veenix/shared";
import { ApiError, api, apiAction } from "@/lib/api";
import { optStr, str, type ActionResult } from "@/lib/actionResult";

export async function setAssignees(projectId: string, assignees: { userId: string; role: "project_manager" | "site_staff" }[]): Promise<ActionResult> {
  const r = await apiAction(`/projects/${projectId}/assignees`, { method: "PUT", body: { assignees } });
  revalidatePath(`/projects/${projectId}`);
  return r;
}

export async function inviteMember(formData: FormData): Promise<ActionResult> {
  const r = await apiAction("/org/invitations", { method: "POST", body: { email: str(formData, "email"), role: str(formData, "role") } });
  revalidatePath("/settings");
  return r;
}

export async function changeMemberRole(membershipId: string, role: Role): Promise<ActionResult> {
  const r = await apiAction(`/org/members/${membershipId}`, { method: "PATCH", body: { role } });
  revalidatePath("/settings");
  return r;
}

export async function removeMember(membershipId: string): Promise<ActionResult> {
  const r = await apiAction(`/org/members/${membershipId}`, { method: "DELETE" });
  revalidatePath("/settings");
  return r;
}

export async function revokeInvitation(invitationId: string): Promise<ActionResult> {
  const r = await apiAction(`/org/invitations/${invitationId}`, { method: "DELETE" });
  revalidatePath("/settings");
  return r;
}

export async function emailDocument(type: string, id: string, formData: FormData): Promise<ActionResult> {
  return apiAction(`/documents/${type}/${id}/email`, { method: "POST", body: { to: str(formData, "to"), message: optStr(formData, "message") } });
}

/** A wa.me link carrying a 7-day download link, or the reason it couldn't be made. */
export async function shareDocument(type: string, id: string, phone: string | null): Promise<{ ok: true; whatsappUrl: string } | { ok: false; error: string }> {
  try {
    const { whatsappUrl } = await api<{ whatsappUrl: string }>(`/documents/${type}/${id}/share`, { method: "POST", body: { phone } });
    return { ok: true, whatsappUrl };
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, error: e.message };
    throw e; // redirects (expired session) must reach Next
  }
}
