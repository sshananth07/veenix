import { Building2, CreditCard, Percent, ShieldCheck, User } from "lucide-react";
import type { OrgDto } from "@veenix/shared";
import { api } from "@/lib/api";
import { EditBankDetailsDialog } from "@/components/settings/EditBankDetailsDialog";
import { EditLetterheadDialog } from "@/components/settings/EditLetterheadDialog";
import { MarkupSettingsCard } from "@/components/settings/MarkupSettingsCard";

export const dynamic = "force-dynamic";

const NAV = [
  { href: "#letterhead", label: "Company Profile", icon: Building2 },
  { href: "#bank", label: "Bank Details", icon: CreditCard },
  { href: "#markup", label: "Default Markup", icon: Percent },
  { href: "#markup", label: "Minimum Markup", icon: Percent },
  { href: "#users", label: "Users & Permissions", icon: User },
];

export default async function SettingsPage() {
  const settings = await api<OrgDto>("/org");

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="mt-1 text-muted-foreground">Manage your company information and default settings.</p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[220px_1fr]">
        <nav aria-label="Settings sections" className="h-fit rounded-xl border bg-card p-2 shadow-sm">
          <ul className="space-y-1">
            {NAV.map((item, i) => (
              <li key={item.label + i}>
                <a href={item.href} className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="grid gap-5">
          <section id="letterhead" className="grid gap-5 rounded-xl border bg-card p-5 shadow-sm md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
            <div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="flex items-center gap-2 font-semibold">
                  <Building2 className="h-4 w-4 text-primary" />
                  Company letterhead
                </h2>
                <EditLetterheadDialog settings={settings} />
              </div>
              <div className="max-w-sm rounded-lg border bg-muted/20 p-4">
                <div className="flex items-center gap-2 text-primary">
                  {settings.logoPath ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/uploads/logo/default?v=${encodeURIComponent(settings.logoPath)}`} alt="" className="h-7 w-7 rounded object-cover" />
                  ) : (
                    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M3 11.5 12 4l9 7.5" />
                      <path d="M5.5 10v9.5h13V10" />
                      <path d="m9 19.5 3-6 3 6" />
                    </svg>
                  )}
                  <span className="text-base font-bold">Veenix</span>
                </div>
                <div className="mt-3 space-y-0.5 text-xs text-muted-foreground">
                  <p className="text-sm font-semibold text-foreground">{settings.companyName}</p>
                  <p>{settings.companyReg}</p>
                  <p>{settings.companyAddress}</p>
                  <p>{settings.companyPhone}</p>
                </div>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">This is how your details appear at the top of every PDF.</p>
            </div>
          </section>

          <section id="bank" className="rounded-xl border bg-card p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 font-semibold">
                <CreditCard className="h-4 w-4 text-primary" />
                Bank details
              </h2>
              <EditBankDetailsDialog settings={settings} />
            </div>
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <Detail label="Bank name" value={settings.bankName} />
              <Detail label="Account name" value={settings.bankAccountName} />
              <Detail label="Account number" value={settings.bankAccount} />
              <Detail label="Swift code" value={settings.swiftCode} />
            </dl>
          </section>

          <div id="markup">
            <MarkupSettingsCard settings={settings} />
          </div>

          <section id="users" className="rounded-xl border border-dashed bg-card p-5 text-center">
            <ShieldCheck className="mx-auto h-7 w-7 text-muted-foreground" />
            <h2 className="mt-2 font-semibold">Users &amp; Permissions</h2>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">Not built yet — the app has no login, so everyone shares one account for now.</p>
          </section>
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium">{value || <span className="font-normal text-muted-foreground">Not set</span>}</div>
    </div>
  );
}
