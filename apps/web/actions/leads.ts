"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { hasStructuredAddress, parseAddress, composeAddress } from "@/lib/address";
import { CURRENT_USER } from "@/lib/user";
import { date, fail, num, ok, optStr, str, uniqueCode, type ActionResult } from "@/lib/actionResult";

function parseLead(formData: FormData) {
  const name = str(formData, "name");
  const phone = str(formData, "phone");
  if (!name) return { ok: false, error: "Lead name is required" } as const;
  if (!phone) return { ok: false, error: "Phone / WhatsApp is required" } as const;

  const budgetMin = num(formData, "budgetMin");
  const budgetMax = num(formData, "budgetMax");
  if ((budgetMin != null && budgetMin < 0) || (budgetMax != null && budgetMax < 0)) {
    return { ok: false, error: "Budget cannot be negative" } as const;
  }
  if (budgetMin != null && budgetMax != null && budgetMax <= budgetMin) {
    return { ok: false, error: "Max budget must be greater than min budget" } as const;
  }

  const address = parseAddress(formData, false);
  if (!address.ok) return address;

  return {
    ok: true,
    data: {
      name,
      phone,
      email: optStr(formData, "email"),
      source: str(formData, "source") || "Other",
      campaign: optStr(formData, "campaign"),
      propertyType: optStr(formData, "propertyType"),
      builtUpArea: optStr(formData, "builtUpArea"),
      budgetMin,
      budgetMax,
      ...address.parts,
      siteAddress: address.siteAddress,
      targetStart: optStr(formData, "targetStart"),
      assignedTo: optStr(formData, "assignedTo"),
      surveyAt: date(formData, "surveyAt"),
    },
  } as const;
}

export async function createLead(formData: FormData): Promise<ActionResult> {
  const parsed = parseLead(formData);
  if (!parsed.ok) return fail(parsed.error);

  const code = await uniqueCode(`L-${new Date().getFullYear()}`, await prisma.lead.count(), async (c) =>
    !!(await prisma.lead.findUnique({ where: { code: c } }))
  );
  await prisma.lead.create({
    data: {
      ...parsed.data,
      code,
      status: str(formData, "status") || "NEW",
      activities: { create: [{ note: "Lead created", author: "System" }] },
    },
  });

  revalidatePath("/leads");
  return ok();
}

export async function updateLead(leadId: string, formData: FormData): Promise<ActionResult> {
  const parsed = parseLead(formData);
  if (!parsed.ok) return fail(parsed.error);

  await prisma.lead.update({
    where: { id: leadId },
    data: { ...parsed.data, status: str(formData, "status") || undefined },
  });

  revalidatePath("/leads");
  revalidatePath(`/leads/${leadId}`);
  return ok();
}

export async function logLeadActivity(leadId: string, note: string, author?: string) {
  if (!note.trim()) return;
  await prisma.leadActivity.create({ data: { leadId, note: note.trim(), author: author?.trim() || CURRENT_USER.name } });
  revalidatePath(`/leads/${leadId}`);
}

export async function convertLead(leadId: string, formData: FormData): Promise<ActionResult> {
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });

  const projectName = str(formData, "projectName");
  if (!projectName) return fail("Project name is required");

  const targetStart = date(formData, "targetStart");
  const targetHandover = date(formData, "targetHandover");
  if (targetStart && targetHandover && targetHandover < targetStart) {
    return fail("Target handover must be after the target start");
  }

  // A project needs a full site address. If the lead never had one, the
  // convert form asks for it and it is saved back onto the lead as well.
  let address = {
    addressLine1: lead.addressLine1,
    addressLine2: lead.addressLine2,
    addressLine3: lead.addressLine3,
    postcode: lead.postcode,
    city: lead.city,
    state: lead.state,
  };
  let siteAddress = hasStructuredAddress(lead) ? composeAddress(lead) : (lead.siteAddress ?? "");
  if (formData.has("addressLine1")) {
    const parsed = parseAddress(formData, true);
    if (!parsed.ok) return fail(parsed.error);
    address = parsed.parts;
    siteAddress = parsed.siteAddress ?? "";
  } else if (!hasStructuredAddress(lead)) {
    return fail("Add the site address before converting");
  }

  const code = await uniqueCode(`PRJ-${new Date().getFullYear()}`, await prisma.project.count(), async (c) =>
    !!(await prisma.project.findUnique({ where: { code: c } }))
  );

  const project = await prisma.project.create({
    data: {
      code,
      name: projectName,
      clientName: lead.name,
      clientPhone: lead.phone,
      clientEmail: lead.email,
      ...address,
      siteAddress,
      propertyType: lead.propertyType,
      builtUpArea: lead.builtUpArea,
      budgetMin: lead.budgetMin,
      budgetMax: lead.budgetMax,
      campaign: lead.campaign,
      surveyAt: lead.surveyAt,
      pmName: str(formData, "projectOwner") || lead.assignedTo,
      stage: str(formData, "nextStage") || "SITE_VISIT",
      targetStart,
      targetHandover,
      leadId: lead.id,
    },
  });

  await prisma.lead.update({
    where: { id: leadId },
    data: { ...address, siteAddress, status: "CONVERTED", activities: { create: [{ note: `Converted to project ${project.code}` }] } },
  });

  revalidatePath("/leads");
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/projects");
  redirect(`/projects/${project.id}`);
}
