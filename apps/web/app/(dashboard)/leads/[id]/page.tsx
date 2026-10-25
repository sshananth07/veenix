import Link from "next/link";
import {
  Building2,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  FileText,
  Grid2x2,
  Mail,
  MapPin,
  Megaphone,
  MessageCircle,
  Phone,
  Sparkles,
  Target,
  UserRound,
  Wallet,
} from "lucide-react";
import type { LeadDetailDto } from "@veenix/shared";
import { api } from "@/lib/api";
import { addressLines } from "@/lib/address";
import { formatCurrency, formatDateTime, toDateInput } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { BackButton } from "@/components/BackButton";
import { StatusBadge } from "@/components/StatusBadge";
import { ConvertLeadDialog } from "@/components/leads/ConvertLeadDialog";
import { LeadFormDialog } from "@/components/leads/LeadFormDialog";
import { LogActivityForm } from "@/components/leads/LogActivityForm";

export default async function LeadDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { edit?: string } }) {
  const lead = await api<LeadDetailDto>(`/leads/${params.id}`);

  const budget = lead.budgetMin != null && lead.budgetMax != null ? `${formatCurrency(lead.budgetMin)} – ${formatCurrency(lead.budgetMax)}` : null;
  const lines = addressLines(lead);
  const addressText = lines.length ? lines.join("\n") : lead.siteAddress;
  const [assignedName, assignedRole] = (lead.assignedTo ?? "").split(/,| - /).map((s) => s.trim());

  const tiles = [
    { icon: Megaphone, label: "Lead source", value: lead.source },
    { icon: Target, label: "Campaign", value: lead.campaign },
    { icon: UserRound, label: "Assigned to", value: assignedName || null, sub: assignedRole || null },
    { icon: Building2, label: "Property type", value: lead.propertyType },
    { icon: Grid2x2, label: "Built-up area", value: lead.builtUpArea },
    { icon: Wallet, label: "Budget range", value: budget },
    { icon: CalendarDays, label: "Target start date", value: lead.targetStart },
  ];

  return (
    <div className="space-y-5">
      <BackButton fallbackHref="/leads" label="Leads" />

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-4">
          <Avatar name={lead.name} className="h-14 w-14 text-base" />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight">{lead.name}</h1>
              <StatusBadge status={lead.status} />
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Phone className="h-4 w-4" />
                {lead.phone}
              </span>
              {lead.email && (
                <span className="inline-flex items-center gap-1.5">
                  <Mail className="h-4 w-4" />
                  {lead.email}
                </span>
              )}
              {lead.surveyAt && (
                <span className="inline-flex items-center gap-1.5">
                  <CalendarClock className="h-4 w-4" />
                  <span>
                    {formatDateTime(lead.surveyAt).split(",")[0] ?? formatDateTime(lead.surveyAt)}
                    <span className="block text-xs leading-none">Survey date</span>
                  </span>
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <LeadFormDialog
            trigger={
              <Button variant="outline">
                <UserRound className="h-4 w-4" />
                Edit
              </Button>
            }
            lead={{ ...lead, surveyAt: toDateInput(lead.surveyAt) }}
            defaultOpen={searchParams.edit === "1"}
          />
          {lead.project ? (
            <Button asChild>
              <Link href={`/projects/${lead.project.id}`}>Open project</Link>
            </Button>
          ) : (
            <ConvertLeadDialog
              leadId={lead.id}
              assignedTo={lead.assignedTo}
              address={lead}
              legacyAddress={lead.siteAddress}
              carryOver={[
                { label: "Client", value: lead.name },
                { label: "Contact", value: lead.phone },
                { label: "Site address", value: addressText || "Not set" },
                { label: "Property", value: [lead.propertyType, lead.builtUpArea].filter(Boolean).join(", ") || "Not set" },
                { label: "Budget", value: budget ?? "Not set" },
                { label: "Site survey", value: lead.surveyAt ? formatDateTime(lead.surveyAt) : "Not set" },
              ]}
            />
          )}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <section className="rounded-xl border bg-card p-5 shadow-sm">
          <h2 className="mb-4 font-semibold">Lead Details</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {tiles.map((t) => (
              <Tile key={t.label} icon={t.icon} label={t.label} value={t.value} sub={"sub" in t ? t.sub : undefined} />
            ))}
            <div className="rounded-lg border p-3.5 sm:col-span-2">
              <div className="mb-1.5 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <MapPin className="h-4 w-4 text-primary" />
                Site address
              </div>
              {addressText ? (
                <p className="whitespace-pre-line text-sm font-semibold">{addressText}</p>
              ) : (
                <p className="text-sm text-muted-foreground">Not set</p>
              )}
            </div>
          </div>
        </section>

        <section className="flex flex-col rounded-xl border bg-card p-5 shadow-sm">
          <h2 className="mb-4 font-semibold">Activity ({lead.activities.length})</h2>
          <LogActivityForm leadId={lead.id} />
          <ol className="relative mt-5 space-y-5 border-l pl-6">
            {[...lead.activities].reverse().map((a) => {
              const system = a.author === "System";
              const Icon = system ? Sparkles : a.note.toLowerCase().includes("confirm") || a.note.toLowerCase().includes("completed") ? CheckCircle2 : MessageCircle;
              return (
                <li key={a.id} className="relative">
                  <span
                    className={`absolute -left-[31px] flex h-6 w-6 items-center justify-center rounded-full border-2 border-card ${
                      system ? "bg-muted text-muted-foreground" : Icon === CheckCircle2 ? "bg-emerald-100 text-emerald-700" : "bg-primary/10 text-primary"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">{formatDateTime(a.createdAt)}</span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{a.author}</span>
                  </div>
                  <p className="mt-1 text-sm">{a.note}</p>
                </li>
              );
            })}
            {lead.activities.length === 0 && <li className="text-sm text-muted-foreground">No activity logged yet.</li>}
          </ol>
        </section>
      </div>
    </div>
  );
}

function Tile({ icon: Icon, label, value, sub }: { icon: typeof FileText; label: string; value: string | null | undefined; sub?: string | null }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border p-3.5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="truncate text-sm font-semibold">{value || <span className="font-normal text-muted-foreground">Not set</span>}</div>
        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      </div>
    </div>
  );
}
