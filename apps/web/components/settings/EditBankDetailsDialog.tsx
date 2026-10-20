"use client";

import { Pencil } from "lucide-react";
import { updateBankDetails } from "@/actions/settings";
import { FormDialog } from "@/components/FormDialog";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export function EditBankDetailsDialog({
  settings,
}: {
  settings: { bankName: string; bankAccountName: string; bankAccount: string; swiftCode: string | null };
}) {
  return (
    <FormDialog
      trigger={
        <Button variant="outline" size="sm">
          <Pencil className="h-3.5 w-3.5" />
          Edit bank details
        </Button>
      }
      title="Bank details"
      description="Shown on every invoice so clients know where to pay."
      submitLabel="Save bank details"
      action={updateBankDetails}
    >
      <Field label="Bank name" htmlFor="bankName" required>
        <Input id="bankName" name="bankName" defaultValue={settings.bankName} required />
      </Field>
      <Field label="Account name" htmlFor="bankAccountName">
        <Input id="bankAccountName" name="bankAccountName" defaultValue={settings.bankAccountName} />
      </Field>
      <Field label="Account number" htmlFor="bankAccount" required>
        <Input id="bankAccount" name="bankAccount" defaultValue={settings.bankAccount} required />
      </Field>
      <Field label="Swift code" htmlFor="swiftCode" hint="For international transfers, optional">
        <Input id="swiftCode" name="swiftCode" defaultValue={settings.swiftCode ?? ""} placeholder="e.g. MBBEMYKLXXX" />
      </Field>
    </FormDialog>
  );
}
