import Link from "next/link";
import { CalendarClock, HandCoins, Percent, TrendingUp, Trophy, Users } from "lucide-react";
import type { ReportsDto } from "@veenix/shared";
import { api } from "@/lib/api";
import { cn, formatCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const { leads, deals, sources, margins, vendorSpend } = await api<ReportsDto>("/reports");
  const decided = leads.converted + leads.lost;

  const kpis = [
    { icon: Users, label: "Leads converted", value: `${leads.convertedPct}%`, sub: `${leads.converted} of ${leads.total} leads` },
    { icon: Trophy, label: "Win rate", value: decided > 0 ? `${leads.winRatePct}%` : "—", sub: decided > 0 ? `${leads.converted} won, ${leads.lost} lost` : "No decided leads yet" },
    { icon: HandCoins, label: "Average deal size", value: deals.signedCount > 0 ? formatCurrency(deals.avgDeal) : "—", sub: deals.signedCount > 0 ? `Across ${deals.signedCount} signed jobs` : "Nothing signed yet" },
    { icon: CalendarClock, label: "Avg. lead to signed", value: deals.avgDaysToSign != null ? `${deals.avgDaysToSign} days` : "—", sub: deals.avgDaysToSign != null ? `Across ${deals.daysToSignCount} jobs` : "Not enough data yet" },
  ];

  const maxSourceCount = Math.max(1, ...sources.map((s) => s.count));
  const maxSpend = Math.max(1, ...vendorSpend.map((v) => v.committed));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
        <p className="mt-1 text-muted-foreground">How leads, jobs and vendors are performing, from your real data.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 @7xl:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3.5 shadow-xs">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <k.icon className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <div className="text-xs text-muted-foreground">{k.label}</div>
              <div className="whitespace-nowrap text-xl font-bold tabular-nums">{k.value}</div>
              <div className="text-xs text-muted-foreground">{k.sub}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-5 @5xl:grid-cols-2">
        <section className="rounded-xl border bg-card p-5 shadow-xs">
          <h2 className="mb-1 flex items-center gap-2 font-semibold">
            <TrendingUp className="h-4 w-4 text-primary" />
            Lead source performance
          </h2>
          <p className="mb-4 text-xs text-muted-foreground">Leads received and the share that converted to a project, by source.</p>
          {sources.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No leads yet.</p>
          ) : (
            <ul className="space-y-3.5">
              {sources.map((s) => (
                <li key={s.source}>
                  <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                    <span className="font-medium">{s.source}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {s.count} {s.count === 1 ? "lead" : "leads"} · <span className="font-medium text-foreground">{s.pct}%</span> converted
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${(s.count / maxSourceCount) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border bg-card p-5 shadow-xs">
          <h2 className="mb-1 flex items-center gap-2 font-semibold">
            <HandCoins className="h-4 w-4 text-primary" />
            Vendor spend
          </h2>
          <p className="mb-4 text-xs text-muted-foreground">Purchase order value committed and paid, by vendor.</p>
          {vendorSpend.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No purchase orders yet.</p>
          ) : (
            <ul className="space-y-3.5">
              {vendorSpend.map((v) => (
                <li key={v.id}>
                  <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                    <Link href={`/vendors/${v.id}`} className="font-medium hover:text-primary hover:underline">
                      {v.name}
                    </Link>
                    <span className="tabular-nums text-muted-foreground">
                      {formatCurrency(v.paid)} paid of {formatCurrency(v.committed)}
                    </span>
                  </div>
                  <div className="relative h-2 overflow-hidden rounded-full bg-muted">
                    <div className="absolute inset-y-0 left-0 rounded-full bg-primary/25" style={{ width: `${(v.committed / maxSpend) * 100}%` }} />
                    <div className="absolute inset-y-0 left-0 rounded-full bg-emerald-500" style={{ width: `${(v.paid / maxSpend) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="overflow-hidden rounded-xl border bg-card shadow-xs">
        <div className="border-b px-5 py-4">
          <h2 className="flex items-center gap-2 font-semibold">
            <Percent className="h-4 w-4 text-primary" />
            Project margins
          </h2>
          <p className="text-xs text-muted-foreground">Signed projects, most valuable first.</p>
        </div>
        {margins.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">Nothing signed yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="bg-muted/30 text-left text-xs font-medium text-muted-foreground">
                  <th className="px-5 py-2.5 font-medium">Project</th>
                  <th className="px-2 py-2.5 text-right font-medium">Contract sum (RM)</th>
                  <th className="px-2 py-2.5 text-right font-medium">Direct cost (RM)</th>
                  <th className="px-2 py-2.5 text-right font-medium">Profit (RM)</th>
                  <th className="px-5 py-2.5 text-right font-medium">Margin</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {margins.map((m) => {
                  const good = m.marginPct >= 20;
                  const ok = m.marginPct >= 10;
                  return (
                    <tr key={m.id}>
                      <td className="px-5 py-3">
                        <Link href={`/projects/${m.id}?tab=overview`} className="font-medium hover:text-primary hover:underline">
                          {m.name}
                        </Link>
                      </td>
                      <td className="px-2 py-3 text-right tabular-nums">{formatCurrency(m.contract).replace("RM ", "")}</td>
                      <td className="px-2 py-3 text-right tabular-nums text-muted-foreground">{formatCurrency(m.cost).replace("RM ", "")}</td>
                      <td className="px-2 py-3 text-right tabular-nums">{formatCurrency(m.profit).replace("RM ", "")}</td>
                      <td className="px-5 py-3 text-right">
                        <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", good ? "bg-emerald-100 text-emerald-800" : ok ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800")}>
                          {m.marginPct.toFixed(1)}%
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
