"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { refreshDraftQuotation } from "@/lib/bom";
import { date, fail, num, ok, optStr, str, uniqueCode, type ActionResult } from "@/lib/actionResult";
import { getFile, saveUpload } from "@/lib/uploads";
import { formatNumber } from "@/lib/utils";

function vendorFields(formData: FormData) {
  const experienceYears = num(formData, "experienceYears");
  return {
    type: optStr(formData, "type"),
    registrationNo: optStr(formData, "registrationNo"),
    contactPerson: optStr(formData, "contactPerson"),
    phone: optStr(formData, "phone"),
    email: optStr(formData, "email"),
    location: optStr(formData, "location"),
    experienceYears: experienceYears != null ? Math.round(experienceYears) : null,
    notes: optStr(formData, "notes"),
  };
}

export async function createVendor(formData: FormData): Promise<ActionResult> {
  const name = str(formData, "name");
  if (!name) return fail("Vendor name is required");
  const dup = await prisma.vendor.findFirst({ where: { name } });
  if (dup) return fail(`"${name}" is already in your vendor list`);

  await prisma.vendor.create({ data: { name, ...vendorFields(formData) } });
  revalidatePath("/vendors");
  revalidatePath("/projects/[id]", "page");
  return ok();
}

export async function updateVendor(vendorId: string, formData: FormData): Promise<ActionResult> {
  const name = str(formData, "name");
  if (!name) return fail("Vendor name is required");
  const dup = await prisma.vendor.findFirst({ where: { name, id: { not: vendorId } } });
  if (dup) return fail(`"${name}" is already in your vendor list`);

  await prisma.vendor.update({ where: { id: vendorId }, data: { name, ...vendorFields(formData) } });
  revalidatePath("/vendors");
  revalidatePath(`/vendors/${vendorId}`);
  revalidatePath("/projects/[id]", "page");
  return ok();
}

export async function setVendorActive(vendorId: string, active: boolean): Promise<ActionResult> {
  await prisma.vendor.update({ where: { id: vendorId }, data: { active } });
  revalidatePath("/vendors");
  revalidatePath(`/vendors/${vendorId}`);
  return ok();
}

// ---- RFQ: ask one or many vendors to quote a package ---------------------

export async function requestQuotes(bomItemId: string, formData: FormData): Promise<ActionResult> {
  const vendorIds = formData.getAll("vendorIds").map(String).filter(Boolean);
  if (vendorIds.length === 0) return fail("Pick at least one vendor");

  const bom = await prisma.bomItem.findUniqueOrThrow({
    where: { id: bomItemId },
    include: { rfqs: { include: { quotes: true, purchaseOrders: true } } },
  });
  if (bom.performedBy === "SELF") return fail("Self-performed work does not need an RFQ");

  let rfq = bom.rfqs[0];
  if (rfq?.purchaseOrders.length) return fail("A vendor has already been awarded this package");

  const respondBy = date(formData, "respondBy");
  const note = optStr(formData, "note");
  if (!rfq) {
    const code = await uniqueCode("RFQ", await prisma.rfq.count(), async (c) => !!(await prisma.rfq.findUnique({ where: { code: c } })));
    rfq = await prisma.rfq.create({
      data: { code, projectId: bom.projectId, bomItemId, quantity: `${formatNumber(bom.qty)} ${bom.unit}`, respondBy, note },
      include: { quotes: true, purchaseOrders: true },
    });
  } else if (respondBy || note) {
    await prisma.rfq.update({ where: { id: rfq.id }, data: { respondBy: respondBy ?? undefined, note: note ?? undefined } });
  }

  const invited = new Set(rfq.quotes.map((q) => q.vendorId));
  const toAdd = vendorIds.filter((id) => !invited.has(id));
  if (toAdd.length === 0) return fail("Those vendors have already been asked to quote");
  await prisma.rfqVendorQuote.createMany({ data: toAdd.map((vendorId) => ({ rfqId: rfq.id, vendorId })) });

  revalidatePath(`/projects/${bom.projectId}`);
  return ok();
}

export async function removeVendorRequest(quoteId: string): Promise<ActionResult> {
  const quote = await prisma.rfqVendorQuote.findUniqueOrThrow({ where: { id: quoteId }, include: { rfq: { include: { purchaseOrders: true } } } });
  if (quote.rfq.purchaseOrders.length) return fail("This package has already been awarded");
  if (quote.receivedAt) return fail("A quote has already been received from this vendor");

  await prisma.rfqVendorQuote.delete({ where: { id: quoteId } });
  revalidatePath(`/projects/${quote.rfq.projectId}`);
  return ok();
}

// ---- Quote received: price, lead time, warranty and the vendor's document --

export async function quoteReceived(quoteId: string, formData: FormData): Promise<ActionResult> {
  const quotedPrice = Math.round(num(formData, "quotedPrice") ?? 0);
  const leadTimeDays = Math.round(num(formData, "leadTimeDays") ?? 0);
  const warrantyMonths = Math.round(num(formData, "warrantyMonths") ?? 0);
  if (!(quotedPrice > 0)) return fail("Enter the quoted price");
  if (leadTimeDays < 0 || warrantyMonths < 0) return fail("Lead time and warranty cannot be negative");

  const quote = await prisma.rfqVendorQuote.findUniqueOrThrow({ where: { id: quoteId }, include: { rfq: { include: { purchaseOrders: true } } } });
  if (quote.rfq.purchaseOrders.length) return fail("This package has already been awarded");

  let upload: { path: string; name: string } | null = null;
  const file = getFile(formData, "file");
  if (file) {
    try {
      upload = await saveUpload(file, "quotes");
    } catch (e) {
      return fail(e instanceof Error ? e.message : "Could not upload the file");
    }
  }

  await prisma.rfqVendorQuote.update({
    where: { id: quoteId },
    data: {
      quotedPrice,
      leadTimeDays,
      warrantyMonths,
      notes: optStr(formData, "notes"),
      receivedAt: quote.receivedAt ?? new Date(),
      ...(upload ? { attachmentPath: upload.path, attachmentName: upload.name } : {}),
    },
  });

  revalidatePath(`/projects/${quote.rfq.projectId}`);
  return ok();
}

// A vendor sends a second (revised) quote after negotiation. The previous
// offer is filed in the history and the new one becomes the current quote, so
// every round stays on record and Accept quote always uses the latest.
export async function reviseQuote(quoteId: string, formData: FormData): Promise<ActionResult> {
  const quotedPrice = Math.round(num(formData, "quotedPrice") ?? 0);
  const leadTimeDays = Math.round(num(formData, "leadTimeDays") ?? 0);
  const warrantyMonths = Math.round(num(formData, "warrantyMonths") ?? 0);
  if (!(quotedPrice > 0)) return fail("Enter the revised price");
  if (leadTimeDays < 0 || warrantyMonths < 0) return fail("Lead time and warranty cannot be negative");

  const quote = await prisma.rfqVendorQuote.findUniqueOrThrow({
    where: { id: quoteId },
    include: { rfq: { include: { purchaseOrders: true } }, revisions: true },
  });
  if (quote.rfq.purchaseOrders.length) return fail("This package has already been awarded");
  if (!quote.receivedAt) return fail("Record the vendor's first quote before adding a revised one");

  let upload: { path: string; name: string } | null = null;
  const file = getFile(formData, "file");
  if (file) {
    try {
      upload = await saveUpload(file, "quotes");
    } catch (e) {
      return fail(e instanceof Error ? e.message : "Could not upload the file");
    }
  }

  await prisma.$transaction([
    prisma.rfqQuoteRevision.create({
      data: {
        quoteId,
        round: quote.revisions.length + 1,
        quotedPrice: quote.quotedPrice,
        leadTimeDays: quote.leadTimeDays,
        warrantyMonths: quote.warrantyMonths,
        notes: quote.notes,
        attachmentPath: quote.attachmentPath,
        attachmentName: quote.attachmentName,
        receivedAt: quote.receivedAt,
      },
    }),
    prisma.rfqVendorQuote.update({
      where: { id: quoteId },
      data: {
        quotedPrice,
        leadTimeDays,
        warrantyMonths,
        notes: optStr(formData, "notes"),
        receivedAt: new Date(),
        attachmentPath: upload?.path ?? null,
        attachmentName: upload?.name ?? null,
      },
    }),
  ]);

  revalidatePath(`/projects/${quote.rfq.projectId}`);
  return ok();
}

// ---- Accept quote: creates the PO and its payment milestones --------------

function parseTerms(formData: FormData) {
  const labels = formData.getAll("termLabel").map(String);
  const pcts = formData.getAll("termPct").map(String);
  const rows: { label: string; pct: number }[] = [];
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i].trim();
    if (!label && !pcts[i]) continue;
    const pct = Number(pcts[i]);
    if (!label) return { ok: false, error: "Every payment term needs a name" } as const;
    if (!Number.isInteger(pct) || pct < 1 || pct > 100) return { ok: false, error: `"${label}" needs a percentage between 1 and 100` } as const;
    rows.push({ label, pct });
  }
  if (rows.length === 0) return { ok: false, error: "Add at least one payment term" } as const;
  const sum = rows.reduce((s, r) => s + r.pct, 0);
  if (sum !== 100) return { ok: false, error: `Payment terms add up to ${sum}%. They must total 100%.` } as const;
  return { ok: true, rows } as const;
}

function termAmounts(amount: number, rows: { label: string; pct: number }[]) {
  let running = 0;
  return rows.map((r, i) => {
    const value = i === rows.length - 1 ? amount - running : Math.round((amount * r.pct) / 100);
    running += value;
    return { seq: i + 1, label: r.label, pct: r.pct, amount: value };
  });
}

export async function acceptQuote(quoteId: string, formData: FormData): Promise<ActionResult> {
  const terms = parseTerms(formData);
  if (!terms.ok) return fail(terms.error);

  const quote = await prisma.rfqVendorQuote.findUniqueOrThrow({
    where: { id: quoteId },
    include: { rfq: { include: { bomItem: true, purchaseOrders: true } } },
  });
  if (!quote.receivedAt || quote.quotedPrice <= 0) return fail("Mark the quote as received first");
  if (quote.rfq.purchaseOrders.length) return fail("A quote has already been accepted for this package");

  const code = await uniqueCode("PO", await prisma.purchaseOrder.count(), async (c) => !!(await prisma.purchaseOrder.findUnique({ where: { code: c } })));

  await prisma.$transaction([
    prisma.rfqVendorQuote.updateMany({ where: { rfqId: quote.rfqId }, data: { selected: false } }),
    prisma.rfqVendorQuote.update({ where: { id: quoteId }, data: { selected: true } }),
    prisma.purchaseOrder.create({
      data: {
        code,
        projectId: quote.rfq.projectId,
        rfqId: quote.rfqId,
        vendorId: quote.vendorId,
        description: quote.rfq.bomItem.workPackage,
        qty: quote.rfq.quantity,
        amount: quote.quotedPrice,
        deliveryBy: date(formData, "deliveryBy"),
        remarks: optStr(formData, "remarks"),
        milestones: { create: termAmounts(quote.quotedPrice, terms.rows) },
      },
    }),
  ]);

  await refreshDraftQuotation(quote.rfq.projectId);
  revalidatePath(`/projects/${quote.rfq.projectId}`);
  return ok();
}

export async function setPoTerms(poId: string, formData: FormData): Promise<ActionResult> {
  const terms = parseTerms(formData);
  if (!terms.ok) return fail(terms.error);

  const po = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: poId }, include: { milestones: true } });
  if (po.milestones.some((m) => m.status !== "PENDING")) return fail("Payment terms are locked once a vendor invoice has been attached");

  await prisma.$transaction([
    prisma.poMilestone.deleteMany({ where: { poId } }),
    ...termAmounts(po.amount, terms.rows).map((m) => prisma.poMilestone.create({ data: { ...m, poId } })),
  ]);

  revalidatePath(`/projects/${po.projectId}`);
  return ok();
}

// ---- Vendor invoice + payment against a milestone -------------------------

export async function attachVendorInvoice(milestoneId: string, formData: FormData): Promise<ActionResult> {
  const invoiceNo = str(formData, "invoiceNo");
  if (!invoiceNo) return fail("Enter the vendor's invoice number");

  const milestone = await prisma.poMilestone.findUniqueOrThrow({ where: { id: milestoneId }, include: { po: true } });
  if (milestone.status === "PAID") return fail("This milestone is already paid");

  const file = getFile(formData, "file");
  if (!file && !milestone.invoicePath) return fail("Attach the vendor's invoice (PDF or image)");

  let upload: { path: string; name: string } | null = null;
  if (file) {
    try {
      upload = await saveUpload(file, "invoices");
    } catch (e) {
      return fail(e instanceof Error ? e.message : "Could not upload the file");
    }
  }

  await prisma.poMilestone.update({
    where: { id: milestoneId },
    data: {
      status: "INVOICED",
      invoiceNo,
      invoiceDate: date(formData, "invoiceDate") ?? new Date(),
      ...(upload ? { invoicePath: upload.path, invoiceName: upload.name } : {}),
    },
  });

  revalidatePath(`/projects/${milestone.po.projectId}`);
  return ok();
}

export async function recordMilestonePayment(milestoneId: string, formData: FormData): Promise<ActionResult> {
  const milestone = await prisma.poMilestone.findUniqueOrThrow({ where: { id: milestoneId }, include: { po: true } });
  if (milestone.status === "PAID") return fail("This milestone is already paid");
  if (milestone.status !== "INVOICED") return fail("Attach the vendor's invoice before recording payment");

  const paidAmount = Math.round(num(formData, "paidAmount") ?? 0);
  if (!(paidAmount > 0)) return fail("Enter the amount paid");

  await prisma.poMilestone.update({
    where: { id: milestoneId },
    data: {
      status: "PAID",
      paidAmount,
      paidDate: date(formData, "paidDate") ?? new Date(),
      method: str(formData, "method") || "Bank Transfer",
      bankRef: optStr(formData, "bankRef"),
      paidFrom: optStr(formData, "paidFrom"),
    },
  });

  const remaining = await prisma.poMilestone.count({ where: { poId: milestone.poId, status: { not: "PAID" } } });
  await prisma.purchaseOrder.update({ where: { id: milestone.poId }, data: { status: remaining === 0 ? "PAID" : "ISSUED" } });

  revalidatePath(`/projects/${milestone.po.projectId}`);
  return ok();
}
