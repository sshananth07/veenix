"use client";

import { useState } from "react";
import { createMilestoneSchedule } from "@/actions/milestoneSchedule";
import { FormDialog } from "@/components/FormDialog";
import { Button } from "@/components/ui/button";
import { emptyTerm, TermsEditor, termsSum, toFormRows, type TermFormRow } from "@/components/projects/quotation/TermsEditor";
import { formatCurrency } from "@/lib/utils";

// Fallback for a signed quotation that predates payment terms. New quotations
// carry their terms, and the schedule is created when the client signs.
export function MilestoneScheduleDialog({
  projectId,
  contractSum,
  initial = [],
}: {
  projectId: string;
  contractSum: number;
  initial?: { name: string; trigger: string; pct: number }[];
}) {
  const [rows, setRows] = useState<TermFormRow[]>(initial.length > 0 ? toFormRows(initial) : [emptyTerm()]);

  return (
    <FormDialog
      trigger={<Button size="lg">Set up payment schedule</Button>}
      title="Payment schedule"
      description={`When the client pays, and what share of the ${formatCurrency(contractSum)} contract sum each payment is.`}
      submitLabel="Create schedule"
      pendingLabel="Creating..."
      action={(fd) => createMilestoneSchedule(projectId, fd)}
      size="lg"
      disabled={termsSum(rows) !== 100}
    >
      <TermsEditor rows={rows} setRows={setRows} total={contractSum} />
    </FormDialog>
  );
}
