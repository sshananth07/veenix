export type LeadStatus = "NEW" | "CONTACTED" | "SITE_SURVEY" | "QUOTED" | "CONVERTED" | "LOST";

export type ProjectStage = "SITE_VISIT" | "QUOTING" | "WORK_IN_PROGRESS" | "COMPLETED" | "CANCELLED";

export type PoStatus = "ISSUED" | "PAID";

export type PoMilestoneStatus = "PENDING" | "INVOICED" | "PAID";

export type QuotationStatus = "DRAFT" | "SENT" | "VIEWED" | "QUESTIONED" | "ACCEPTED" | "SUPERSEDED";

export type VoStatus = "DRAFT" | "CLIENT_REVIEW" | "ACCEPTED";

export type MilestoneStatus = "NOT_YET_DUE" | "AWAITING_PAYMENT" | "PAID" | "HELD" | "PENDING_SIGNOFF";

export type InvoiceStatus = "ISSUED" | "SENT" | "PAID";

export type PerformedBy = "OUTSOURCED" | "SELF";

export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  SITE_SURVEY: "Site Survey",
  QUOTED: "Quoted",
  CONVERTED: "Converted",
  LOST: "Lost",
};

export const LEAD_STATUSES = Object.keys(LEAD_STATUS_LABEL) as LeadStatus[];

export const PROJECT_STAGE_LABEL: Record<ProjectStage, string> = {
  SITE_VISIT: "Site Visit",
  QUOTING: "Quoting",
  WORK_IN_PROGRESS: "Work in Progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const PROJECT_STAGES: ProjectStage[] = [
  "SITE_VISIT",
  "QUOTING",
  "WORK_IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
];

export const PROPERTY_TYPES = [
  "Condominium / Apartment",
  "Terrace house",
  "Semi-detached (Semi-D)",
  "Bungalow / Detached",
  "Townhouse",
  "Shop lot",
  "Office",
  "Other",
];

export const LEAD_SOURCES = ["Facebook Ads", "Google Ads", "Instagram", "Referral", "Walk-in", "Other"];

// How a line of work is measured. Kept to a short list so quantities stay
// comparable across projects; "lot" is a lump sum (quantity is always 1).
export const WORK_UNIT_GROUPS: { label: string; units: { value: string; hint: string }[] }[] = [
  {
    label: "Area",
    units: [
      { value: "sq ft", hint: "Tiling, painting, flooring, ceiling, wall works" },
      { value: "sq m", hint: "Same as sq ft, measured in metres" },
    ],
  },
  {
    label: "Length",
    units: [
      { value: "ft run", hint: "Kitchen cabinets, countertops, skirting, cornices (length along the wall)" },
      { value: "m run", hint: "Same as ft run, measured in metres" },
    ],
  },
  {
    label: "Count",
    units: [
      { value: "point", hint: "Electrical and plumbing points" },
      { value: "unit", hint: "Doors, windows, fixtures, appliances" },
      { value: "set", hint: "A bundled set, e.g. sanitary set, wardrobe set" },
      { value: "nos", hint: "Any other counted item" },
    ],
  },
  { label: "Time", units: [{ value: "day", hint: "Work priced by the day" }] },
  { label: "Lump sum", units: [{ value: "lot", hint: "One price for the whole job: demolition, a full kitchen package" }] },
];

export const WORK_UNITS = WORK_UNIT_GROUPS.flatMap((g) => g.units.map((u) => u.value));

export const MATERIAL_UNITS = ["sq ft", "sq m", "ft run", "m run", "pcs", "nos", "box", "bag", "kg", "litre", "pail", "roll", "set", "lot"];
