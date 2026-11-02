import Link from "next/link";
import { AlertTriangle, ArrowRight, Check, Eye, FilePlus2, FileText, Lock, MessageCircleQuestion, MoreVertical, Reply, Send, Square } from "lucide-react";
import type { ProjectDetail } from "@/lib/projectQuery";
import type { BomCost, Blocker } from "@veenix/shared";
import { groupByWorkItem, quotationTotals } from "@/lib/quotation";
import { cn, formatCurrency, formatDate, formatDateTime } from "@/lib/utils";
import { requireSession } from "@/lib/session";
import { createRevision, sendQuotation, recordClientResponse } from "@/actions/quotation";
import { ActionButton } from "@/components/ActionButton";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { StaticMenuItem } from "@/components/ui/StaticMenuItem";
import { BuildQuotationDialog, BulkMarkupDialog, ClientQuestionDialog, DiscardDraftMenuItem, QuotationTermsDialog, ReplyDialog } from "@/components/projects/quotation/QuotationDialogs";
import { QuotationTable } from "@/components/projects/quotation/QuotationTable";
import { SendDocumentButtons } from "@/components/SendDocumentButtons";

type Quotation = ProjectDetail["quotations"][number];

const OPEN = ["SENT", "VIEWED", "QUESTIONED"];

export function QuotationTab({
  project,
  costs,
  readiness,
  settings,
  selectedRevision,
  clientView,
}: {
  project: ProjectDetail;
  costs: Record<string, BomCost>;
  readiness: { ready: boolean; blockers: Blocker[]; total: number; priced: number };
  settings: { defaultMarkupPct: number; minMarkupPct: number };
  selectedRevision: number | null;
  clientView: boolean;
}) {
  const versions = project.quotations;

  if (versions.length === 0) {
    return <EmptyState project={project} readiness={readiness} settings={settings} />;
  }

  const signed = versions.find((q) => q.status === "ACCEPTED");
  const latest = versions[versions.length - 1];
  const current = versions.find((q) => q.revision === selectedRevision) ?? signed ?? latest;
  const hasDraft = versions.some((q) => q.status === "DRAFT");
  const isDraft = current.status === "DRAFT";

  const quoted = new Set(current.lineItems.map((l) => l.bomItemId).filter(Boolean));
  const newLines = project.bomItems.filter((b) => b.workItemId && costs[b.id]?.priced && !quoted.has(b.id));
  const totals = current.totals;
  const groups = groupByWorkItem(current.lineItems);
  const termsOk = current.terms.reduce((s, t) => s + t.pct, 0) === 100;
  const termAmounts = current.termAmounts;
  const base = `/projects/${project.id}?tab=quotation`;

  const canCreateVersion = !signed && !hasDraft && OPEN.includes(current.status);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Quotation versions" className="flex flex-wrap items-center gap-2">
          {versions.map((q) => (
            <Link
              key={q.id}
              href={`${base}&v=${q.revision}${clientView ? "&view=client" : ""}`}
              replace
              scroll={false}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors",
                q.id === current.id ? "border-primary bg-primary text-primary-foreground" : "bg-card text-foreground hover:bg-muted"
              )}
            >
              Rev {q.revision}
              {q.status === "ACCEPTED" && (
                <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", q.id === current.id ? "bg-white/20" : "bg-emerald-100 text-emerald-800")}>Final</span>
              )}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border bg-card p-1 text-sm shadow-xs">
            {[
              ["Internal view", false],
              ["Client view", true],
            ].map(([label, isClient]) => (
              <Link
                key={String(label)}
                href={`${base}&v=${current.revision}${isClient ? "&view=client" : ""}`}
                replace
                scroll={false}
                className={cn("rounded-md px-3.5 py-1.5 font-medium transition-colors", clientView === isClient ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {label as string}
              </Link>
            ))}
          </div>
          <Button variant="outline" size="icon" asChild aria-label="Download PDF" title="Download PDF">
            <a href={`/api/documents/quotation/${current.id}`} target="_blank" rel="noreferrer">
              <FileText className="h-4 w-4" />
            </a>
          </Button>
          {!clientView && <SendDocumentButtons type="quotation" id={current.id} defaultEmail={project.clientEmail} defaultPhone={project.clientPhone} />}
          {!clientView && (isDraft || canCreateVersion) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="More actions">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {isDraft && (
                  <StaticMenuItem>
                    <BulkMarkupDialog
                      quotationId={current.id}
                      current={current.lineItems.length ? Math.round(current.lineItems.reduce((s, l) => s + l.markupPct, 0) / current.lineItems.length) : settings.defaultMarkupPct}
                    />
                  </StaticMenuItem>
                )}
                {canCreateVersion && (
                  <StaticMenuItem>
                    <NewVersionAction quotationId={current.id} nextRevision={latest.revision + 1} />
                  </StaticMenuItem>
                )}
                {isDraft && <DiscardDraftMenuItem quotationId={current.id} revision={current.revision} />}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <TopBanner current={current} readiness={readiness} termsOk={termsOk} contractTotal={totals.total} projectId={project.id} newLinesCount={newLines.length} isLatest={current.id === latest.id} />

      <Timeline quotation={current} />

      <section className="space-y-4">
        <h2 className="text-lg font-semibold tracking-tight">{clientView ? "Quotation (Client View)" : "Work Item & Pricing (Internal View)"}</h2>

        <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
          <QuotationTable groups={groups} clientView={clientView} editable={!clientView && isDraft} minMarkupPct={settings.minMarkupPct} />
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <SummaryCard totals={totals} sstBps={project.pricing.sstBps} />
          <TermsCard terms={current.terms} amounts={termAmounts} total={totals.total} />
          {isDraft && !clientView && <PendingActionCard readiness={readiness} termsOk={termsOk} />}
        </div>
      </section>

      {!clientView && !isDraft && (
        <ConversationSection
          quotation={current}
          clientName={project.clientName}
          open={OPEN.includes(current.status)}
        />
      )}
    </div>
  );
}

type QuotationEvent = Quotation["events"][number];

// The back-and-forth with the client on this version: what was sent, what they
// asked, what we answered, and finally the signature. Actions to record the
// next step sit on top while the version is still open.
function ConversationSection({ quotation, clientName, open }: { quotation: Quotation; clientName: string; open: boolean }) {
  const events = quotation.events.filter((e) => ["SENT", "VIEWED", "QUESTIONED", "REPLIED", "ACCEPTED"].includes(e.type));
  const lastQuestion = [...events].reverse().find((e) => e.type === "QUESTIONED")?.note ?? null;
  const asked = events.filter((e) => e.type === "QUESTIONED").length;

  return (
    <section className="rounded-xl border bg-card p-5 shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">Conversation with client</h3>
          <p className="text-xs text-muted-foreground">
            {open
              ? "The client link isn't live yet, so record what the client says and what you answer. Repeat as often as needed until they sign."
              : quotation.status === "ACCEPTED"
                ? "The record of how this version was agreed."
                : "The record of this version before it was replaced."}
          </p>
        </div>
        {open && (
          <div className="flex flex-wrap gap-2">
            {quotation.status === "SENT" && (
              <ActionButton variant="outline" size="sm" action={recordClientResponse.bind(null, quotation.id, "VIEWED")}>
                <Eye className="h-3.5 w-3.5" />
                Client viewed it
              </ActionButton>
            )}
            {quotation.status === "QUESTIONED" && <ReplyDialog quotationId={quotation.id} revision={quotation.revision} question={lastQuestion} />}
            <ClientQuestionDialog quotationId={quotation.id} revision={quotation.revision} clientName={clientName} another={asked > 0} />
            <ActionButton size="sm" action={recordClientResponse.bind(null, quotation.id, "ACCEPTED", clientName)}>
              <Check className="h-3.5 w-3.5" />
              Client signed
            </ActionButton>
          </div>
        )}
      </div>

      {events.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">Nothing recorded yet.</p>
      ) : (
        <ol className="mt-5 space-y-3">
          {events.map((e) => (
            <ThreadEntry key={e.id} event={e} clientName={clientName} />
          ))}
        </ol>
      )}

      {quotation.status === "QUESTIONED" && (
        <p className="mt-4 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <MessageCircleQuestion className="h-4 w-4 shrink-0" />
          The client is waiting for your reply.
        </p>
      )}
    </section>
  );
}

async function ThreadEntry({ event, clientName }: { event: QuotationEvent; clientName: string }) {
  const userName = (await requireSession()).user.name;
  if (event.type === "QUESTIONED" || event.type === "REPLIED") {
    const client = event.type === "QUESTIONED";
    return (
      <li className={cn("flex", client ? "justify-start" : "justify-end")}>
        <div className={cn("max-w-[85%] rounded-2xl px-4 py-2.5 text-sm", client ? "rounded-tl-sm bg-muted" : "rounded-tr-sm bg-primary/10")}>
          <div className="mb-0.5 flex items-center gap-2 text-xs text-muted-foreground">
            {client ? <MessageCircleQuestion className="h-3.5 w-3.5" /> : <Reply className="h-3.5 w-3.5" />}
            <span className="font-medium text-foreground">{client ? clientName : userName}</span>
            <span>{formatDateTime(event.createdAt)}</span>
          </div>
          <p className="whitespace-pre-line">{event.note}</p>
        </div>
      </li>
    );
  }
  const label =
    event.type === "SENT" ? "Sent to the client" : event.type === "VIEWED" ? "Client viewed the quotation" : `Signed by ${clientName}`;
  return (
    <li className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
      <span className={cn("h-px flex-1 bg-border")} />
      <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1", event.type === "ACCEPTED" && "border-emerald-200 bg-emerald-50 text-emerald-800")}>
        {event.type === "ACCEPTED" && <Check className="h-3 w-3" strokeWidth={3} />}
        {label} · {formatDateTime(event.createdAt)}
      </span>
      <span className="h-px flex-1 bg-border" />
    </li>
  );
}

function TopBanner({
  current,
  readiness,
  termsOk,
  contractTotal,
  projectId,
  newLinesCount,
  isLatest,
}: {
  current: Quotation;
  readiness: { ready: boolean; blockers: Blocker[] };
  termsOk: boolean;
  contractTotal: number;
  projectId: string;
  newLinesCount: number;
  isLatest: boolean;
}) {
  if (current.status === "ACCEPTED") {
    return (
      <Notice tone="success" icon={Lock} aside={`Signed on ${formatDate(current.acceptedAt)}`}>
        This quotation has been signed by the client. It is now locked.
      </Notice>
    );
  }
  if (current.status === "SUPERSEDED") {
    return (
      <Notice tone="muted" icon={Lock}>
        Superseded by a newer version. Kept for the record; it can no longer be accepted.
      </Notice>
    );
  }
  if (current.status === "DRAFT") {
    if (!readiness.ready) {
      return (
        <Notice tone="warn" icon={AlertTriangle}>
          <span className="font-medium">This draft can&apos;t be sent yet.</span> {readiness.blockers.length} {readiness.blockers.length === 1 ? "thing needs" : "things need"} pricing first:
          <ul className="mt-1 list-disc pl-5">
            {readiness.blockers.slice(0, 4).map((b, i) => (
              <li key={i}>
                {b.message}{" "}
                <Link href={`/projects/${projectId}?tab=${b.tab}`} className="font-medium underline">
                  Fix
                </Link>
              </li>
            ))}
          </ul>
        </Notice>
      );
    }
    if (!termsOk) {
      return (
        <Notice tone="warn" icon={AlertTriangle} aside={<QuotationTermsDialog quotationId={current.id} total={contractTotal} initial={current.terms} trigger={<Button size="sm">Set payment terms</Button>} />}>
          <span className="font-medium">Add the payment terms before sending.</span> They must add up to 100% of the contract sum.
        </Notice>
      );
    }
    return (
      <Notice tone="warn" icon={AlertTriangle} aside={<ActionButton size="sm" action={sendQuotation.bind(null, current.id)} pendingLabel="Sending..."><Send className="h-3.5 w-3.5" />Send to client</ActionButton>}>
        This quotation is in Draft status. Please review and send it to client when ready.
      </Notice>
    );
  }
  if (OPEN.includes(current.status) && newLinesCount > 0 && isLatest) {
    return (
      <Notice tone="info" icon={FilePlus2}>
        {newLinesCount} priced BOM {newLinesCount === 1 ? "line has" : "lines have"} been added since this version was sent. Create a new version to include{" "}
        {newLinesCount === 1 ? "it" : "them"}.
      </Notice>
    );
  }
  return null;
}

function NewVersionAction({ quotationId, nextRevision }: { quotationId: string; nextRevision: number }) {
  return (
    <ActionButton variant="ghost" className="w-full justify-start px-2 py-1.5 text-sm font-normal" action={createRevision.bind(null, quotationId)} pendingLabel="Creating...">
      <FilePlus2 className="h-4 w-4" />
      Create Rev {nextRevision}
    </ActionButton>
  );
}

function Timeline({ quotation }: { quotation: Quotation }) {
  const superseded = quotation.status === "SUPERSEDED";
  const questions = quotation.events.filter((e) => e.type === "QUESTIONED");
  const steps = [
    { label: "Draft", at: quotation.createdAt, done: true, detail: null as string | null },
    { label: "Sent to client", at: quotation.sentAt, done: !!quotation.sentAt, detail: null },
    { label: "Viewed", at: quotation.viewedAt, done: !!quotation.viewedAt, detail: questions.length ? `${questions.length} question${questions.length > 1 ? "s" : ""} raised` : null },
    { label: "Signed", at: quotation.acceptedAt, done: !!quotation.acceptedAt, detail: quotation.signedBy },
  ];
  const currentIndex = steps.findIndex((s) => !s.done);

  return (
    <ol className="grid grid-cols-4 rounded-xl border bg-card px-3 py-5 shadow-xs sm:px-6" aria-label="Quotation progress">
      {steps.map((s, i) => {
        const isCurrent = !superseded && i === currentIndex;
        return (
          <li key={s.label} className="relative flex flex-col items-center text-center">
            {i < steps.length - 1 && (
              <span
                aria-hidden
                className={cn("absolute left-[calc(50%+18px)] right-[calc(-50%+18px)] top-[17px] h-0.5 rounded-full", steps[i + 1].done && !superseded ? "bg-emerald-500" : "bg-border")}
              />
            )}
            <span
              className={cn(
                "relative z-10 flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold",
                s.done && !superseded && "bg-emerald-500 text-white",
                s.done && superseded && "bg-slate-300 text-white",
                isCurrent && "bg-primary text-primary-foreground ring-4 ring-primary/15",
                !s.done && !isCurrent && "bg-muted text-muted-foreground"
              )}
            >
              {s.done ? <Check className="h-4 w-4" strokeWidth={3} /> : i + 1}
            </span>
            <div className={cn("mt-2 text-sm", isCurrent ? "font-semibold" : s.done ? "font-medium" : "text-muted-foreground")}>{s.label}</div>
            <div className="text-xs text-muted-foreground">{s.done ? formatDateTime(s.at) : isCurrent ? "Waiting" : "-"}</div>
            {s.detail && <div className="text-xs text-muted-foreground">{s.detail}</div>}
          </li>
        );
      })}
    </ol>
  );
}

function SummaryCard({ totals, sstBps }: { totals: ReturnType<typeof quotationTotals>; sstBps: number }) {
  return (
    <div className="rounded-xl border bg-card p-5 shadow-xs">
      <h3 className="mb-3 font-semibold">Quotation Summary</h3>
      <dl className="space-y-2 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Work item subtotal</dt>
          <dd className="tabular-nums">{formatCurrency(totals.subtotal)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">{`SST ${sstBps / 100}%`}</dt>
          <dd className="tabular-nums">{formatCurrency(totals.sst)}</dd>
        </div>
        <div className="flex justify-between border-t pt-2.5 text-base font-semibold">
          <dt>Contract sum</dt>
          <dd className="tabular-nums">{formatCurrency(totals.total)}</dd>
        </div>
      </dl>
    </div>
  );
}

function TermsCard({ terms, amounts, total }: { terms: Quotation["terms"]; amounts: number[]; total: number }) {
  return (
    <div className="rounded-xl border bg-card p-5 shadow-xs">
      <h3 className="mb-3 font-semibold">Payment terms</h3>
      {terms.length === 0 ? (
        <p className="text-sm text-muted-foreground">No payment terms set yet.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-1 pr-2 font-medium">#</th>
                  <th className="py-1 pr-2 font-medium">Payment</th>
                  <th className="py-1 pr-2 font-medium">When it&apos;s due</th>
                  <th className="py-1 pr-2 text-right font-medium">%</th>
                  <th className="py-1 text-right font-medium">Amount (RM)</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {terms.map((t, i) => (
                  <tr key={t.id}>
                    <td className="py-1.5 pr-2 text-muted-foreground">{i + 1}</td>
                    <td className="py-1.5 pr-2 font-medium">{t.name}</td>
                    <td className="py-1.5 pr-2 text-muted-foreground">{t.trigger}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{t.pct}%</td>
                    <td className="py-1.5 text-right tabular-nums">{formatCurrency(amounts[i]).replace("RM ", "")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 flex items-center justify-between border-t pt-2.5 text-sm font-semibold">
            <span>Total</span>
            <span className="tabular-nums">
              {terms.reduce((s, t) => s + t.pct, 0)}% · {formatCurrency(total)}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function PendingActionCard({ readiness, termsOk }: { readiness: { ready: boolean }; termsOk: boolean }) {
  const items = [
    { label: "Review quotation amounts", done: readiness.ready },
    { label: "Set payment terms", done: termsOk },
    { label: "Send to client", done: false },
    { label: "Get client approval", done: false },
  ];
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
      <h3 className="mb-3 font-semibold text-amber-900">Pending action</h3>
      <ul className="space-y-2.5 text-sm text-amber-900">
        {items.map((item) => (
          <li key={item.label} className="flex items-center gap-2.5">
            {item.done ? <Check className="h-4 w-4 shrink-0 text-emerald-600" strokeWidth={3} /> : <Square className="h-4 w-4 shrink-0 text-amber-400" />}
            <span className={item.done ? "text-muted-foreground line-through" : ""}>{item.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Notice({
  tone,
  icon: Icon,
  aside,
  children,
}: {
  tone: "success" | "warn" | "info" | "muted";
  icon: typeof Lock;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  const style = {
    success: "border-emerald-200 bg-emerald-50 text-emerald-900",
    warn: "border-amber-200 bg-amber-50 text-amber-900",
    info: "border-blue-200 bg-blue-50 text-blue-900",
    muted: "border-border bg-muted/50 text-muted-foreground",
  }[tone];
  const iconTone = { success: "bg-white text-emerald-600", warn: "bg-white text-amber-600", info: "bg-white text-blue-600", muted: "bg-white text-muted-foreground" }[tone];
  return (
    <div className={cn("flex flex-wrap items-center gap-4 rounded-xl border px-4 py-3.5 text-sm", style)}>
      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full shadow-xs", iconTone)}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">{children}</div>
      {aside && <div className="shrink-0">{typeof aside === "string" ? <span className="text-xs font-medium">{aside}</span> : aside}</div>}
    </div>
  );
}

function EmptyState({
  project,
  readiness,
  settings,
}: {
  project: ProjectDetail;
  readiness: { ready: boolean; blockers: Blocker[]; total: number; priced: number };
  settings: { defaultMarkupPct: number };
}) {
  const pct = readiness.total > 0 ? Math.round((readiness.priced / readiness.total) * 100) : 0;
  return (
    <div className="mx-auto max-w-2xl rounded-xl border bg-card p-8 shadow-xs">
      <h2 className="text-lg font-semibold tracking-tight">{readiness.ready ? "Ready to create the quotation" : "Price everything first"}</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        A quotation can only be created once every line has a firm price: an accepted vendor quote for outsourced work, and a costed labour and materials line for self-performed work.
      </p>

      <div className="mt-5">
        <div className="mb-1.5 flex justify-between text-sm">
          <span className="font-medium">
            {readiness.priced} of {readiness.total} lines priced
          </span>
          <span className="text-muted-foreground">{pct}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div className={cn("h-full rounded-full", readiness.ready ? "bg-emerald-500" : "bg-primary")} style={{ width: `${pct}%` }} />
        </div>
      </div>

      {!readiness.ready && (
        <ul className="mt-5 divide-y rounded-lg border">
          {readiness.blockers.map((b, i) => (
            <li key={i} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <span>{b.message}</span>
              <Link href={`/projects/${project.id}?tab=${b.tab}`} replace className="inline-flex shrink-0 items-center gap-1 font-medium text-primary hover:underline">
                {b.tab === "vendors" ? "Go to Vendors" : "Go to BOM"}
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {readiness.ready && (
        <div className="mt-6">
          <BuildQuotationDialog projectId={project.id} defaultMarkupPct={settings.defaultMarkupPct} lines={readiness.total} />
        </div>
      )}
    </div>
  );
}
