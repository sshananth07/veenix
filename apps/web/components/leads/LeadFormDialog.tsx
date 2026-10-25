"use client";

import { senToInput } from "@veenix/shared";
import { useState } from "react";
import { MapPin, UserRound } from "lucide-react";
import { createLead, updateLead } from "@/actions/leads";
import { FormDialog } from "@/components/FormDialog";
import { AddressFields } from "@/components/ui/AddressFields";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LEAD_SOURCES, LEAD_STATUS_LABEL, LEAD_STATUSES, PROPERTY_TYPES } from "@/lib/types";

export type LeadFormValues = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  source: string;
  campaign: string | null;
  propertyType: string | null;
  builtUpArea: string | null;
  budgetMin: number | null;
  budgetMax: number | null;
  addressLine1: string | null;
  addressLine2: string | null;
  addressLine3: string | null;
  postcode: string | null;
  city: string | null;
  state: string | null;
  siteAddress: string | null;
  targetStart: string | null;
  assignedTo: string | null;
  status: string;
  surveyAt: string;
};

function SectionTitle({ icon: Icon, children }: { icon: typeof MapPin; children: React.ReactNode }) {
  return (
    <h3 className="flex items-center gap-2.5 text-sm font-semibold">
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Icon className="h-4 w-4" />
      </span>
      {children}
    </h3>
  );
}

export function LeadFormDialog({ lead, trigger, defaultOpen }: { lead?: LeadFormValues; trigger: React.ReactNode; defaultOpen?: boolean }) {
  const [min, setMin] = useState(senToInput(lead?.budgetMin));
  const [max, setMax] = useState(senToInput(lead?.budgetMax));
  const budgetInvalid = min !== "" && max !== "" && Number(max) <= Number(min);
  const legacyType = lead?.propertyType && !PROPERTY_TYPES.includes(lead.propertyType) ? lead.propertyType : null;

  return (
    <FormDialog
      trigger={trigger}
      presentation="drawer"
      defaultOpen={defaultOpen}
      title={lead ? "Edit lead" : "New lead"}
      description={lead ? undefined : "Just enough to react to the enquiry. Detail is added once the lead is qualified."}
      submitLabel={lead ? "Save changes" : "Save lead"}
      action={(fd) => (lead ? updateLead(lead.id, fd) : createLead(fd))}
      disabled={budgetInvalid}
    >
      <section className="grid gap-4">
        <SectionTitle icon={UserRound}>Basic information</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="name" required>
            <Input id="name" name="name" defaultValue={lead?.name} placeholder="e.g. Nur Aisyah Rahman" required />
          </Field>
          <Field label="Phone" htmlFor="phone" required>
            <Input id="phone" name="phone" defaultValue={lead?.phone} placeholder="e.g. +60 12-345 6789" required />
          </Field>
          <Field label="Email" htmlFor="email">
            <Input id="email" name="email" type="email" defaultValue={lead?.email ?? ""} placeholder="e.g. aisyah@email.com" />
          </Field>
          <Field label="Source" htmlFor="source" required>
            <Select name="source" defaultValue={lead?.source ?? "Facebook Ads"}>
              <SelectTrigger id="source">
                <SelectValue placeholder="Select source" />
              </SelectTrigger>
              <SelectContent>
                {LEAD_SOURCES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Campaign" htmlFor="campaign">
            <Input id="campaign" name="campaign" defaultValue={lead?.campaign ?? ""} placeholder="e.g. Raya Campaign" />
          </Field>
          <Field label="Status" htmlFor="status" required>
            <Select name="status" defaultValue={lead?.status ?? "NEW"}>
              <SelectTrigger id="status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LEAD_STATUSES.filter((s) => s !== "CONVERTED").map((s) => (
                  <SelectItem key={s} value={s}>
                    {LEAD_STATUS_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Property type" htmlFor="propertyType">
            <Select name="propertyType" defaultValue={lead?.propertyType || undefined}>
              <SelectTrigger id="propertyType">
                <SelectValue placeholder="Select property type" />
              </SelectTrigger>
              <SelectContent>
                {legacyType && (
                  <SelectGroup>
                    <SelectLabel>Current value</SelectLabel>
                    <SelectItem value={legacyType}>{legacyType}</SelectItem>
                  </SelectGroup>
                )}
                {PROPERTY_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Built-up area (sq ft)" htmlFor="builtUpArea">
            <Input id="builtUpArea" name="builtUpArea" defaultValue={lead?.builtUpArea ?? ""} placeholder="e.g. 1,200" />
          </Field>

          <div className="grid gap-1.5 sm:col-span-2">
            <span className="text-sm font-medium leading-none">Budget range (RM)</span>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                id="budgetMin"
                name="budgetMin"
                type="number"
                min={0}
                value={min}
                onChange={(e) => setMin(e.target.value)}
                placeholder="Min, e.g. 100,000"
                aria-label="Budget minimum"
              />
              <div className="grid gap-1.5">
                <Input
                  id="budgetMax"
                  name="budgetMax"
                  type="number"
                  min={0}
                  value={max}
                  onChange={(e) => setMax(e.target.value)}
                  placeholder="Max, e.g. 200,000"
                  aria-label="Budget maximum"
                  aria-invalid={budgetInvalid}
                  className={budgetInvalid ? "border-red-500 focus-visible:ring-red-500" : undefined}
                />
                {budgetInvalid && <p className="text-xs text-red-600">Max budget must be greater than min budget.</p>}
              </div>
            </div>
          </div>

          <Field label="Assigned to" htmlFor="assignedTo">
            <Input id="assignedTo" name="assignedTo" defaultValue={lead?.assignedTo ?? ""} placeholder="e.g. Hafiz, Sales" />
          </Field>
          <Field label="Site survey date" htmlFor="surveyAt">
            <Input id="surveyAt" name="surveyAt" type="date" defaultValue={lead?.surveyAt ?? ""} />
          </Field>
          <Field label="Target start" htmlFor="targetStart">
            <Input id="targetStart" name="targetStart" defaultValue={lead?.targetStart ?? ""} placeholder="e.g. Early October 2026" />
          </Field>
        </div>
      </section>

      <div className="border-t" />

      <section className="grid gap-4">
        <SectionTitle icon={MapPin}>Site address (Malaysia)</SectionTitle>
        <AddressFields
          layout="inline"
          values={
            lead?.addressLine1 || lead?.postcode || lead?.city || lead?.state
              ? lead
              : lead?.siteAddress
                ? { addressLine1: lead.siteAddress }
                : undefined
          }
        />
      </section>
    </FormDialog>
  );
}
