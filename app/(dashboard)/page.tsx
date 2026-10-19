import Link from "next/link";
import {
  ArrowRight,
  ArrowUp,
  BarChart3,
  CalendarCheck,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  FileText,
  FolderKanban,
  Phone,
  UserRound,
  Users,
  XCircle,
} from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getQuotationReadiness } from "@/lib/bom";
import { getAttention, PRIORITY_ORDER, type Priority } from "@/lib/attention";
import { projectDetailInclude } from "@/lib/projectQuery";
import { quotationTotals } from "@/lib/quotation";
import { LEAD_STATUS_LABEL, LEAD_STATUSES, type LeadStatus } from "@/lib/types";
import { CURRENT_USER } from "@/lib/user";
import { cn, formatCurrency, formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;

type Row = {
  key: string;
  priority: Priority;
  name: string;
  sub: string;
  place: string | null;
  title: string;
  text: string;
  status: string;
  href: string;
};

const PRIORITY_STYLE: Record<Priority, { label: string; dot: string; pill: string }> = {
  high: { label: "High", dot: "bg-red-100 text-red-600", pill: "bg-red-100 text-red-800" },
  medium: { label: "Medium", dot: "bg-amber-100 text-amber-600", pill: "bg-amber-100 text-amber-800" },
  low: { label: "Low", dot: "bg-blue-100 text-blue-600", pill: "bg-blue-100 text-blue-800" },
};

const STATUS_ICON: Record<LeadStatus, typeof UserRound> = {
  NEW: UserRound,
  CONTACTED: Phone,
  SITE_SURVEY: CalendarCheck,
  QUOTED: FileText,
  CONVERTED: CheckCircle2,
  LOST: XCircle,
};

const STATUS_BAR: Record<LeadStatus, string> = {
  NEW: "bg-primary",
  CONTACTED: "bg-primary",
  SITE_SURVEY: "bg-primary",
  QUOTED: "bg-amber-400",
  CONVERTED: "bg-emerald-500",
  LOST: "bg-rose-500",
};

const STATUS_TINT: Record<LeadStatus, string> = {
  NEW: "bg-primary/10 text-primary",
  CONTACTED: "bg-primary/10 text-primary",
  SITE_SURVEY: "bg-primary/10 text-primary",
  QUOTED: "bg-amber-100 text-amber-700",
  CONVERTED: "bg-emerald-100 text-emerald-700",
  LOST: "bg-rose-100 text-rose-700",
};

function greeting(hour: number) {
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

export default async function HomePage() {
  const now = new Date();
  const week = new Date(now.getTime() - 7 * DAY);
  const month = new Date(now.getTime() - 30 * DAY);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const [leads, projects, completed, signedRecently] = await Promise.all([
    prisma.lead.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.project.findMany({ where: { stage: { notIn: ["COMPLETED", "CANCELLED"] } }, include: projectDetailInclude }),
    prisma.project.count({ where: { stage: "COMPLETED" } }),
    prisma.quotation.findMany({ where: { status: "ACCEPTED", acceptedAt: { gte: month } }, include: { lineItems: true } }),
  ]);

  const openLeads = leads.filter((l) => l.status !== "CONVERTED");
  const newLeads = leads.filter((l) => l.createdAt >= week).length;
  const newProjects = projects.filter((p) => p.createdAt >= week).length;
  const contractValue = projects.reduce((s, p) => s + p.contractValue, 0);
  const collected = projects.reduce((s, p) => s + p.milestones.filter((m) => m.status === "PAID").reduce((a, m) => a + m.amount, 0), 0);
  const collectedPct = contractValue > 0 ? Math.round((collected / contractValue) * 100) : 0;
  const signedRecent = signedRecently.reduce((s, q) => s + quotationTotals(q.lineItems).total, 0);

  // Everything waiting on someone, across every active project and open lead.
  const readiness = await Promise.all(projects.map((p) => getQuotationReadiness(p.id)));
  const rows: Row[] = [];
  projects.forEach((p, i) => {
    for (const a of getAttention(p, readiness[i])) {
      rows.push({
        key: `${p.id}-${a.title}-${rows.length}`,
        priority: a.priority,
        name: p.name,
        sub: p.code,
        place: [p.city, p.state].filter(Boolean).join(", ") || p.siteAddress || null,
        title: a.title,
        text: a.text,
        status: a.status,
        href: `/projects/${p.id}?tab=${a.tab}`,
      });
    }
  });
  for (const l of openLeads) {
    const place = [l.city, l.state].filter(Boolean).join(", ") || l.siteAddress || null;
    const base = { name: l.name, sub: l.code, place, href: `/leads/${l.id}` };
    if (l.status === "NEW") {
      rows.push({ ...base, key: `lead-new-${l.id}`, priority: "medium", title: "New lead to contact", text: `Enquiry from ${l.source}. Contact them to qualify the job.`, status: "New" });
    }
    if (l.surveyAt && l.status !== "LOST") {
      if (l.surveyAt < today) {
        rows.push({ ...base, key: `lead-survey-${l.id}`, priority: "high", title: "Site survey date has passed", text: `The survey was on ${formatDate(l.surveyAt)}. Log the outcome or move the lead on.`, status: "Overdue" });
      } else if (l.surveyAt.getTime() - today.getTime() <= 3 * DAY) {
        rows.push({ ...base, key: `lead-survey-${l.id}`, priority: "low", title: "Site survey coming up", text: `Survey scheduled for ${formatDate(l.surveyAt)}.`, status: "Scheduled" });
      }
    }
  }
  rows.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
  const visible = rows.slice(0, 8);

  const leadCount = (s: LeadStatus) => leads.filter((l) => l.status === s).length;

  const kpis = [
    {
      href: "/leads",
      icon: Users,
      tint: "bg-primary/10 text-primary",
      label: "Open leads",
      value: String(openLeads.length),
      trend: newLeads > 0 ? `${newLeads} new in the last 7 days` : "No new leads this week",
      up: newLeads > 0,
    },
    {
      href: "/projects",
      icon: FolderKanban,
      tint: "bg-primary/10 text-primary",
      label: "Active projects",
      value: String(projects.length),
      trend: newProjects > 0 ? `${newProjects} started in the last 7 days` : "None started this week",
      up: newProjects > 0,
    },
    {
      href: "/projects",
      icon: null,
      tint: "bg-primary/10 text-primary",
      label: "Contract value",
      value: formatCurrency(contractValue),
      trend: signedRecent > 0 ? `${formatCurrency(signedRecent)} signed in the last 30 days` : "Nothing signed in the last 30 days",
      up: signedRecent > 0,
    },
    {
      href: "/projects",
      icon: CheckCircle2,
      tint: "bg-emerald-100 text-emerald-700",
      label: "Collected",
      value: formatCurrency(collected),
      trend: contractValue > 0 ? `${collectedPct}% of contract value` : "Nothing invoiced yet",
      up: false,
    },
  ];

  const tiles = [
    { label: "Open leads", value: openLeads.length, delta: newLeads > 0 ? `+${newLeads} this week` : null },
    { label: "Quoted", value: leadCount("QUOTED"), delta: null },
    { label: "Active projects", value: projects.length, delta: newProjects > 0 ? `+${newProjects} this week` : null },
    { label: "Completed", value: completed, delta: null },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {greeting(now.getHours())}, {CURRENT_USER.name}
          </h1>
          <p className="mt-1 text-muted-foreground">Here&apos;s what&apos;s happening with your renovation business today.</p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm text-muted-foreground shadow-sm">
          <CalendarDays className="h-4 w-4" />
          {new Intl.DateTimeFormat("en-MY", { weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(now)}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((k) => (
          <Link
            key={k.label}
            href={k.href}
            className="group flex items-start gap-4 rounded-xl border bg-card p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-full", k.tint)}>
              {k.icon ? <k.icon className="h-6 w-6" /> : <span className="text-sm font-bold">RM</span>}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{k.label}</span>
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                  <ArrowRight className="h-3.5 w-3.5" />
                </span>
              </div>
              <div className="mt-1 whitespace-nowrap text-2xl font-bold tracking-tight tabular-nums">{k.value}</div>
              <div className={cn("mt-1.5 flex items-center gap-1 text-xs", k.up ? "font-medium text-emerald-600" : "text-muted-foreground")}>
                {k.up && <ArrowUp className="h-3.5 w-3.5 shrink-0" />}
                <span>{k.trend}</span>
              </div>
            </div>
          </Link>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.35fr_1fr]">
        <section className="rounded-xl border bg-card p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-600">
              <CircleAlert className="h-5 w-5" />
            </span>
            <div className="flex-1">
              <h2 className="text-lg font-semibold tracking-tight">Needs your attention</h2>
              <p className="text-sm text-muted-foreground">Items that require your action across all projects and leads.</p>
            </div>
            {rows.length > 0 && <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">{rows.length}</span>}
          </div>

          {visible.length === 0 ? (
            <div className="flex flex-col items-center rounded-lg border border-dashed px-4 py-12 text-center">
              <CheckCircle2 className="h-9 w-9 text-emerald-600" />
              <p className="mt-2 font-medium">{leads.length === 0 && projects.length === 0 ? "Nothing here yet" : "All caught up"}</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                {leads.length === 0 && projects.length === 0
                  ? "Add your first lead to get started. Anything that needs action will show up here."
                  : "Nothing is waiting on you right now."}
              </p>
              {leads.length === 0 && projects.length === 0 && (
                <Link href="/leads" className="mt-4 inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
                  Go to Leads
                </Link>
              )}
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <div className="hidden grid-cols-[90px_1.1fr_1.5fr_130px_84px] gap-4 bg-muted/40 px-4 py-2.5 text-xs font-medium text-muted-foreground md:grid">
                <span>Priority</span>
                <span>Project / Lead</span>
                <span>Issue / Task</span>
                <span>Status</span>
                <span className="text-right">Action</span>
              </div>
              <ul className="divide-y">
                {visible.map((r) => {
                  const p = PRIORITY_STYLE[r.priority];
                  return (
                    <li key={r.key} className="grid items-center gap-x-4 gap-y-2 px-4 py-3.5 md:grid-cols-[90px_1.1fr_1.5fr_130px_84px]">
                      <span className="flex items-center gap-2 text-sm font-medium">
                        <span className={cn("flex h-7 w-7 items-center justify-center rounded-full", p.dot)}>
                          <CircleAlert className="h-4 w-4" />
                        </span>
                        <span className="text-xs">{p.label}</span>
                      </span>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold leading-snug">{r.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {r.sub}
                          {r.place ? ` · ${r.place}` : ""}
                        </div>
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium">{r.title}</div>
                        <div className="text-xs text-muted-foreground">{r.text}</div>
                      </div>
                      <span className={cn("w-fit rounded-full px-2.5 py-0.5 text-xs font-medium", p.pill)}>{r.status}</span>
                      <Link
                        href={r.href}
                        className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 md:justify-self-end"
                      >
                        View
                      </Link>
                    </li>
                  );
                })}
              </ul>
              {rows.length > visible.length && (
                <div className="border-t bg-muted/30 px-4 py-2.5 text-center text-xs text-muted-foreground">
                  Showing the {visible.length} most urgent of {rows.length}
                </div>
              )}
            </div>
          )}
        </section>

        <section className="rounded-xl border bg-card p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <BarChart3 className="h-5 w-5" />
            </span>
            <div className="flex-1">
              <h2 className="text-lg font-semibold tracking-tight">Pipeline summary</h2>
              <p className="text-sm text-muted-foreground">Leads → Projects → Completed</p>
            </div>
            <Link href="/leads" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
              View all
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-4">
            {tiles.map((t) => (
              <div key={t.label} className="rounded-lg border px-3 py-2.5">
                <div className="text-xs text-muted-foreground">{t.label}</div>
                <div className="text-2xl font-bold tabular-nums">{t.value}</div>
                <div className={cn("text-xs", t.delta ? "font-medium text-emerald-600" : "text-transparent")}>{t.delta ?? "-"}</div>
              </div>
            ))}
          </div>

          <ul className="mt-4 divide-y rounded-lg border">
            {LEAD_STATUSES.map((s) => {
              const n = leadCount(s);
              const pct = leads.length > 0 ? Math.round((n / leads.length) * 100) : 0;
              const Icon = STATUS_ICON[s];
              return (
                <li key={s} className="flex items-center gap-3 px-3 py-3">
                  <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full", STATUS_TINT[s])}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="font-medium">{LEAD_STATUS_LABEL[s]}</span>
                      <span className="tabular-nums">
                        <span className="font-semibold">{n}</span>
                        <span className="ml-1.5 text-xs text-muted-foreground">({pct}%)</span>
                      </span>
                    </div>
                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                      <div className={cn("h-full rounded-full", STATUS_BAR[s])} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}
