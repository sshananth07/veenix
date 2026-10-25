"use server";

import { revalidatePath } from "next/cache";
import { apiAction } from "@/lib/api";
import { BAD_AMOUNT, date, fail, fileRef, money, num, optStr, str, type ActionResult } from "@/lib/actionResult";

function vendorBody(formData: FormData) {
  return {
    name: str(formData, "name"),
    type: optStr(formData, "type"),
    registrationNo: optStr(formData, "registrationNo"),
    contactPerson: optStr(formData, "contactPerson"),
    phone: optStr(formData, "phone"),
    email: optStr(formData, "email"),
    location: optStr(formData, "location"),
    experienceYears: num(formData, "experienceYears"),
    notes: optStr(formData, "notes"),
  };
}

const project = async (r: ActionResult) => {
  revalidatePath("/projects/[id]", "page");
  return r;
};

export async function createVendor(formData: FormData): Promise<ActionResult> {
  const r = await apiAction("/vendors", { method: "POST", body: vendorBody(formData) });
  revalidatePath("/vendors");
  revalidatePath("/projects/[id]", "page");
  return r;
}

export async function updateVendor(vendorId: string, formData: FormData): Promise<ActionResult> {
  const r = await apiAction(`/vendors/${vendorId}`, { method: "PATCH", body: vendorBody(formData) });
  revalidatePath("/vendors");
  revalidatePath(`/vendors/${vendorId}`);
  revalidatePath("/projects/[id]", "page");
  return r;
}

export async function setVendorActive(vendorId: string, active: boolean): Promise<ActionResult> {
  const r = await apiAction(`/vendors/${vendorId}/active`, { method: "PUT", body: { active } });
  revalidatePath("/vendors");
  revalidatePath(`/vendors/${vendorId}`);
  return r;
}

// ---- RFQ: ask one or many vendors to quote a package ---------------------

export async function requestQuotes(bomItemId: string, formData: FormData): Promise<ActionResult> {
  const body = { vendorIds: formData.getAll("vendorIds").map(String).filter(Boolean), respondBy: date(formData, "respondBy"), note: optStr(formData, "note") };
  return apiAction(`/bom-items/${bomItemId}/rfq/invites`, { method: "POST", body }).then(project);
}

export async function removeVendorRequest(quoteId: string): Promise<ActionResult> {
  return apiAction(`/rfq-quotes/${quoteId}`, { method: "DELETE" }).then(project);
}

// ---- Quote received: price, lead time, warranty and the vendor's document --

function quoteBody(formData: FormData) {
  const quotedPrice = money(formData, "quotedPrice");
  if (Number.isNaN(quotedPrice)) return null;
  return {
    quotedPrice,
    // Blank whole numbers are left out so the API's default (0) applies.
    leadTimeDays: num(formData, "leadTimeDays") ?? undefined,
    warrantyMonths: num(formData, "warrantyMonths") ?? undefined,
    notes: optStr(formData, "notes"),
    file: fileRef(formData, "file"),
  };
}

export async function quoteReceived(quoteId: string, formData: FormData): Promise<ActionResult> {
  const body = quoteBody(formData);
  if (!body) return fail(BAD_AMOUNT);
  return apiAction(`/rfq-quotes/${quoteId}/received`, { method: "POST", body }).then(project);
}

// A vendor sends a revised quote after negotiation. The previous offer is kept
// in the history and the new one becomes the current quote.
export async function reviseQuote(quoteId: string, formData: FormData): Promise<ActionResult> {
  const body = quoteBody(formData);
  if (!body) return fail(BAD_AMOUNT);
  return apiAction(`/rfq-quotes/${quoteId}/revisions`, { method: "POST", body }).then(project);
}

// ---- Accept quote: creates the PO and its payment milestones --------------

// Reads termLabel / termPct pairs. The API checks them.
function poTerms(formData: FormData) {
  const pcts = formData.getAll("termPct").map(String);
  return formData
    .getAll("termLabel")
    .map((l, i) => ({ label: String(l).trim(), pct: Number(pcts[i]) }))
    .filter((t, i) => t.label || pcts[i]);
}

export async function acceptQuote(quoteId: string, formData: FormData): Promise<ActionResult> {
  const body = { terms: poTerms(formData), deliveryBy: date(formData, "deliveryBy"), remarks: optStr(formData, "remarks") };
  return apiAction(`/rfq-quotes/${quoteId}/accept`, { method: "POST", body }).then(project);
}

export async function setPoTerms(poId: string, formData: FormData): Promise<ActionResult> {
  return apiAction(`/purchase-orders/${poId}/terms`, { method: "PUT", body: { terms: poTerms(formData) } }).then(project);
}

// ---- Vendor invoice + payment against a milestone -------------------------

export async function attachVendorInvoice(milestoneId: string, formData: FormData): Promise<ActionResult> {
  const body = { invoiceNo: str(formData, "invoiceNo"), invoiceDate: date(formData, "invoiceDate"), file: fileRef(formData, "file") };
  return apiAction(`/po-milestones/${milestoneId}/invoice`, { method: "POST", body }).then(project);
}

export async function recordMilestonePayment(milestoneId: string, formData: FormData): Promise<ActionResult> {
  const paidAmount = money(formData, "paidAmount");
  if (Number.isNaN(paidAmount)) return fail(BAD_AMOUNT);
  const body = {
    paidAmount,
    paidDate: date(formData, "paidDate"),
    method: str(formData, "method") || "Bank Transfer",
    bankRef: optStr(formData, "bankRef"),
    paidFrom: optStr(formData, "paidFrom"),
  };
  return apiAction(`/po-milestones/${milestoneId}/payment`, { method: "POST", body }).then(project);
}
