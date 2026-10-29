"use client";

import type { EinvoiceSettingsDto } from "@veenix/shared";
import { Pencil } from "lucide-react";
import { updateEinvoiceSettings } from "@/actions/settings";
import { FormDialog } from "@/components/FormDialog";
import { Button } from "@/components/ui/button";
import { AddressFields } from "@/components/ui/AddressFields";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function EinvoiceSettingsDialog({ settings }: { settings: EinvoiceSettingsDto | null }) {
  const s = settings;
  return (
    <FormDialog
      trigger={
        <Button variant="outline" size="sm">
          <Pencil className="h-3.5 w-3.5" />
          {s ? "Edit e-invoicing" : "Set up e-invoicing"}
        </Button>
      }
      presentation="drawer"
      title="LHDN MyInvois e-invoicing"
      description="Each generated invoice is signed and submitted to LHDN. Use pre-production until LHDN validates a test invoice."
      submitLabel="Save e-invoice settings"
      action={updateEinvoiceSettings}
    >
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" name="enabled" defaultChecked={s?.enabled ?? false} />
        Submit invoices to LHDN when they are generated
      </label>
      <Field label="Environment" htmlFor="environment" required>
        <Select name="environment" defaultValue={s?.environment ?? "preprod"}>
          <SelectTrigger id="environment">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="preprod">Pre-production (testing)</SelectItem>
            <SelectItem value="prod">Production</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Company TIN" htmlFor="tin" required>
          <Input id="tin" name="tin" defaultValue={s?.tin ?? ""} placeholder="e.g. C1234567890" required />
        </Field>
        <Field label="Business registration no." htmlFor="brn" required>
          <Input id="brn" name="brn" defaultValue={s?.brn ?? ""} placeholder="e.g. 202001012345" required />
        </Field>
        <Field label="SST registration no." htmlFor="sstNo" hint="Required if your invoices charge SST">
          <Input id="sstNo" name="sstNo" defaultValue={s?.sstNo ?? ""} />
        </Field>
        <Field label="Company phone" htmlFor="phone" required>
          <Input id="phone" name="phone" defaultValue={s?.phone ?? ""} placeholder="+60123456789" required />
        </Field>
        <Field label="MSIC code" htmlFor="msicCode" required hint="5 digits, e.g. 43301 for building finishing">
          <Input id="msicCode" name="msicCode" inputMode="numeric" defaultValue={s?.msicCode ?? ""} required />
        </Field>
        <Field label="Business activity" htmlFor="businessActivity" required>
          <Input id="businessActivity" name="businessActivity" defaultValue={s?.businessActivity ?? ""} placeholder="e.g. Interior design and renovation" required />
        </Field>
      </div>

      <AddressFields label="Registered business address" required values={s ?? undefined} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="MyInvois client ID" htmlFor="clientId" required hint="From the ERP system registered in the MyInvois portal">
          <Input id="clientId" name="clientId" defaultValue={s?.clientId ?? ""} required autoComplete="off" />
        </Field>
        <Field label="Client secret" htmlFor="clientSecret" hint={s?.hasClientSecret ? "Stored. Leave blank to keep it." : undefined}>
          <Input id="clientSecret" name="clientSecret" type="password" autoComplete="new-password" />
        </Field>
        <Field
          label="Signing certificate (.p12 or .pfx)"
          htmlFor="certificate"
          hint={s?.hasCertificate ? `Stored: ${s.certificateSubject ?? "certificate"}. Choose a file only to replace it.` : "Issued by an MCMC-licensed CA"}
        >
          <Input id="certificate" name="certificate" type="file" accept=".p12,.pfx,application/x-pkcs12" />
        </Field>
        <Field label="Certificate password" htmlFor="certificatePassword" hint="Only used to open the file; it isn't stored">
          <Input id="certificatePassword" name="certificatePassword" type="password" autoComplete="new-password" />
        </Field>
      </div>
    </FormDialog>
  );
}
