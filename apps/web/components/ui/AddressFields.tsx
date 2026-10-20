"use client";

import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MY_STATES, type AddressParts } from "@/lib/address";

// Malaysian address block: up to three lines, then postcode, city and state.
// Renders plain named inputs so it drops into any FormDialog.
export function AddressFields({
  values,
  required = false,
  label = "Site address",
  layout = "boxed",
}: {
  values?: AddressParts;
  required?: boolean;
  label?: string;
  // "inline" drops the border and legend (the caller supplies a heading) and
  // lays the three address lines out side by side.
  layout?: "boxed" | "inline";
}) {
  if (layout === "inline") {
    return (
      <div className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Address line 1" htmlFor="addressLine1" required={required}>
            <Input id="addressLine1" name="addressLine1" defaultValue={values?.addressLine1 ?? ""} placeholder="e.g. No. 12, Jalan Flora 1/3" required={required} />
          </Field>
          <Field label="Address line 2" htmlFor="addressLine2">
            <Input id="addressLine2" name="addressLine2" defaultValue={values?.addressLine2 ?? ""} placeholder="e.g. Taman Melati" />
          </Field>
          <Field label="Address line 3" htmlFor="addressLine3">
            <Input id="addressLine3" name="addressLine3" defaultValue={values?.addressLine3 ?? ""} placeholder="e.g. Seksyen 7" />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Postcode" htmlFor="postcode" required={required}>
            <Input id="postcode" name="postcode" defaultValue={values?.postcode ?? ""} placeholder="e.g. 43000" inputMode="numeric" maxLength={5} pattern="\d{5}" title="5 digits, e.g. 47300" required={required} />
          </Field>
          <Field label="City" htmlFor="city" required={required}>
            <Input id="city" name="city" defaultValue={values?.city ?? ""} placeholder="e.g. Shah Alam" required={required} />
          </Field>
          <Field label="State" htmlFor="state" required={required}>
            <Select name="state" defaultValue={values?.state || undefined} required={required}>
              <SelectTrigger id="state">
                <SelectValue placeholder="Select state" />
              </SelectTrigger>
              <SelectContent>
                {MY_STATES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      </div>
    );
  }

  return (
    <fieldset className="grid gap-3 rounded-lg border bg-muted/20 p-4 sm:col-span-2">
      <legend className="px-1 text-sm font-medium">
        {label}
        {required && <span className="ml-0.5 text-red-600">*</span>}
      </legend>
      <Field label="Address line 1" htmlFor="addressLine1" required={required} hint="Unit or house number, building">
        <Input id="addressLine1" name="addressLine1" defaultValue={values?.addressLine1 ?? ""} placeholder="No. 12, Jalan SS 2/24" required={required} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Address line 2" htmlFor="addressLine2" hint="Street">
          <Input id="addressLine2" name="addressLine2" defaultValue={values?.addressLine2 ?? ""} placeholder="Jalan Bahagia" />
        </Field>
        <Field label="Address line 3" htmlFor="addressLine3" hint="Taman or area">
          <Input id="addressLine3" name="addressLine3" defaultValue={values?.addressLine3 ?? ""} placeholder="Taman Bahagia" />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-[120px_1fr_1fr]">
        <Field label="Postcode" htmlFor="postcode" required={required}>
          <Input
            id="postcode"
            name="postcode"
            defaultValue={values?.postcode ?? ""}
            placeholder="47300"
            inputMode="numeric"
            maxLength={5}
            pattern="\d{5}"
            title="5 digits, e.g. 47300"
            required={required}
          />
        </Field>
        <Field label="City" htmlFor="city" required={required}>
          <Input id="city" name="city" defaultValue={values?.city ?? ""} placeholder="Petaling Jaya" required={required} />
        </Field>
        <Field label="State" htmlFor="state" required={required}>
          <Select name="state" defaultValue={values?.state || undefined} required={required}>
            <SelectTrigger id="state">
              <SelectValue placeholder="Select state" />
            </SelectTrigger>
            <SelectContent>
              {MY_STATES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
    </fieldset>
  );
}
