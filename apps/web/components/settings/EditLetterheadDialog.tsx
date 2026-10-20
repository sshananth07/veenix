"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { updateLetterhead } from "@/actions/settings";
import { FormDialog } from "@/components/FormDialog";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export function EditLetterheadDialog({
  settings,
}: {
  settings: { companyName: string; companyReg: string; companyAddress: string; companyPhone: string; logoPath: string | null };
}) {
  const [removeLogo, setRemoveLogo] = useState(false);

  return (
    <FormDialog
      trigger={
        <Button variant="outline" size="sm">
          <Pencil className="h-3.5 w-3.5" />
          Update letterhead
        </Button>
      }
      title="Company letterhead"
      description="Shown at the top of every quotation, PO, RFQ and invoice PDF."
      submitLabel="Save letterhead"
      action={updateLetterhead}
    >
      <Field label="Company name" htmlFor="companyName" required>
        <Input id="companyName" name="companyName" defaultValue={settings.companyName} required />
      </Field>
      <Field label="Registration / SST no." htmlFor="companyReg">
        <Input id="companyReg" name="companyReg" defaultValue={settings.companyReg} />
      </Field>
      <Field label="Address" htmlFor="companyAddress">
        <Input id="companyAddress" name="companyAddress" defaultValue={settings.companyAddress} />
      </Field>
      <Field label="Phone" htmlFor="companyPhone">
        <Input id="companyPhone" name="companyPhone" defaultValue={settings.companyPhone} />
      </Field>
      <Field label="Logo" htmlFor="logo" hint="Shown on the letterhead preview. Recommended: square, at least 300x300px (JPG/PNG).">
        <div className="flex items-center gap-3">
          {settings.logoPath && !removeLogo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/uploads/logo/default?v=${encodeURIComponent(settings.logoPath)}`} alt="" className="h-12 w-12 rounded-md border object-cover" />
          )}
          <Input id="logo" name="logo" type="file" accept="image/png,image/jpeg,image/webp" className="flex-1" />
        </div>
        {settings.logoPath && (
          <label className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" name="removeLogo" value="1" checked={removeLogo} onChange={(e) => setRemoveLogo(e.target.checked)} />
            Remove the current logo
          </label>
        )}
      </Field>
    </FormDialog>
  );
}
