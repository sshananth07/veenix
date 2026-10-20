import { ChevronRight, Package, Check } from "lucide-react";
import type { ProjectDetail } from "@/lib/projectQuery";
import type { PackageStage } from "@/lib/procurement";
import { Button } from "@/components/ui/button";
import { RequestQuotesDialog } from "@/components/projects/vendors/VendorDialogs";
import { cn } from "@/lib/utils";

type Bom = ProjectDetail["bomItems"][number];
type Rfq = ProjectDetail["rfqs"][number];
type Po = ProjectDetail["purchaseOrders"][number];
type Vendor = { id: string; name: string; type: string | null; jobsCount: number };

// One outsourced package at a glance: who won it (or which room it is for)
// and how far along the four steps it is.
export function PackageSummaryCard({
  bom,
  rfq,
  po,
  stage,
  workItemName,
  vendors,
}: {
  bom: Bom;
  rfq: Rfq | undefined;
  po: Po | undefined;
  stage: PackageStage;
  workItemName: string;
  vendors: Vendor[];
}) {
  const quotes = rfq?.quotes ?? [];
  const received = quotes.filter((q) => q.receivedAt).length;

  const steps = [
    { label: "Request quotes", done: quotes.length > 0, meta: quotes.length ? `${quotes.length} asked` : "" },
    { label: "Quotes in", done: received > 0 || !!po, meta: quotes.length ? `${received} of ${quotes.length}` : "" },
    { label: "PO issued", done: !!po, meta: po ? po.code : "" },
    { label: "Paid", done: stage === "DONE", meta: "" },
  ];
  const currentIndex = steps.findIndex((s) => !s.done);
  const target = po || quotes.length > 0 ? `#pkg-${bom.id}` : null;

  return (
    <article className="flex min-w-0 flex-col rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Package className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold">{bom.workPackage}</h3>
          <p className="truncate text-sm text-muted-foreground">{po ? po.vendor.name : workItemName}</p>
        </div>
        {target && (
          <a href={target} aria-label={`Go to ${bom.workPackage}`} className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <ChevronRight className="h-4 w-4" />
          </a>
        )}
      </div>

      <ol className="mt-4 grid grid-cols-4">
        {steps.map((s, i) => (
          <li key={s.label} className="relative flex flex-col items-center text-center">
            {i < steps.length - 1 && (
              <span aria-hidden className={cn("absolute left-[calc(50%+14px)] right-[calc(-50%+14px)] top-[13px] h-0.5 rounded-full", steps[i + 1].done || s.done ? "bg-emerald-500" : "bg-border")} />
            )}
            <span
              className={cn(
                "relative z-10 flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold",
                s.done && "bg-emerald-500 text-white",
                !s.done && i === currentIndex && "bg-primary text-primary-foreground ring-4 ring-primary/15",
                !s.done && i !== currentIndex && "bg-muted text-muted-foreground"
              )}
            >
              {s.done ? <Check className="h-4 w-4" strokeWidth={3} /> : i + 1}
            </span>
            <span className={cn("mt-1.5 text-[11px] leading-tight", i === currentIndex ? "font-semibold text-foreground" : "text-muted-foreground")}>{s.label}</span>
            {s.meta && <span className="text-[10px] text-muted-foreground">{s.meta}</span>}
          </li>
        ))}
      </ol>

      {stage === "REQUEST" && (
        <div className="mt-4">
          <RequestQuotesDialog
            bomItemId={bom.id}
            workPackage={bom.workPackage}
            vendors={vendors}
            firstRequest
            trigger={<Button size="sm" className="w-full">Request quotes</Button>}
          />
        </div>
      )}
    </article>
  );
}
