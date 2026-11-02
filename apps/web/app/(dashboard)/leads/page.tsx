import Link from "next/link";
import { ChevronLeft, ChevronRight, Plus, Users } from "lucide-react";
import { LEAD_STATUSES, type LeadListDto } from "@veenix/shared";
import { api } from "@/lib/api";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { LeadFormDialog } from "@/components/leads/LeadFormDialog";
import { LeadRowMenu } from "@/components/leads/LeadRowMenu";
import { LeadSearchFilter } from "@/components/leads/LeadSearchFilter";
import { cn, formatBudget, formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Search = { view?: string; q?: string; page?: string; source?: string; status?: string };

export default async function LeadsPage(props: { searchParams: Promise<Search> }) {
  const searchParams = await props.searchParams;
  const view = searchParams.view === "converted" || searchParams.view === "all" ? searchParams.view : "open";
  const q = (searchParams.q ?? "").trim();
  const page = Math.max(1, Number(searchParams.page) || 1);

  // The API query is strict: only send what is set and valid.
  const params = new URLSearchParams({ view, page: String(page) });
  if (q) params.set("q", q);
  if (searchParams.source) params.set("source", searchParams.source);
  if ((LEAD_STATUSES as readonly string[]).includes(searchParams.status ?? "")) params.set("status", searchParams.status!);
  const d = await api<LeadListDto>(`/leads?${params}`);
  const { leads, total, pages, page: current, pageSize: PAGE_SIZE } = d;
  const { open: openCount, converted: convertedCount, all: allCount } = d.counts;

  const tabs = [
    { key: "open", label: "Open", count: openCount },
    { key: "converted", label: "Converted", count: convertedCount },
    { key: "all", label: "All", count: allCount },
  ];

  // Keeps search and filters when moving between tabs or pages.
  const href = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams();
    const base: Record<string, string | undefined> = { view: searchParams.view, q: searchParams.q, source: searchParams.source, status: searchParams.status, page: searchParams.page };
    for (const [k, v] of Object.entries({ ...base, ...changes })) if (v) next.set(k, v);
    const qs = next.toString();
    return qs ? `/leads?${qs}` : "/leads";
  };

  const from = total === 0 ? 0 : (current - 1) * PAGE_SIZE + 1;
  const to = Math.min(current * PAGE_SIZE, total);
  const pageNumbers = Array.from({ length: pages }, (_, i) => i + 1).filter((n) => n === 1 || n === pages || Math.abs(n - current) <= 1);
  const filtered = !!(q || searchParams.source || searchParams.status);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Leads</h1>
          <p className="mt-1 text-muted-foreground">Capture and manage new leads. Convert them into projects.</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Lead views" className="flex gap-2">
          {tabs.map((tab) => {
            const active = view === tab.key;
            return (
              <Link
                key={tab.key}
                href={href({ view: tab.key === "open" ? null : tab.key, page: null })}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-lg border px-4 py-2 text-sm font-medium shadow-xs transition-colors",
                  active ? "border-primary bg-primary text-primary-foreground" : "bg-card text-foreground hover:bg-muted"
                )}
              >
                {tab.label} ({tab.count})
              </Link>
            );
          })}
        </nav>
        <div className="flex flex-wrap items-center gap-3">
          <LeadSearchFilter />
          <LeadFormDialog
            trigger={
              <Button className="h-10">
                <Plus className="h-4 w-4" />
                New lead
              </Button>
            }
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
        {leads.length === 0 ? (
          <div className="flex flex-col items-center px-4 py-16 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Users className="h-6 w-6" />
            </span>
            <p className="mt-3 font-semibold">{filtered ? "No leads match your search" : allCount === 0 ? "No leads yet" : "No leads here"}</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              {filtered
                ? "Try a different search or clear the filters."
                : allCount === 0
                  ? "Add your first enquiry with New lead. Convert it into a project once it is qualified."
                  : view === "converted"
                    ? "Leads you convert into projects appear here."
                    : "Every lead has been converted."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b bg-muted/30 text-left text-xs font-medium text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Name</th>
                  <th className="px-3 py-3 font-medium">Phone</th>
                  <th className="px-3 py-3 font-medium">Source</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-3 py-3 font-medium">Budget range</th>
                  <th className="px-3 py-3 font-medium">Assigned to</th>
                  <th className="px-3 py-3 font-medium">Survey date</th>
                  <th className="w-12 px-3 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {leads.map((lead) => {
                  const place = [lead.city, lead.state].filter(Boolean).join(", ") || lead.siteAddress?.split(",")[0] || null;
                  const budget = formatBudget(lead.budgetMin, lead.budgetMax);
                  return (
                    <tr key={lead.id} className="transition-colors hover:bg-muted/30">
                      <td className="px-5 py-3.5">
                        <Link href={`/leads/${lead.id}`} className="font-semibold hover:text-primary hover:underline">
                          {lead.name}
                        </Link>
                        {place && <div className="text-xs text-muted-foreground">{place}</div>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3.5">{lead.phone}</td>
                      <td className="px-3 py-3.5">{lead.source}</td>
                      <td className="px-3 py-3.5">
                        <StatusBadge status={lead.status} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-3.5 tabular-nums">{budget ?? <span className="text-muted-foreground">-</span>}</td>
                      <td className="px-3 py-3.5">
                        {lead.assignedTo ? (
                          <span className="flex items-center gap-2">
                            <Avatar name={lead.assignedTo} className="h-7 w-7 text-[11px]" />
                            <span className="whitespace-nowrap">{lead.assignedTo}</span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">Unassigned</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3.5">{lead.surveyAt ? formatDate(lead.surveyAt) : <span className="text-muted-foreground">-</span>}</td>
                      <td className="px-3 py-3.5 text-right">
                        <LeadRowMenu leadId={lead.id} name={lead.name} projectId={lead.project?.id ?? null} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3 text-sm text-muted-foreground">
            <span>
              Showing {from}–{to} of {total} {total === 1 ? "lead" : "leads"}
            </span>
            {pages > 1 && (
              <nav aria-label="Pages" className="flex items-center gap-1.5">
                <PageLink href={href({ page: current > 2 ? String(current - 1) : null })} disabled={current === 1} label="Previous page">
                  <ChevronLeft className="h-4 w-4" />
                </PageLink>
                {pageNumbers.map((n, i) => (
                  <span key={n} className="flex items-center gap-1.5">
                    {i > 0 && n - pageNumbers[i - 1] > 1 && <span className="px-1">…</span>}
                    <PageLink href={href({ page: n === 1 ? null : String(n) })} active={n === current} label={`Page ${n}`}>
                      {n}
                    </PageLink>
                  </span>
                ))}
                <PageLink href={href({ page: String(current + 1) })} disabled={current === pages} label="Next page">
                  <ChevronRight className="h-4 w-4" />
                </PageLink>
              </nav>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function PageLink({
  href,
  label,
  active,
  disabled,
  children,
}: {
  href: string;
  label: string;
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const style = "flex h-8 min-w-8 items-center justify-center rounded-md border px-2 text-sm font-medium transition-colors";
  if (disabled) return <span aria-disabled className={cn(style, "pointer-events-none opacity-40")}>{children}</span>;
  return (
    <Link href={href} aria-label={label} aria-current={active ? "page" : undefined} className={cn(style, active ? "border-primary bg-primary text-primary-foreground" : "bg-card text-foreground hover:bg-muted")}>
      {children}
    </Link>
  );
}
