"use client";

import { Rocket } from "lucide-react";
import { convertLead } from "@/actions/leads";
import { FormDialog } from "@/components/FormDialog";
import { Button } from "@/components/ui/button";
import { AddressFields } from "@/components/ui/AddressFields";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { hasStructuredAddress, type AddressParts } from "@/lib/address";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function ConvertLeadDialog({
  leadId,
  assignedTo,
  carryOver,
  address,
  legacyAddress,
  defaultOpen,
}: {
  leadId: string;
  assignedTo: string | null;
  carryOver: { label: string; value: string }[];
  address: AddressParts;
  legacyAddress: string | null;
  defaultOpen?: boolean;
}) {
  const complete = hasStructuredAddress(address);
  return (
    <FormDialog
      trigger={
        <Button>
          <Rocket className="h-4 w-4" />
          Convert to project
        </Button>
      }
      title="Convert lead to project"
      description="Everything below carries over. Nothing is retyped."
      submitLabel="Convert"
      pendingLabel="Converting..."
      action={(fd) => convertLead(leadId, fd)}
      size="lg"
      defaultOpen={defaultOpen}
    >
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border bg-muted/40 p-3 text-sm">
        {carryOver.map((item) => (
          <div key={item.label} className={item.label === "Site address" ? "col-span-2" : undefined}>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">{item.label}</dt>
            <dd className="whitespace-pre-line font-medium">{item.value}</dd>
          </div>
        ))}
      </dl>

      {!complete && (
        <div className="grid gap-3 sm:grid-cols-2">
          <p className="rounded-md sm:col-span-2 border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            A project needs a full site address. Complete it here and it is saved on the lead as well.
          </p>
          <AddressFields required values={address.addressLine1 ? address : legacyAddress ? { addressLine1: legacyAddress } : undefined} />
        </div>
      )}

      <Field label="Project name" htmlFor="projectName" required hint="How the job will be known, e.g. Rahman Residence, Full Fit-out">
        <Input id="projectName" name="projectName" required placeholder="Enter the project name" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Next stage" htmlFor="nextStage" required>
          <Select name="nextStage" defaultValue="SITE_VISIT">
            <SelectTrigger id="nextStage">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="SITE_VISIT">Site Visit</SelectItem>
              <SelectItem value="QUOTING">Quoting</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Project owner" htmlFor="projectOwner">
          <Input id="projectOwner" name="projectOwner" defaultValue={assignedTo ?? ""} />
        </Field>
        <Field label="Target start" htmlFor="targetStart">
          <Input id="targetStart" name="targetStart" type="date" />
        </Field>
        <Field label="Target handover" htmlFor="targetHandover">
          <Input id="targetHandover" name="targetHandover" type="date" />
        </Field>
      </div>
    </FormDialog>
  );
}
