"use client";

import { useState } from "react";
import { MessageCircleQuestion, Reply, Trash2 } from "lucide-react";
import { applyMarkupToAll, buildQuotation, discardDraft, recordClientQuestion, recordReply, saveQuotationTerms, updateLineMarkup } from "@/actions/quotation";
import { FormDialog } from "@/components/FormDialog";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { emptyTerm, TermsEditor, termsSum, toFormRows, type TermFormRow } from "@/components/projects/quotation/TermsEditor";
import { markupToMarginPct } from "@/lib/quotation";
import { formatCurrency } from "@/lib/utils";

export function BuildQuotationDialog({ projectId, defaultMarkupPct, lines }: { projectId: string; defaultMarkupPct: number; lines: number }) {
  return (
    <FormDialog
      trigger={<Button size="lg">Create quotation</Button>}
      title="Create quotation"
      description={`All ${lines} priced lines become quotation lines, grouped under their work items. Cost stays locked to the BOM.`}
      submitLabel="Create quotation"
      pendingLabel="Creating..."
      action={(fd) => buildQuotation(projectId, fd)}
    >
      <Field label="Starting markup on cost (%)" htmlFor="markupPct" required hint={`Your default is ${defaultMarkupPct}%. You can change any line afterwards.`}>
        <Input id="markupPct" name="markupPct" type="number" min={0} max={500} defaultValue={defaultMarkupPct} required />
      </Field>
    </FormDialog>
  );
}

export function BulkMarkupDialog({ quotationId, current }: { quotationId: string; current: number }) {
  return (
    <FormDialog
      trigger={
        <Button variant="outline" size="sm">
          Set markup for all
        </Button>
      }
      title="Set markup for all lines"
      description="Replaces the markup on every line of this draft."
      submitLabel="Apply to all lines"
      action={(fd) => applyMarkupToAll(quotationId, fd)}
    >
      <Field label="Markup on cost (%)" htmlFor="markupPct" required>
        <Input id="markupPct" name="markupPct" type="number" min={0} max={500} defaultValue={current} required />
      </Field>
    </FormDialog>
  );
}

export function LineMarkupDialog({
  lineId,
  workPackage,
  cost,
  markupPct,
  trigger,
}: {
  lineId: string;
  workPackage: string;
  cost: number;
  markupPct: number;
  trigger: React.ReactNode;
}) {
  const [value, setValue] = useState(String(markupPct));
  const pct = Number(value) || 0;
  const price = Math.round(cost * (1 + pct / 100));
  return (
    <FormDialog
      trigger={trigger}
      title={workPackage}
      description="Markup is what you add on top of your cost."
      submitLabel="Save markup"
      action={(fd) => updateLineMarkup(lineId, fd)}
    >
      <Field label="Markup on cost (%)" htmlFor="markupPct" required>
        <Input id="markupPct" name="markupPct" type="number" min={0} max={500} value={value} onChange={(e) => setValue(e.target.value)} required />
      </Field>
      <dl className="grid grid-cols-3 gap-3 rounded-lg border bg-muted/40 p-3 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Your cost</dt>
          <dd className="font-semibold tabular-nums">{formatCurrency(cost)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Client price</dt>
          <dd className="font-semibold tabular-nums">{formatCurrency(price)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Your profit</dt>
          <dd className="font-semibold tabular-nums">
            {formatCurrency(price - cost)}
            <span className="block text-xs font-normal text-muted-foreground">{markupToMarginPct(pct).toFixed(1)}% of the price</span>
          </dd>
        </div>
      </dl>
    </FormDialog>
  );
}

export function QuotationTermsDialog({
  quotationId,
  total,
  initial,
  trigger,
}: {
  quotationId: string;
  total: number;
  initial: { name: string; trigger: string; pct: number }[];
  trigger: React.ReactNode;
}) {
  const [rows, setRows] = useState<TermFormRow[]>(initial.length > 0 ? toFormRows(initial) : [emptyTerm()]);
  return (
    <FormDialog
      trigger={trigger}
      title="Payment terms"
      description={`When the client pays, and what share of the ${formatCurrency(total)} contract sum (including SST) each payment is. Once the client signs, these become the project's payment schedule.`}
      submitLabel="Save payment terms"
      action={(fd) => saveQuotationTerms(quotationId, fd)}
      size="lg"
      disabled={termsSum(rows) !== 100}
    >
      <TermsEditor rows={rows} setRows={setRows} total={total} />
    </FormDialog>
  );
}

export function DiscardDraftMenuItem({ quotationId, revision }: { quotationId: string; revision: number }) {
  return (
    <FormDialog
      destructive
      title={`Discard Rev ${revision}?`}
      description="This draft is deleted. Earlier versions are not affected."
      submitLabel="Discard draft"
      action={discardDraft.bind(null, quotationId)}
      trigger={
        <button type="button" className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-red-600 outline-hidden hover:bg-red-50 focus:bg-red-50">
          <Trash2 className="h-4 w-4" />
          Discard draft
        </button>
      }
    />
  );
}

export function ClientQuestionDialog({ quotationId, revision, clientName, another }: { quotationId: string; revision: number; clientName: string; another: boolean }) {
  return (
    <FormDialog
      trigger={
        <Button variant="outline" size="sm">
          <MessageCircleQuestion className="h-3.5 w-3.5" />
          {another ? "Client has another question" : "Client has a question"}
        </Button>
      }
      title={`${clientName} has a question`}
      description={`Record what they asked about Rev ${revision}. It is added to the conversation below, and you can go back and forth as many times as needed until they sign.`}
      submitLabel="Record question"
      action={(fd) => recordClientQuestion(quotationId, fd)}
    >
      <Field label="What did the client ask or comment?" htmlFor="comment" required>
        <Textarea id="comment" name="comment" rows={4} placeholder="e.g. Can the cabinet finish be changed to matte, and would that change the price?" required />
      </Field>
    </FormDialog>
  );
}

export function ReplyDialog({ quotationId, revision, question }: { quotationId: string; revision: number; question: string | null }) {
  return (
    <FormDialog
      trigger={
        <Button size="sm">
          <Reply className="h-3.5 w-3.5" />
          Log our reply
        </Button>
      }
      title="Reply to the client"
      description={`Record your answer on Rev ${revision}. If the answer changes the price or scope, create a new version from the ··· menu after logging it.`}
      submitLabel="Save reply"
      action={(fd) => recordReply(quotationId, fd)}
    >
      {question && (
        <blockquote className="rounded-lg border-l-4 border-primary/40 bg-muted/40 px-3 py-2 text-sm">
          <div className="mb-0.5 text-xs font-medium text-muted-foreground">Client asked</div>
          {question}
        </blockquote>
      )}
      <Field label="Your reply" htmlFor="reply" required>
        <Textarea id="reply" name="reply" rows={4} placeholder="e.g. Matte finish adds RM 800. Sending a revised quotation today." required />
      </Field>
    </FormDialog>
  );
}
