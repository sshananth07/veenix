import type { ProjectCore } from "./dto";
import type { Blocker } from "./bom";
import { getPackages } from "./procurement";
import { formatCurrency, formatDate } from "./format";

export type ProjectTabKey = "overview" | "bom" | "vendors" | "quotation" | "variations" | "payments" | "files";

export type Priority = "high" | "medium" | "low";

export type AttentionItem = {
  priority: Priority;
  title: string;
  text: string;
  status: string;
  tab: ProjectTabKey;
  cta: string;
};

export const PRIORITY_ORDER: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

// Everything on a project that is waiting for someone to act, most urgent
// first. Used by the project Overview and the Home screen.
export function getAttention(
  project: ProjectCore,
  readiness: { ready: boolean; blockers: Blocker[] }
): AttentionItem[] {
  const packages = getPackages(project);
  const count = (stage: string) => packages.filter((p) => p.stage === stage).length;
  const signed = project.quotations.find((q) => q.status === "ACCEPTED");
  const draft = project.quotations.find((q) => q.status === "DRAFT");
  const open = project.quotations.find((q) => ["SENT", "VIEWED", "QUESTIONED"].includes(q.status));
  const latest = project.quotations[project.quotations.length - 1];
  const invoicedToPay = project.purchaseOrders.flatMap((p) => p.milestones).filter((m) => m.status === "INVOICED");
  const pendingVos = project.variationOrders.filter((v) => v.status !== "ACCEPTED");
  const items: AttentionItem[] = [];

  if (!signed && !readiness.ready && readiness.blockers.length > 0) {
    const n = readiness.blockers.length;
    items.push({
      priority: "medium",
      title: "Quotation is blocked",
      text: `${n} ${n === 1 ? "thing is" : "things are"} blocking the quotation: ${readiness.blockers[0].message}`,
      status: "Blocked",
      tab: readiness.blockers[0].tab,
      cta: "Fix now",
    });
  }
  if (count("COMPARE") > 0)
    items.push({
      priority: "medium",
      title: "Vendor quotes to compare",
      text: `${count("COMPARE")} ${count("COMPARE") === 1 ? "package has" : "packages have"} vendor quotes ready to accept`,
      status: "Ready to accept",
      tab: "vendors",
      cta: "Compare quotes",
    });
  if (count("REQUEST") > 0)
    items.push({
      priority: "low",
      title: "RFQ needed",
      text: `${count("REQUEST")} outsourced ${count("REQUEST") === 1 ? "package still needs" : "packages still need"} an RFQ`,
      status: "To do",
      tab: "vendors",
      cta: "Request quotes",
    });
  if (invoicedToPay.length > 0)
    items.push({
      priority: "high",
      title: "Vendor invoice to pay",
      text: `${invoicedToPay.length} vendor ${invoicedToPay.length === 1 ? "invoice is" : "invoices are"} ready to pay (${formatCurrency(invoicedToPay.reduce((s, m) => s + m.amount, 0))})`,
      status: "Ready to pay",
      tab: "vendors",
      cta: "Record payment",
    });
  if (readiness.ready && !latest)
    items.push({ priority: "low", title: "Create the quotation", text: "Everything is priced. The quotation can be created.", status: "Ready", tab: "quotation", cta: "Create quotation" });
  const draftTermsOk = draft ? draft.terms.reduce((s, t) => s + t.pct, 0) === 100 : false;
  if (draft && readiness.ready && !draftTermsOk)
    items.push({ priority: "medium", title: "Payment terms missing", text: `Quotation Rev ${draft.revision} needs payment terms before it can be sent`, status: "Needs terms", tab: "quotation", cta: "Set payment terms" });
  else if (draft && readiness.ready)
    items.push({ priority: "low", title: "Quotation ready to send", text: `Quotation Rev ${draft.revision} is drafted and ready to send`, status: "Ready", tab: "quotation", cta: "Review and send" });
  if (open?.status === "QUESTIONED")
    items.push({ priority: "medium", title: "Client question to answer", text: `The client asked a question on Rev ${open.revision}. Reply to them or send a revised quotation.`, status: "Reply due", tab: "quotation", cta: "Reply" });
  else if (open)
    items.push({ priority: "low", title: "Quotation with client", text: `Rev ${open.revision} has been with the client since ${formatDate(open.sentAt)}`, status: "Awaiting client", tab: "quotation", cta: "Open" });
  if (signed && project.milestones.length === 0)
    items.push({ priority: "high", title: "Set up payment schedule", text: "The quotation is signed. Set up the client payment schedule.", status: "To do", tab: "payments", cta: "Set up schedule" });
  for (const m of project.milestones) {
    if (m.status === "AWAITING_PAYMENT" && !m.invoice)
      items.push({ priority: "high", title: "Invoice due", text: `"${m.name}" is due. Generate its invoice.`, status: "Due", tab: "payments", cta: "Generate invoice" });
    if (m.status === "AWAITING_PAYMENT" && m.invoice)
      items.push({ priority: "medium", title: "Payment outstanding", text: `${m.invoice.code} (${formatCurrency(m.amount)}) is awaiting payment from the client`, status: "Awaiting client", tab: "payments", cta: "Open" });
  }
  if (pendingVos.length > 0)
    items.push({ priority: "low", title: "Variation order unsigned", text: `${pendingVos.length} variation ${pendingVos.length === 1 ? "order is" : "orders are"} not signed yet`, status: "Awaiting client", tab: "variations", cta: "Open" });

  return items.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
}
