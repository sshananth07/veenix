import { Prisma } from "@prisma/client";

export const projectDetailInclude = {
  workItems: { orderBy: { seq: "asc" } },
  bomItems: { include: { materials: true }, orderBy: { seq: "asc" } },
  rfqs: {
    include: {
      bomItem: true,
      quotes: { include: { vendor: true, revisions: { orderBy: { round: "asc" } } }, orderBy: { requestedAt: "asc" } },
    },
    orderBy: { createdAt: "asc" },
  },
  purchaseOrders: {
    include: { vendor: true, rfq: true, milestones: { orderBy: { seq: "asc" } } },
    orderBy: { issueDate: "asc" },
  },
  quotations: {
    include: {
      lineItems: { orderBy: { seq: "asc" } },
      events: { orderBy: { createdAt: "asc" } },
      terms: { orderBy: { seq: "asc" } },
    },
    orderBy: { revision: "asc" },
  },
  variationOrders: { include: { bomItem: true }, orderBy: { raisedAt: "asc" } },
  milestones: { include: { invoice: true }, orderBy: { seq: "asc" } },
  files: { orderBy: { createdAt: "desc" } },
} satisfies Prisma.ProjectInclude;

export type ProjectDetail = Prisma.ProjectGetPayload<{ include: typeof projectDetailInclude }>;

export const PROJECT_TABS = [
  { key: "overview", label: "Overview" },
  { key: "bom", label: "Work & BOM" },
  { key: "vendors", label: "Vendors" },
  { key: "quotation", label: "Quotation" },
  { key: "variations", label: "Variation Orders" },
  { key: "payments", label: "Payments & Invoices" },
  { key: "files", label: "Files" },
] as const;

export type ProjectTabKey = (typeof PROJECT_TABS)[number]["key"];
