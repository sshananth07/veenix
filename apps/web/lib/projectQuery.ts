export type { ProjectDetailDto as ProjectDetail } from "@veenix/shared";

export const PROJECT_TABS = [
  { key: "overview", label: "Overview" },
  { key: "updates", label: "Updates" },
  { key: "bom", label: "Work & BOM" },
  { key: "vendors", label: "Vendors" },
  { key: "quotation", label: "Quotation" },
  { key: "variations", label: "Variation Orders" },
  { key: "payments", label: "Payments & Invoices" },
  { key: "files", label: "Files" },
] as const;

export type ProjectTabKey = (typeof PROJECT_TABS)[number]["key"];
