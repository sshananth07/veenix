"use client";

import { Pencil, UserRound } from "lucide-react";
import { createVendor, updateVendor } from "@/actions/vendors";
import { FormDialog } from "@/components/FormDialog";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export type VendorFormValues = {
  id: string;
  name: string;
  type: string | null;
  registrationNo: string | null;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  location: string | null;
  experienceYears: number | null;
  notes: string | null;
};

export function VendorFormDialog({ vendor, trigger }: { vendor?: VendorFormValues; trigger?: React.ReactNode }) {
  return (
    <FormDialog
      trigger={
        trigger ?? (
          <Button variant={vendor ? "outline" : "default"} size={vendor ? "sm" : "default"}>
            {vendor ? <Pencil className="h-3.5 w-3.5" /> : <UserRound className="h-4 w-4" />}
            {vendor ? "Edit vendor" : "Add vendor"}
          </Button>
        )
      }
      title={vendor ? "Edit vendor" : "New vendor"}
      description={vendor ? undefined : "Add their details once; invite them to quote from any project."}
      submitLabel={vendor ? "Save changes" : "Save vendor"}
      action={(fd) => (vendor ? updateVendor(vendor.id, fd) : createVendor(fd))}
      size="lg"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Vendor name" htmlFor="name" required className="sm:col-span-2">
          <Input id="name" name="name" defaultValue={vendor?.name} placeholder="e.g. ABC Interior Sdn Bhd" required />
        </Field>
        <Field label="Trade / specialty" htmlFor="type" className="sm:col-span-2" hint="Separate with commas, e.g. Carpentry & Cabinets, Kitchen Cabinets, Wardrobes">
          <Input id="type" name="type" defaultValue={vendor?.type ?? ""} placeholder="e.g. Carpentry & Cabinets" />
        </Field>
        <Field label="Registration no." htmlFor="registrationNo">
          <Input id="registrationNo" name="registrationNo" defaultValue={vendor?.registrationNo ?? ""} placeholder="e.g. 201901234567" />
        </Field>
        <Field label="Contact person" htmlFor="contactPerson">
          <Input id="contactPerson" name="contactPerson" defaultValue={vendor?.contactPerson ?? ""} placeholder="e.g. Amir Rahman" />
        </Field>
        <Field label="Phone" htmlFor="phone">
          <Input id="phone" name="phone" defaultValue={vendor?.phone ?? ""} placeholder="e.g. +60 12-345 6789" />
        </Field>
        <Field label="Email" htmlFor="email">
          <Input id="email" name="email" type="email" defaultValue={vendor?.email ?? ""} placeholder="e.g. sales@vendor.com" />
        </Field>
        <Field label="Location" htmlFor="location">
          <Input id="location" name="location" defaultValue={vendor?.location ?? ""} placeholder="e.g. Selangor" />
        </Field>
        <Field label="Experience (years)" htmlFor="experienceYears">
          <Input id="experienceYears" name="experienceYears" type="number" min={0} defaultValue={vendor?.experienceYears ?? ""} placeholder="e.g. 10" />
        </Field>
        <Field label="Notes" htmlFor="notes" className="sm:col-span-2">
          <Textarea id="notes" name="notes" rows={2} defaultValue={vendor?.notes ?? ""} />
        </Field>
      </div>
    </FormDialog>
  );
}
