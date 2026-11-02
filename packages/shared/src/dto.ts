import type { AttentionItem } from "./attention";
import type { BomCost, Readiness } from "./bom";
import type {
  InvoiceStatus, LeadStatus, MilestoneStatus, PerformedBy, PoMilestoneStatus, PoStatus,
  ProjectStage, QuotationStatus, VoStatus,
} from "./enums";
import type { Sen } from "./money";
import type { Role } from "./permissions";
import type { QuotationTotals } from "./quotation";

export type Id = string;

// ---- Leads -------------------------------------------------------------------
export interface LeadActivityDto { id: Id; note: string; author: string; authorId: Id | null; createdAt: Date }
export interface LeadDto {
  id: Id; code: string; name: string; phone: string; email: string | null; source: string; campaign: string | null;
  propertyType: string | null; builtUpArea: string | null; budgetMin: Sen | null; budgetMax: Sen | null;
  addressLine1: string | null; addressLine2: string | null; addressLine3: string | null; postcode: string | null;
  city: string | null; state: string | null; siteAddress: string | null; targetStart: string | null;
  assignedTo: string | null; status: LeadStatus; surveyAt: Date | null; createdAt: Date;
}
export interface LeadDetailDto extends LeadDto { activities: LeadActivityDto[]; project: { id: Id; code: string; name: string } | null }
export interface LeadListDto {
  leads: (LeadDto & { project: { id: Id } | null })[];
  counts: { open: number; converted: number; all: number };
  total: number; page: number; pages: number; pageSize: number;
}

// ---- Vendors -----------------------------------------------------------------
export interface VendorDto {
  id: Id; name: string; type: string | null; registrationNo: string | null; contactPerson: string | null;
  phone: string | null; email: string | null; location: string | null; experienceYears: number | null;
  active: boolean; jobsCount: number; notes: string | null;
}

/** GET /v1/org/einvoice (null until saved once). Secrets are never returned, only whether they are stored. */
export interface EinvoiceSettingsDto {
  enabled: boolean; environment: "preprod" | "prod"; tin: string; brn: string; sstNo: string | null; msicCode: string; businessActivity: string;
  phone: string; addressLine1: string; addressLine2: string | null; addressLine3: string | null; postcode: string; city: string; state: string;
  clientId: string; hasClientSecret: boolean; hasCertificate: boolean; certificateSubject: string | null; certificateExpiresAt: Date | null;
}

// ---- Projects and BOM --------------------------------------------------------
export interface AssigneeDto { userId: Id; role: "project_manager" | "site_staff"; name: string; email: string }
export interface ProjectDto {
  id: Id; code: string; name: string; clientName: string; clientPhone: string | null; clientEmail: string | null;
  clientTin: string | null; clientIdType: "NRIC" | "PASSPORT" | "BRN" | "ARMY" | null; clientIdNo: string | null;
  addressLine1: string | null; addressLine2: string | null; addressLine3: string | null; postcode: string | null;
  city: string | null; state: string | null; siteAddress: string; propertyType: string | null; builtUpArea: string | null;
  budgetMin: Sen | null; budgetMax: Sen | null; campaign: string | null; surveyAt: Date | null; photoPath: string | null;
  contractValue: Sen; targetStart: Date | null; targetHandover: Date | null; pmName: string | null; siteName: string | null;
  stage: ProjectStage; stageEnteredAt: Date; cancelReason: string | null; createdAt: Date; leadId: Id | null;
  assignees: AssigneeDto[];
}
export interface WorkItemDto { id: Id; seq: number; name: string; description: string | null }
export interface BomMaterialDto { id: Id; name: string; qty: number; unit: string; unitCost: Sen; total: Sen }
export interface BomItemDto {
  id: Id; workItemId: Id | null; seq: number; workPackage: string; description: string | null; qty: number; unit: string;
  unitCost: Sen; estTotal: Sen; performedBy: PerformedBy; materials: BomMaterialDto[]; awarded: { poId: Id; amount: Sen } | null;
}

// ---- Procurement -------------------------------------------------------------
export interface RfqQuoteRevisionDto {
  id: Id; round: number; quotedPrice: Sen; leadTimeDays: number; warrantyMonths: number; notes: string | null;
  attachmentPath: string | null; attachmentName: string | null; receivedAt: Date; createdAt: Date;
}
export interface RfqQuoteDto {
  id: Id; rfqId: Id; vendorId: Id; requestedAt: Date; receivedAt: Date | null; quotedPrice: Sen; leadTimeDays: number;
  warrantyMonths: number; notes: string | null; attachmentPath: string | null; attachmentName: string | null; selected: boolean;
  revisions: RfqQuoteRevisionDto[];
}
export interface RfqDto { id: Id; code: string; projectId: Id; bomItemId: Id; quantity: string; respondBy: Date | null; note: string | null; createdAt: Date }
export interface PoMilestoneDto {
  id: Id; poId: Id; seq: number; label: string; pct: number; amount: Sen; status: PoMilestoneStatus; invoiceNo: string | null;
  invoiceDate: Date | null; invoicePath: string | null; invoiceName: string | null; paidAmount: Sen | null; paidDate: Date | null;
  method: string | null; bankRef: string | null; paidFrom: string | null;
}
export interface PurchaseOrderDto {
  id: Id; code: string; projectId: Id; rfqId: Id | null; vendorId: Id; description: string; qty: string; amount: Sen;
  issueDate: Date; deliveryBy: Date | null; remarks: string | null; status: PoStatus;
}

// ---- Quotations, VOs, billing, files -----------------------------------------
export interface QuotationLineDto {
  id: Id; bomItemId: Id | null; workItemName: string | null; workPackage: string; qty: number; unit: string;
  bomCost: Sen; markupPct: number; clientPrice: Sen; seq: number;
}
export interface QuotationTermDto { id: Id; seq: number; name: string; trigger: string; pct: number }
export interface QuotationEventDto { id: Id; type: string; note: string | null; createdAt: Date }
export interface QuotationDto {
  id: Id; code: string; revision: number; projectId: Id; status: QuotationStatus; createdAt: Date; sentAt: Date | null;
  viewedAt: Date | null; acceptedAt: Date | null; signedBy: string | null;
}
export interface VariationOrderDto {
  id: Id; code: string; projectId: Id; title: string | null; description: string; reason: string | null; raisedBy: string | null;
  amount: Sen; status: VoStatus; raisedAt: Date; bomItemId: Id | null; programmeImpact: string | null;
  attachmentPath: string | null; attachmentName: string | null;
}
export interface PaymentMilestoneDto { id: Id; projectId: Id; seq: number; name: string; trigger: string; pct: number | null; amount: Sen; status: MilestoneStatus }
export interface InvoiceDto {
  id: Id; code: string; milestoneId: Id; invoiceDate: Date; dueDate: Date | null; amount: Sen; sstAmount: Sen; status: InvoiceStatus;
  eInvoiceStatus: "NOT_SUBMITTED" | "SUBMITTED" | "VALID" | "INVALID" | "CANCELLED";
  eInvoiceUuid: string | null; eInvoiceValidatedAt: Date | null;
  /** LHDN's public validation link (also the QR code's content), once VALID. */
  eInvoiceUrl: string | null; eInvoiceErrors: string[] | null;
}
export interface ProjectFileDto { id: Id; projectId: Id; name: string; path: string; size: number; contentType: string; createdAt: Date }

// ---- Composites --------------------------------------------------------------
/** The project page payload, without the computed fields. Pure functions (attention, procurement) take this. */
export interface ProjectCore extends ProjectDto {
  workItems: WorkItemDto[];
  bomItems: BomItemDto[];
  rfqs: (RfqDto & { bomItem: BomItemDto; quotes: (RfqQuoteDto & { vendor: VendorDto })[] })[];
  purchaseOrders: (PurchaseOrderDto & { vendor: VendorDto; rfq: RfqDto | null; milestones: PoMilestoneDto[] })[];
  quotations: (QuotationDto & { lineItems: QuotationLineDto[]; events: QuotationEventDto[]; terms: QuotationTermDto[]; totals: QuotationTotals; termAmounts: Sen[] })[];
  variationOrders: (VariationOrderDto & { bomItem: BomItemDto | null })[];
  milestones: (PaymentMilestoneDto & { invoice: InvoiceDto | null })[];
  files: ProjectFileDto[];
}
/** GET /v1/projects/:id */
export interface ProjectDetailDto extends ProjectCore {
  costs: Record<Id, BomCost>;
  readiness: Readiness;
  attention: AttentionItem[];
  pricing: { defaultMarkupPct: number; minMarkupPct: number; sstBps: number };
  einvoiceEnabled: boolean;
}
/** GET /v1/projects */
export type ProjectListItemDto = ProjectDto & { milestones: PaymentMilestoneDto[]; purchaseOrders: PurchaseOrderDto[] };

/** GET /v1/vendors */
export interface VendorListDto { vendors: (VendorDto & { purchaseOrders: PurchaseOrderDto[] })[]; trades: string[] }
/** GET /v1/vendors/:id */
export interface VendorDetailDto extends VendorDto {
  purchaseOrders: (PurchaseOrderDto & { project: ProjectDto; rfq: (RfqDto & { bomItem: BomItemDto | null }) | null; milestones: PoMilestoneDto[] })[];
  rfqQuotes: (RfqQuoteDto & { rfq: RfqDto & { project: ProjectDto; bomItem: BomItemDto | null } })[];
}

// ---- Organization, members, me -----------------------------------------------
export interface OrgDto {
  id: Id; companyName: string; companyReg: string; companyAddress: string; companyPhone: string; logoPath: string | null;
  bankName: string; bankAccountName: string; bankAccount: string; swiftCode: string | null;
  defaultMarkupPct: number; minMarkupPct: number; sstBps: number;
}
export interface MeDto {
  user: { id: Id; name: string; email: string; platformRole: "superadmin" | null };
  memberships: { orgId: Id; companyName: string; role: Role }[];
}
export interface MemberDto { id: Id; userId: Id; name: string; email: string; role: Role; createdAt: Date }
export interface InvitationDto { id: Id; email: string; role: Role; expiresAt: Date; createdAt: Date }

// ---- Dashboard, reports, search ----------------------------------------------
export interface DashboardRowDto {
  key: string; priority: "high" | "medium" | "low"; name: string; sub: string; place: string | null;
  title: string; text: string; status: string;
  target: { kind: "project"; id: Id; tab: string } | { kind: "lead"; id: Id };
}
export interface DashboardDto {
  userName: string;
  kpis: {
    openLeads: number; newLeads7d: number; activeProjects: number; newProjects7d: number;
    contractValue: Sen; signedLast30d: Sen; collected: Sen; collectedPct: number; quotedLeads: number; completedProjects: number;
  };
  leadCounts: Record<LeadStatus, number>;
  rows: DashboardRowDto[];
  /** All rows waiting on someone; `rows` holds the most urgent 8. */
  rowsTotal: number;
}
export interface ReportsDto {
  leads: { total: number; converted: number; lost: number; convertedPct: number; winRatePct: number };
  deals: { signedCount: number; avgDeal: Sen; avgDaysToSign: number | null; daysToSignCount: number };
  sources: { source: string; count: number; won: number; pct: number }[];
  margins: { id: Id; name: string; cost: Sen; contract: Sen; profit: Sen; marginPct: number }[];
  vendorSpend: { id: Id; name: string; jobs: number; committed: Sen; paid: Sen }[];
}
export interface SearchResultDto { kind: "lead" | "project" | "vendor" | "quotation" | "po" | "invoice"; refId: Id; projectId: Id | null; title: string; subtitle: string }

// ---- Site updates and tasks --------------------------------------------------
export interface SiteUpdateDto {
  id: Id; projectId: Id; kind: "progress" | "issue" | "material_request" | "delivery"; text: string;
  photos: { path: string; name: string }[]; authorName: string; fromAssistant: boolean; createdAt: Date;
}
export interface TaskDto {
  id: Id; title: string; status: "open" | "done"; dueAt: Date | null; assigneeId: Id | null; assigneeName: string | null;
  projectId: Id | null; projectName: string | null; leadId: Id | null; createdAt: Date;
}
