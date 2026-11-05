import { Types } from "mongoose";
import { z } from "zod";
import { composeAddress, convertLeadInput, formatDate, formatMoney2, hasStructuredAddress, leadInput, MY_STATES, PROJECT_STAGE_LABEL, PROJECT_STAGES } from "@veenix/shared";
import { audit } from "../audit/audit";
import { notFound, rule } from "../common/errors";
import { LeadModel } from "../leads/lead.model";
import { LeadsService } from "../leads/leads.service";
import { ProjectModel } from "../projects/project.model";
import { defineApprovalAction, type Card } from "./pending";

const leads = new LeadsService();
const id = z.string().regex(/^[a-f\d]{24}$/i, "Use an id from a tool result");
const text = (max: number) => z.string().trim().min(1).max(max).nullable();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").nullable();
const firstIssue = (e: z.ZodError, fallback: string) => rule(e.issues[0]?.message ?? fallback);

// ---- Creating a lead ----

const createLeadInput = z.strictObject({
  name: z.string().trim().min(1).max(200),
  phone: z.string().trim().min(1).max(40),
  email: z.string().trim().max(200).nullable(),
  source: text(60),
  propertyType: text(120),
  budgetMinSen: z.int().positive().nullable(),
  budgetMaxSen: z.int().positive().nullable(),
  addressLine1: text(160),
  postcode: z.string().regex(/^\d{5}$/, "Postcode must be 5 digits").nullable(),
  city: text(80),
  state: z.enum(MY_STATES).nullable(),
});
type CreateLeadInput = z.infer<typeof createLeadInput>;

/** The tool's fields as the lead form's input, so the form's own rules apply. */
function asLead(i: CreateLeadInput) {
  const r = leadInput.safeParse({
    name: i.name, phone: i.phone, email: i.email, source: i.source ?? "Other", propertyType: i.propertyType,
    budgetMin: i.budgetMinSen, budgetMax: i.budgetMaxSen, addressLine1: i.addressLine1, postcode: i.postcode, city: i.city, state: i.state,
  });
  if (!r.success) throw firstIssue(r.error, "Check the lead details");
  return r.data;
}

defineApprovalAction({
  name: "create_lead",
  description:
    "Propose a new lead (a prospective client). Use this when the user wants a new project for a client who has no lead yet: search first, since projects are made by converting a lead. name and phone are required; ask for them. Everything else only if the user stated it, otherwise null. Budgets are in sen.",
  input: createLeadInput,
  permission: "lead:write",
  deferred: false,
  validate: async (input) => {
    const lead = asLead(input);
    const dup = await LeadModel.findOne({ phone: lead.phone }).select("name code").lean();
    if (dup) throw rule(`${dup.name} (${dup.code}) already has this phone number. Use that lead instead.`);
    const budget = lead.budgetMin != null || lead.budgetMax != null ? [lead.budgetMin, lead.budgetMax].map((v) => (v == null ? "?" : formatMoney2(v))).join(" – ") : null;
    const lines = [
      { label: "Name", value: lead.name },
      { label: "Phone", value: lead.phone },
      { label: "Email", value: lead.email },
      { label: "Source", value: lead.source },
      { label: "Property", value: lead.propertyType },
      { label: "Budget", value: budget },
      { label: "Site address", value: composeAddress(lead) || "Not set (needed before it becomes a project)" },
    ].filter((l): l is { label: string; value: string } => !!l.value);
    return { title: `Add lead ${lead.name}`, lines, changes: [], missing: [], link: "/leads" } satisfies Card;
  },
  apply: async (input) => {
    const { id: leadId } = await leads.create(asLead(input));
    const lead = (await LeadModel.findById(leadId).select("code name").lean())!;
    await audit("assistant.lead_created", "lead", new Types.ObjectId(leadId));
    return {
      leadId, done: `Lead ${lead.code} added for ${lead.name}.`, link: `/leads/${leadId}`,
      next: { label: "Make it a project", prompt: `Convert lead ${lead.code} (${lead.name}) into a project` },
    };
  },
});

// ---- Converting a lead into a project ----

const siteAddress = z.strictObject({
  addressLine1: z.string().trim().min(1, "Address line 1 is required").max(160),
  addressLine2: text(160),
  addressLine3: text(160),
  postcode: z.string().regex(/^\d{5}$/, "Postcode must be 5 digits, e.g. 47300"),
  city: z.string().trim().min(1, "City is required").max(80),
  state: z.enum(MY_STATES, { error: "Choose a state" }),
});

const convertInput = z.strictObject({
  leadId: id,
  projectName: z.string().trim().min(1).max(200),
  nextStage: z.enum(PROJECT_STAGES).nullable(),
  projectOwner: text(120),
  targetStart: day,
  targetHandover: day,
  /** Only when the lead has no site address: the bot passes one the user stated, or the user fills it in on the card. */
  address: siteAddress.nullable(),
});
type ConvertInput = z.infer<typeof convertInput>;

function asConvert(i: ConvertInput) {
  const r = convertLeadInput.safeParse({
    projectName: i.projectName, nextStage: i.nextStage ?? "SITE_VISIT", projectOwner: i.projectOwner, targetStart: i.targetStart, targetHandover: i.targetHandover, address: i.address,
  });
  if (!r.success) throw firstIssue(r.error, "Check the project details");
  return r.data;
}

defineApprovalAction({
  name: "convert_lead",
  description:
    "Propose creating a project from a lead: this is how every project in Veenix is created. Find the lead first (search_records), or propose create_lead if there isn't one. Ask for the project name (e.g. \"Rahman Residence, Full Fit-out\") if the user didn't give one. nextStage defaults to site visit. Dates as YYYY-MM-DD, only if stated. address only if the lead has none and the user stated one; otherwise null and the user fills it in on the card.",
  input: convertInput,
  permission: "lead:write",
  deferred: false,
  validate: async (input) => {
    const c = asConvert(input);
    const lead = await LeadModel.findById(input.leadId).lean();
    if (!lead) throw notFound("Lead");
    if (lead.status === "CONVERTED") throw rule(`${lead.name} (${lead.code}) is already a project`);
    // A project needs a full site address: the lead's, or one given here (convert saves it onto the lead).
    const address = c.address ? composeAddress(c.address) : hasStructuredAddress(lead) ? composeAddress(lead) : null;
    const card: Card = {
      title: `Create project ${c.projectName}`,
      lines: [
        { label: "Client", value: `${lead.name} (${lead.code})` },
        { label: "Stage", value: PROJECT_STAGE_LABEL[c.nextStage] },
        { label: "Owner", value: c.projectOwner ?? lead.assignedTo ?? "Not set" },
        ...(c.targetStart ? [{ label: "Target start", value: formatDate(c.targetStart) }] : []),
        ...(c.targetHandover ? [{ label: "Handover", value: formatDate(c.targetHandover) }] : []),
        ...(address ? [{ label: "Site address", value: address }] : []),
      ],
      changes: [],
      missing: address ? [] : ["Site address"],
      inputs: address ? [] : [{ key: "address", label: "Site address", kind: "address" }],
      link: `/leads/${input.leadId}${address ? "" : "?convert=1"}`,
    };
    return card;
  },
  apply: async (input) => {
    const { projectId } = await leads.convert(new Types.ObjectId(input.leadId), asConvert(input));
    const project = (await ProjectModel.findById(projectId).select("code name siteAddress").lean())!;
    await audit("assistant.lead_converted", "project", project._id, { leadId: input.leadId }, project._id);
    return { projectId, siteAddress: project.siteAddress, done: `Project ${project.code} created: ${project.name}.`, link: `/projects/${projectId}` };
  },
});
