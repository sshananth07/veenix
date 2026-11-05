import Link from "next/link";
import { ArrowUpRight, CheckCircle2, CircleDollarSign, ClipboardList, FileSignature, FileText, HandCoins, Hammer, Hourglass, Receipt, Sparkles, Truck, UserRound, Users } from "lucide-react";
import type { ProjectDetail, ProjectTabKey } from "@/lib/projectQuery";
import type { BomCost, Blocker } from "@veenix/shared";
import { getAttention, type Priority } from "@/lib/attention";
import { getPackages } from "@/lib/procurement";
import { milestoneCollected, splitSstInclusive } from "@veenix/shared";
import { Avatar } from "@/components/ui/avatar";
import { addressLines } from "@/lib/address";
import { cn, daysBetween, formatCurrency, formatDate } from "@/lib/utils";

const PRIORITY_STYLE: Record<Priority, { label: string; pill: string; icon: string }> = {
  high: { label: "High", pill: "bg-red-100 text-red-800", icon: "bg-red-100 text-red-700" },
  medium: { label: "Medium", pill: "bg-amber-100 text-amber-800", icon: "bg-amber-100 text-amber-700" },
  low: { label: "Low", pill: "bg-blue-100 text-blue-800", icon: "bg-blue-100 text-blue-700" },
};

const TAB_LABEL: Record<ProjectTabKey, string> = {
  overview: "Overview",
  updates: "Updates",
  bom: "Work & BOM",
  vendors: "Vendors",
  quotation: "Quotation",
  variations: "Variation Orders",
  payments: "Payments & Invoices",
  files: "Files",
};

const TAB_ICON: Partial<Record<ProjectTabKey, typeof Hammer>> = {
  bom: Hammer,
  vendors: Truck,
  quotation: FileSignature,
  variations: Receipt,
  payments: HandCoins,
};

function timelineHint(start: Date | null, handover: Date | null) {
  const now = new Date();
  if (start && start > now) return `Starts in ${daysBetween(now, start)} days`;
  if (handover) {
    const left = daysBetween(now, handover);
    return left >= 0 ? `${left} days to handover` : `${Math.abs(left)} days past handover`;
  }
  return null;
}

export function OverviewTab({
  project,
  costs,
  readiness,
}: {
  project: ProjectDetail;
  costs: Record<string, BomCost>;
  readiness: { ready: boolean; blockers: Blocker[]; total: number; priced: number };
}) {
  const packages = getPackages(project);
  const signed = project.quotations.find((q) => q.status === "ACCEPTED");
  const draft = project.quotations.find((q) => q.status === "DRAFT");
  const open = project.quotations.find((q) => ["SENT", "VIEWED", "QUESTIONED"].includes(q.status));
  const latest = project.quotations[project.quotations.length - 1];

  const directCost = Object.values(costs).reduce((s, c) => s + c.cost, 0);
  const collected = project.milestones.reduce((s, m) => s + milestoneCollected(m), 0);
  const revenue = splitSstInclusive(project.contractValue, project.pricing.sstBps).exSst;
  const profit = revenue - directCost;
  const marginPct = revenue > 0 ? (profit / revenue) * 100 : 0;
  const vendorPaid = project.purchaseOrders.flatMap((p) => p.milestones).reduce((s, m) => s + (m.paidAmount ?? 0), 0);
  const vendorCommitted = project.purchaseOrders.reduce((s, p) => s + p.amount, 0);
  const collectedPct = project.contractValue > 0 ? Math.min(100, (collected / project.contractValue) * 100) : 0;
  const outstanding = Math.max(0, project.contractValue - collected);
  const vendorPaidPct = vendorCommitted > 0 ? Math.min(100, (vendorPaid / vendorCommitted) * 100) : 0;
  const hint = timelineHint(project.targetStart, project.targetHandover);
  const budget = project.budgetMin != null && project.budgetMax != null ? `${formatCurrency(project.budgetMin)} to ${formatCurrency(project.budgetMax)}` : null;

  const count = (...stages: string[]) => packages.filter((p) => stages.includes(p.stage)).length;
  const invoicedToPay = project.purchaseOrders.flatMap((p) => p.milestones).filter((m) => m.status === "INVOICED");
  const pendingVos = project.variationOrders.filter((v) => v.status !== "ACCEPTED");
  const awarded = packages.filter((p) => p.po).length;

  const attention = getAttention(project, readiness);

  const quotationProgress = signed ? 100 : open ? (open.status === "SENT" ? 55 : 75) : draft ? 30 : 0;
  const quotationLabel = signed ? `Rev ${signed.revision} signed` : open ? `Rev ${open.revision} with client` : draft ? `Rev ${draft.revision} draft` : "Not created";

  const cards: {
    tab: ProjectTabKey;
    icon: typeof Hammer;
    title: string;
    value: string;
    sub: string;
    progress: number;
    foot: string;
  }[] = [
    {
      tab: "bom",
      icon: Hammer,
      title: "Work & BOM",
      value: `${project.bomItems.length} lines`,
      sub: `${project.workItems.length} work ${project.workItems.length === 1 ? "item" : "items"}`,
      progress: readiness.total > 0 ? (readiness.priced / readiness.total) * 100 : 0,
      foot: `${readiness.priced} of ${readiness.total} priced`,
    },
    {
      tab: "vendors",
      icon: Truck,
      title: "Vendors",
      value: packages.length > 0 ? `${awarded} of ${packages.length} awarded` : "None outsourced",
      sub: vendorCommitted > 0 ? `${formatCurrency(vendorPaid)} paid of ${formatCurrency(vendorCommitted)}` : "No POs yet",
      progress: packages.length > 0 ? (awarded / packages.length) * 100 : 0,
      foot: count("COMPARE") > 0 ? `${count("COMPARE")} to accept` : count("REQUEST") > 0 ? `${count("REQUEST")} need an RFQ` : "On track",
    },
    {
      tab: "quotation",
      icon: FileSignature,
      title: "Quotation",
      value: quotationLabel,
      sub: project.quotations.length > 0 ? `${project.quotations.length} ${project.quotations.length === 1 ? "version" : "versions"}` : "Price everything first",
      progress: quotationProgress,
      foot: signed ? "Final, attached to project" : "Draft, send, sign",
    },
    {
      tab: "variations",
      icon: Receipt,
      title: "Variation orders",
      value: `${project.variationOrders.length} raised`,
      sub: pendingVos.length > 0 ? `${pendingVos.length} awaiting signature` : signed ? "None pending" : "Opens after signing",
      progress: project.variationOrders.length > 0 ? ((project.variationOrders.length - pendingVos.length) / project.variationOrders.length) * 100 : 0,
      foot: formatCurrency(project.variationOrders.filter((v) => v.status === "ACCEPTED").reduce((s, v) => s + v.amount, 0)) + " approved",
    },
    {
      tab: "payments",
      icon: HandCoins,
      title: "Client payments",
      value: `${project.milestones.filter((m) => m.status === "PAID").length} of ${project.milestones.length} paid`,
      sub: project.milestones.length > 0 ? `${formatCurrency(collected)} collected` : "No schedule yet",
      progress: collectedPct,
      foot: project.contractValue > 0 ? `${collectedPct.toFixed(0)}% of contract` : "Set after signing",
    },
  ];

  const lines = addressLines(project);
  const addressText = lines.length >= 3 ? `${lines.slice(0, -2).join(", ")}\n${lines.slice(-2).join(", ")}` : project.siteAddress || "No site address";

  const details: { label: string; value: string; hint?: string | null }[] = [
    { label: "Property type", value: [project.propertyType, project.builtUpArea].filter(Boolean).join(", ") || "Not set" },
    { label: "Address", value: addressText },
    { label: "Client name", value: project.clientName },
    { label: "Phone number", value: project.clientPhone || "Not saved" },
    ...(project.clientEmail ? [{ label: "Email", value: project.clientEmail }] : []),
    { label: "Project start date", value: project.targetStart ? formatDate(project.targetStart) : "Not set", hint: project.targetStart ? hint : null },
    { label: "Estimated completion", value: project.targetHandover ? formatDate(project.targetHandover) : "Not set", hint: !project.targetStart ? hint : null },
    ...(project.surveyAt ? [{ label: "Site survey", value: formatDate(project.surveyAt) }] : []),
    ...(budget ? [{ label: "Client budget", value: budget }] : []),
    ...(project.campaign ? [{ label: "Campaign", value: project.campaign }] : []),
    { label: "Project code", value: project.code, hint: `Created ${formatDate(project.createdAt)}` },
  ];

  const team = [
    { name: project.pmName, role: "Project manager", tag: "PM", empty: "No PM assigned" },
    { name: project.siteName, role: "Site supervisor", tag: "Site", empty: "Not assigned" },
  ];

  return (
    <div className="space-y-6">
      {/* Two columns first: three only once the financial card has room for its three figures side by side. */}
      <div className="grid gap-5 @5xl:grid-cols-2 @[82rem]:grid-cols-3">
        <Card title="Project details" icon={FileText}>
          <dl className="space-y-4 text-sm">
            {details.map((d) => (
              <div key={d.label} className="grid grid-cols-[130px_1fr] gap-3">
                <dt className="text-muted-foreground">{d.label}</dt>
                <dd className="min-w-0 wrap-break-word font-medium">
                  <span className="whitespace-pre-line">{d.value}</span>
                  {d.hint && <span className="block text-xs font-normal text-muted-foreground">{d.hint}</span>}
                </dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card title="Financial summary" icon={CircleDollarSign}>
          <dl className="grid grid-cols-3 divide-x rounded-lg bg-muted/40 py-3 text-sm">
            <Stat label="Contract value" value={project.contractValue > 0 ? formatCurrency(project.contractValue) : "Not signed"} hint={`incl. ${project.pricing.sstBps / 100}% SST`} muted={project.contractValue === 0} />
            <Stat label="Direct cost" value={formatCurrency(directCost)} hint="vendors, labour, materials" />
            <Stat
              label="Gross profit"
              value={project.contractValue > 0 ? formatCurrency(profit) : "Not signed"}
              hint={project.contractValue > 0 ? `${marginPct.toFixed(0)}% margin, before SST` : "before SST"}
              muted={project.contractValue === 0}
              good={project.contractValue > 0 && profit >= 0}
            />
          </dl>

          <div className="mt-4 divide-y text-sm">
            <Meter
              icon={CircleDollarSign}
              tone="good"
              label="Client paid"
              detail={project.contractValue > 0 ? `${formatCurrency(collected)} / ${formatCurrency(project.contractValue)}` : "No schedule yet"}
              pct={collectedPct}
              showPct={project.contractValue > 0}
              color="bg-primary"
            />
            <Meter
              icon={Hourglass}
              tone="warn"
              label="Client outstanding"
              detail={project.contractValue > 0 ? `${formatCurrency(outstanding)} / ${formatCurrency(project.contractValue)}` : "Set once signed"}
              pct={project.contractValue > 0 ? 100 - collectedPct : 0}
              showPct={project.contractValue > 0}
              color="bg-amber-400"
            />
            <Meter
              icon={CheckCircle2}
              tone="good"
              label="Vendors paid"
              detail={vendorCommitted > 0 ? `${formatCurrency(vendorPaid)} / ${formatCurrency(vendorCommitted)}` : "No purchase orders yet"}
              pct={vendorPaidPct}
              showPct={vendorCommitted > 0}
              color="bg-primary"
            />
          </div>

          <div className="mt-5 flex items-start gap-3 rounded-lg bg-primary/5 px-4 py-3">
            <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div className="text-sm">
              <div className="font-semibold">{signed ? (collectedPct >= 100 ? "Fully collected" : "Contract signed") : "Waiting for a signed quotation"}</div>
              <p className="text-muted-foreground">
                {signed
                  ? collectedPct >= 100
                    ? "The client has paid the full contract sum."
                    : `${collectedPct.toFixed(0)}% of the contract is collected. ${formatCurrency(outstanding)} is still to come.`
                  : "Contract value, profit and collections fill in once the client signs."}
              </p>
            </div>
          </div>
        </Card>

        <div className="grid content-start gap-5 @5xl:col-span-2 @5xl:grid-cols-2 @[82rem]:col-span-1 @[82rem]:grid-cols-1">
          <Card title="Next actions" icon={ClipboardList} aside={attention.length > 0 ? `${attention.length}` : undefined}>
            {attention.length === 0 ? (
              <div className="flex flex-col items-center px-2 py-6 text-center">
                <CheckCircle2 className="h-8 w-8 text-emerald-600" />
                <p className="mt-2 font-medium">All caught up</p>
                <p className="text-sm text-muted-foreground">Nothing is waiting on you right now.</p>
              </div>
            ) : (
              <ul className="-my-1 divide-y">
                {attention.slice(0, 6).map((a, i) => {
                  const Icon = TAB_ICON[a.tab] ?? ClipboardList;
                  return (
                    <li key={i}>
                      <Link
                        href={`/projects/${project.id}?tab=${a.tab}`}
                        replace
                        scroll={false}
                        className="-mx-2 flex items-start gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-muted/50"
                      >
                        <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", PRIORITY_STYLE[a.priority].icon)}>
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1 text-sm">
                          <span className="block font-medium leading-snug">{a.text}</span>
                          <span className="text-xs text-muted-foreground">
                            {TAB_LABEL[a.tab]} · <span className="font-medium text-primary">{a.cta}</span>
                          </span>
                        </span>
                        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", PRIORITY_STYLE[a.priority].pill)}>
                          {PRIORITY_STYLE[a.priority].label}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card title="Project team" icon={Users}>
            <ul className="space-y-3">
              {team.map((t) => (
                <li key={t.role} className="flex items-center gap-3">
                  {t.name ? <Avatar name={t.name} className="h-9 w-9" /> : <span className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-muted-foreground"><UserRound className="h-4 w-4" /></span>}
                  <div className="min-w-0 flex-1">
                    <div className={cn("text-sm font-medium", !t.name && "text-muted-foreground")}>{t.name || t.empty}</div>
                    <div className="text-xs text-muted-foreground">{t.role}</div>
                  </div>
                  {t.name && <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">{t.tag}</span>}
                </li>
              ))}
              <li className="flex items-center gap-3">
                <Avatar name={project.clientName} className="h-9 w-9 bg-muted text-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{project.clientName}</div>
                  <div className="text-xs text-muted-foreground">Client</div>
                </div>
                <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800">Client</span>
              </li>
            </ul>
          </Card>
        </div>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Where things stand</h2>
        <div className="grid gap-3 sm:grid-cols-2 @5xl:grid-cols-3 @7xl:grid-cols-5">
          {cards.map((c) => (
            <Link
              key={c.tab}
              href={`/projects/${project.id}?tab=${c.tab}`}
              replace
              scroll={false}
              className="group flex flex-col rounded-xl border bg-card p-4 shadow-xs transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex items-center justify-between">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <c.icon className="h-4 w-4" />
                </span>
                <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary" />
              </div>
              <div className="mt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">{c.title}</div>
              <div className="text-lg font-semibold tracking-tight">{c.value}</div>
              <div className="text-sm text-muted-foreground">{c.sub}</div>
              <div className="mt-3">
                <Bar value={c.progress} tone="primary" />
                <div className="mt-1.5 text-xs text-muted-foreground">{c.foot}</div>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

function Card({ title, icon: Icon, aside, children }: { title: string; icon: typeof Hammer; aside?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-card p-5 shadow-xs">
      <div className="mb-5 flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </span>
        <h2 className="flex-1 text-base font-semibold tracking-tight">{title}</h2>
        {aside && <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value, hint, muted, good }: { label: string; value: string; hint?: string; muted?: boolean; good?: boolean }) {
  return (
    <div className="min-w-0 px-4">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("mt-1 whitespace-nowrap text-base font-semibold tabular-nums leading-tight", muted && "font-medium text-muted-foreground", good && "text-emerald-700")}>{value}</dd>
      {hint && <div className="mt-0.5 text-[11px] leading-tight text-muted-foreground">{hint}</div>}
    </div>
  );
}

function Meter({
  icon: Icon,
  tone,
  label,
  detail,
  pct,
  showPct,
  color,
}: {
  icon: typeof Hammer;
  tone: "good" | "warn";
  label: string;
  detail: string;
  pct: number;
  showPct: boolean;
  color: string;
}) {
  return (
    <div className="flex items-start gap-3 py-3.5 first:pt-1">
      <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full", tone === "good" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700")}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-medium">{label}</span>
          {showPct && <span className="text-xs tabular-nums text-muted-foreground">{Math.round(pct)}%</span>}
        </div>
        <div className="text-xs tabular-nums text-muted-foreground">{detail}</div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
          <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
        </div>
      </div>
    </div>
  );
}

function Bar({ value, tone }: { value: number; tone: "primary" | "good" | "muted" }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn("h-full rounded-full transition-all", tone === "good" ? "bg-emerald-500" : tone === "muted" ? "bg-slate-400" : "bg-primary")} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}
