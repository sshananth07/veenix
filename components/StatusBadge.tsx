import { Badge, type BadgeProps } from "@/components/ui/badge";

const VARIANT_MAP: Record<string, BadgeProps["variant"]> = {
  NEW: "outline",
  CONTACTED: "secondary",
  SITE_SURVEY: "warning",
  QUOTED: "secondary",
  CONVERTED: "success",
  LOST: "destructive",

  SITE_VISIT: "outline",
  QUOTING: "secondary",
  WORK_IN_PROGRESS: "warning",
  COMPLETED: "success",
  CANCELLED: "destructive",

  NOT_SENT: "outline",
  SENT: "secondary",
  QUOTES_IN: "warning",
  PO_ISSUED: "success",

  DRAFT: "outline",
  ISSUED: "secondary",
  PAID: "success",
  SUPERSEDED: "outline",
  INVOICED: "warning",
  PENDING: "outline",

  REVIEW: "warning",
  APPROVED: "secondary",

  VIEWED: "secondary",
  QUESTIONED: "warning",
  ACCEPTED: "success",

  CLIENT_REVIEW: "warning",

  NOT_YET_DUE: "outline",
  AWAITING_PAYMENT: "warning",
  HELD: "secondary",
  PENDING_SIGNOFF: "warning",
};

const LABEL_MAP: Record<string, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  SITE_SURVEY: "Site Survey",
  QUOTED: "Quoted",
  CONVERTED: "Converted",
  LOST: "Lost",

  SITE_VISIT: "Site Visit",
  QUOTING: "Quoting",
  WORK_IN_PROGRESS: "Work in Progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",

  NOT_SENT: "Not Sent",
  SENT: "Sent",
  QUOTES_IN: "Quotes In",
  PO_ISSUED: "PO Issued",

  DRAFT: "Draft",
  ISSUED: "Issued",
  PAID: "Paid",
  SUPERSEDED: "Superseded",
  INVOICED: "Invoiced",
  PENDING: "Pending",

  REVIEW: "Review",
  APPROVED: "Approved",

  VIEWED: "Viewed",
  QUESTIONED: "Questioned",
  ACCEPTED: "Signed",

  CLIENT_REVIEW: "Client Review",

  NOT_YET_DUE: "Not Yet Due",
  AWAITING_PAYMENT: "Awaiting Payment",
  HELD: "Held",
  PENDING_SIGNOFF: "Pending Sign-off",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <Badge variant={VARIANT_MAP[status] ?? "outline"} className={className}>
      {LABEL_MAP[status] ?? status}
    </Badge>
  );
}
