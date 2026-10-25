"use client";

import { useState } from "react";
import { Plus, UploadCloud } from "lucide-react";
import { createVariationOrder } from "@/actions/variationOrders";
import { VO_REASONS } from "@/lib/variationOrders";
import { FormDialog } from "@/components/FormDialog";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export function NewVoDialog({
  projectId,
  projectName,
  bomItems,
}: {
  projectId: string;
  projectName: string;
  bomItems: { id: string; workPackage: string; workItemName: string | null }[];
}) {
  const [bomItemId, setBomItemId] = useState("");
  const [reason, setReason] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);

  return (
    <FormDialog
      trigger={
        <Button>
          <Plus className="h-4 w-4" />
          New variation order
        </Button>
      }
      presentation="drawer"
      title="New variation order"
      description="Extra scope after the contract. The client must sign it before work changes."
      submitLabel="Create"
      action={(fd) => createVariationOrder(projectId, fd)}
    >
      <Field label="Project" htmlFor="projectDisplay">
        <Input id="projectDisplay" value={projectName} disabled className="bg-muted text-muted-foreground" />
      </Field>
      <Field label="Variation title" htmlFor="title" required>
        <Input id="title" name="title" placeholder="e.g. Additional kitchen cabinet" required />
      </Field>
      <Field label="Description" htmlFor="description" required hint="Describe the scope of work and reason for change">
        <Textarea id="description" name="description" rows={3} placeholder="Describe the scope of work and reason for change" required />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Amount (RM)" htmlFor="amount" required>
          <Input id="amount" name="amount" inputMode="decimal" placeholder="e.g. 2,500" required />
        </Field>
        <Field label="Reason" htmlFor="reason">
          <Select name="reason" value={reason} onValueChange={setReason}>
            <SelectTrigger id="reason">
              <SelectValue placeholder="Select reason" />
            </SelectTrigger>
            <SelectContent>
              {VO_REASONS.map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Linked BOM line" htmlFor="bomItemId">
          <Select name="bomItemId" value={bomItemId} onValueChange={setBomItemId}>
            <SelectTrigger id="bomItemId">
              <SelectValue placeholder="None" />
            </SelectTrigger>
            <SelectContent>
              {bomItems.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.workItemName ? `${b.workItemName}: ` : ""}
                  {b.workPackage}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Raised by" htmlFor="raisedBy">
          <Input id="raisedBy" name="raisedBy" placeholder="e.g. Hafiz, Sales" />
        </Field>
        <Field label="Impact on programme" htmlFor="programmeImpact" className="sm:col-span-2">
          <Input id="programmeImpact" name="programmeImpact" placeholder="e.g. None, within carpentry stage" />
        </Field>
      </div>

      <Field label="Files (optional)" htmlFor="file">
        <label
          htmlFor="file"
          className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed bg-muted/20 px-4 py-6 text-center transition-colors hover:border-primary/50 hover:bg-muted/30"
        >
          <UploadCloud className="h-6 w-6 text-muted-foreground" />
          <span className="text-sm">
            <span className="font-medium text-primary">{fileName ?? "Drag and drop files here or click to upload"}</span>
          </span>
          <span className="text-xs text-muted-foreground">PDF, JPG, PNG (max 10MB)</span>
        </label>
        <input
          id="file"
          name="file"
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/*"
          className="hidden"
          onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
        />
      </Field>
    </FormDialog>
  );
}
