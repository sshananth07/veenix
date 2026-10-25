"use server";

import { revalidatePath } from "next/cache";
import { apiAction } from "@/lib/api";
import { parseTermRows } from "@/lib/paymentTerms";
import { num, str, type ActionResult } from "@/lib/actionResult";

// Most quotation actions only know the quotation id, so they refresh every project page.
const done = async (r: ActionResult) => {
  revalidatePath("/projects/[id]", "page");
  return r;
};
const post = (path: string, body?: unknown) => apiAction(path, { method: "POST", body }).then(done);

export async function buildQuotation(projectId: string, formData: FormData): Promise<ActionResult> {
  const r = await apiAction(`/projects/${projectId}/quotations`, { method: "POST", body: { markupPct: num(formData, "markupPct") } });
  revalidatePath(`/projects/${projectId}`);
  return r;
}

export async function createRevision(fromQuotationId: string): Promise<ActionResult> {
  return post(`/quotations/${fromQuotationId}/revisions`);
}

export async function discardDraft(quotationId: string): Promise<ActionResult> {
  return apiAction(`/quotations/${quotationId}`, { method: "DELETE" }).then(done);
}

export async function updateLineMarkup(lineId: string, formData: FormData): Promise<ActionResult> {
  return apiAction(`/quotation-lines/${lineId}`, { method: "PATCH", body: { markupPct: num(formData, "markupPct") } }).then(done);
}

// Replaces the client payment terms on a draft. Amounts are not stored: they
// are always the term's share of the quotation total.
export async function saveQuotationTerms(quotationId: string, formData: FormData): Promise<ActionResult> {
  return apiAction(`/quotations/${quotationId}/terms`, { method: "PUT", body: { terms: parseTermRows(formData).rows } }).then(done);
}

export async function sendQuotation(quotationId: string): Promise<ActionResult> {
  return post(`/quotations/${quotationId}/send`);
}

// Stand-in for the client-facing link until a portal exists: records what the client did.
export async function recordClientResponse(quotationId: string, response: "VIEWED" | "ACCEPTED", note?: string): Promise<ActionResult> {
  return response === "ACCEPTED"
    ? post(`/quotations/${quotationId}/accept`, { signedBy: note || null })
    : post(`/quotations/${quotationId}/viewed`);
}

// The client asked something (call, WhatsApp, site visit). The version waits for our reply.
export async function recordClientQuestion(quotationId: string, formData: FormData): Promise<ActionResult> {
  return post(`/quotations/${quotationId}/questions`, { comment: str(formData, "comment") });
}

// Our answer to the client's last question. The version goes back to waiting on the client.
export async function recordReply(quotationId: string, formData: FormData): Promise<ActionResult> {
  return post(`/quotations/${quotationId}/replies`, { reply: str(formData, "reply") });
}

export async function applyMarkupToAll(quotationId: string, formData: FormData): Promise<ActionResult> {
  return post(`/quotations/${quotationId}/markup`, { markupPct: num(formData, "markupPct") });
}
