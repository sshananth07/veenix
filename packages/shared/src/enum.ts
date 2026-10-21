export const LEAD_STATUSES =["NEW", "CONTACTED", "SITE_SURVEY", "QUOTED", "CONVERTED", "LOST"] as const; 
export type LeadStatus = (typeof LEAD_STATUSES)[number]; 

export const PROJECT_STAGES = ["SITE_VISIT", "QUOTING",
"WORK_IN_PROGRESS", "COMPLETED", "CANCELLED"] as const; 
export type ProjectStage = (typeof PROJECT_STAGES)[number];

export const PO_STATUSES = ["ISSUED", "PAID"] as const; 
export type PoStatus = (typeof PO_STATUSES)[number];

export const PO_MILESTONE_STATUSES = ["PENDING", "INVOICED", "PAID"] as const;
export type PoMilestoneStatus = (typeof PO_MILESTONE_STATUSES)[number];

export const QUOTATION_STATUSES = ["DRAFT", "SENT", "VIEWED", "QUESTIONED", "ACCEPTED", "SUPERSEDED"] as const; 
export type QuotationStatus = (typeof QUOTATION_STATUSES)[number];
/** versions that are with the client and waiting on them.  */
export const OPEN_QUOTATION_STATUSES: readonly QuotationStatus[] = ["SENT", "VIEWED", "QUESTIONED"];

export const VO_STATUSES = ["DRAFT", "CLIENT_REVIEW", "ACCEPTED"] as const;
export type VoStatus = (typeof VO_STATUSES)[number];

export const MILESTONE_STATUSES = ["NOT_YET_DUE", "AWAITTING_PAYMENT", "PAID", "HELD", "PENDING_SIGNOFF"] as const; 
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number]; 

export const INVOICE_STATUSES = ["ISSUED", "SENT", "PAID"] as const; 
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number]; 

export const PERFORMED_BY = ["OUTSOURCED", "SELF"] as const; 
export type PerformedBy = (typeof PERFORMED_BY)[number]; 

export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
    NEW: "New", 
    CONTACTED: "Contacted", 
    SITE_SURVEY: "Site Survey", 
    QUOTED: "Quoted", 
    CONVERTED: "Converted",
    LOST: "Lost",
}

export const PROJECT_STAGE_LABEL: Record<ProjectStage, string> = {
  SITE_VISIT: "Site Visit",
  QUOTING: "Quoting",
  WORK_IN_PROGRESS: "Work in Progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

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

export const VO_REASONS = ["Client request", "Design change", "Site condition", "Additional scope", "Other"]; 

// --- uploads (rules moved from apps/web/lib/uploads.ts) ---

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const CONTENT_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export const UPLOAD_PURPOSES = ["quotes", "invoices", "photos", "vo", "files", "logos"] as const;
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

const IMAGE_EXT = [".png", ".jpg", ".jpeg", ".webp"];
const DOCUMENT_EXT = [".pdf", ...IMAGE_EXT];

export const UPLOAD_RULES: Record<UploadPurpose, { exts: string[]; label: string }> = {
  quotes: { exts: DOCUMENT_EXT, label: "Upload a PDF, PNG, JPG or WEBP file" },
  invoices: { exts: DOCUMENT_EXT, label: "Upload a PDF, PNG, JPG or WEBP file" },
  vo: { exts: DOCUMENT_EXT, label: "Upload a PDF, PNG, JPG or WEBP file" },
  photos: { exts: IMAGE_EXT, label: "Upload a PNG, JPG or WEBP image" },
  logos: { exts: IMAGE_EXT, label: "Upload a PNG, JPG or WEBP image" },
  files: { exts: Object.keys(CONTENT_TYPES), label: "Upload a PDF, image, Word or Excel file" },
};