import { Download, HandCoins, Hourglass, Inbox, ListChecks, PackageCheck } from "lucide-react";
import type { ProjectDetail } from "@/lib/projectQuery";
import { can, type VendorListDto } from "@veenix/shared";
import { api } from "@/lib/api";
import { requireOrg } from "@/lib/session";
import { getPackages } from "@/lib/procurement";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { AwardedVendors } from "@/components/projects/vendors/AwardedVendors";
import { InvitedVendorsTable } from "@/components/projects/vendors/InvitedVendorsTable";
import { PackageSummaryCard } from "@/components/projects/vendors/PackageSummaryCard";

export async function VendorsTab({ project }: { project: ProjectDetail }) {
  // The vendor picker. Roles without vendor:read (site staff) still see the packages, just not the full vendor list.
  const { role } = await requireOrg();
  const vendors = can(role, "vendor:read") ? (await api<VendorListDto>("/vendors")).vendors : [];

  const packages = getPackages(project);
  const count = (...stages: string[]) => packages.filter((p) => stages.includes(p.stage)).length;
  const workItemName = (workItemId: string | null) => project.workItems.find((w) => w.id === workItemId)?.name ?? "Not under a work item";

  const invited = packages.flatMap((p) => (!p.po && p.rfq && p.rfq.quotes.length > 0 ? [{ bom: p.bom, rfq: p.rfq }] : []));
  const awarded = packages.flatMap((p) => (p.po ? [{ bom: p.bom, rfq: p.rfq, po: p.po }] : []));
  const invitedVendorCount = invited.reduce((s, i) => s + i.rfq.quotes.length, 0);

  if (packages.length === 0) {
    return (
      <div className="rounded-xl border border-dashed bg-card px-6 py-14 text-center">
        <PackageCheck className="mx-auto h-8 w-8 text-muted-foreground" />
        <h3 className="mt-3 font-semibold">Nothing to outsource yet</h3>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          Only BOM lines marked &quot;Outsourced&quot; appear here. Self-performed work never needs an RFQ.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Vendors</h2>
        <p className="text-sm text-muted-foreground">
          Each outsourced package moves through four steps: request quotes, receive them, accept one to issue a PO, then pay against invoices.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat icon={Inbox} label="Needs RFQ" value={count("REQUEST")} />
        <Stat icon={Hourglass} label="Awaiting quotes" value={count("AWAITING")} />
        <Stat icon={ListChecks} label="Ready to accept" value={count("COMPARE")} tone={count("COMPARE") > 0 ? "alert" : undefined} />
        <Stat icon={HandCoins} label="Paying" value={count("PAYING")} />
        <Stat icon={PackageCheck} label="Fully paid" value={count("DONE")} />
      </div>

      <Section title="Outsourced packages" chip={`${packages.length} ${packages.length === 1 ? "package" : "packages"}`}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {packages.map((p) => (
            <PackageSummaryCard key={p.bom.id} bom={p.bom} rfq={p.rfq} po={p.po} stage={p.stage} workItemName={workItemName(p.bom.workItemId)} vendors={vendors} />
          ))}
        </div>
      </Section>

      {(invited.length > 0 || count("REQUEST") > 0) && (
        <Section
          title="Before award: invited vendors"
          chip={`${invitedVendorCount} invited ${invitedVendorCount === 1 ? "vendor" : "vendors"}`}
          action={
            invited.length > 0 ? (
              <Button variant="outline" size="sm" asChild>
                <a href={`/api/documents/rfqs/${project.id}`}>
                  <Download className="h-3.5 w-3.5" />
                  Download all RFQs
                </a>
              </Button>
            ) : undefined
          }
        >
          {invited.length > 0 ? (
            <InvitedVendorsTable items={invited} vendors={vendors} />
          ) : (
            <p className="rounded-xl border border-dashed bg-card px-6 py-8 text-center text-sm text-muted-foreground">
              No RFQs are waiting on quotes. Use <span className="font-medium text-foreground">Request quotes</span> on a package above, then download each vendor&apos;s RFQ to send it.
            </p>
          )}
        </Section>
      )}

      {awarded.length > 0 && (
        <Section title="Awarded vendors" chip={`${awarded.length} awarded ${awarded.length === 1 ? "package" : "packages"}`}>
          <AwardedVendors items={awarded} />
        </Section>
      )}
    </div>
  );
}

function Section({ title, chip, action, children }: { title: string; chip: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">{chip}</span>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Stat({ icon: Icon, label, value, tone }: { icon: typeof Inbox; label: string; value: number; tone?: "alert" }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3 shadow-sm">
      <span className={cn("flex h-10 w-10 items-center justify-center rounded-xl", tone === "alert" ? "bg-amber-100 text-amber-800" : "bg-primary/10 text-primary")}>
        <Icon className="h-5 w-5" />
      </span>
      <div>
        <div className="text-xl font-semibold leading-tight tabular-nums">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}
