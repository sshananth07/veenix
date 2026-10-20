"use client";

import { useState } from "react";
import { Building2, CalendarRange, Flag, Pencil, UserRound, Wallet } from "lucide-react";
import { updateProject } from "@/actions/projects";
import { FormDialog } from "@/components/FormDialog";
import { Button } from "@/components/ui/button";
import { AddressFields } from "@/components/ui/AddressFields";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PROJECT_STAGES, PROJECT_STAGE_LABEL } from "@/lib/types";

export type ProjectFormValues = {
  id: string;
  name: string;
  clientName: string;
  clientPhone: string | null;
  clientEmail: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  addressLine3: string | null;
  postcode: string | null;
  city: string | null;
  state: string | null;
  siteAddress: string;
  photoPath: string | null;
  propertyType: string | null;
  builtUpArea: string | null;
  budgetMin: number | null;
  budgetMax: number | null;
  pmName: string | null;
  siteName: string | null;
  targetStart: string;
  targetHandover: string;
  stage: string;
  cancelReason: string | null;
};

function SectionTitle({ icon: Icon, children }: { icon: typeof Building2; children: React.ReactNode }) {
  return (
    <h3 className="flex items-center gap-2.5 text-sm font-semibold">
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Icon className="h-4 w-4" />
      </span>
      {children}
    </h3>
  );
}

export function EditProjectDialog({ project }: { project: ProjectFormValues }) {
  const [stage, setStage] = useState(project.stage);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [start, setStart] = useState(project.targetStart);
  const [handover, setHandover] = useState(project.targetHandover);
  const [min, setMin] = useState(project.budgetMin != null ? String(project.budgetMin) : "");
  const [max, setMax] = useState(project.budgetMax != null ? String(project.budgetMax) : "");
  const datesInvalid = !!start && !!handover && handover < start;
  const budgetInvalid = min !== "" && max !== "" && Number(max) <= Number(min);

  return (
    <FormDialog
      trigger={
        <Button>
          <Pencil className="h-4 w-4" />
          Edit project
        </Button>
      }
      presentation="drawer"
      title="Edit project"
      submitLabel="Save changes"
      action={(fd) => updateProject(project.id, fd)}
      disabled={datesInvalid || budgetInvalid}
    >
      <section className="grid gap-4">
        <SectionTitle icon={Building2}>Basic information</SectionTitle>
        <Field label="Project name" htmlFor="name" required>
          <Input id="name" name="name" defaultValue={project.name} required />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Client name" htmlFor="clientName" required>
            <Input id="clientName" name="clientName" defaultValue={project.clientName} required />
          </Field>
          <Field label="Client phone" htmlFor="clientPhone">
            <Input id="clientPhone" name="clientPhone" defaultValue={project.clientPhone ?? ""} />
          </Field>
          <Field label="Client email" htmlFor="clientEmail" className="sm:col-span-2">
            <Input id="clientEmail" name="clientEmail" type="email" defaultValue={project.clientEmail ?? ""} />
          </Field>
        </div>
        <Field label="Project photo" htmlFor="photo" hint="Shown beside the project name. PNG, JPG or WEBP, up to 10 MB.">
          <div className="flex items-center gap-3">
            {project.photoPath && !removePhoto && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/uploads/photo/${project.id}?v=${encodeURIComponent(project.photoPath)}`} alt="" className="h-12 w-16 rounded-md border object-cover" />
            )}
            <Input id="photo" name="photo" type="file" accept="image/png,image/jpeg,image/webp" className="flex-1" />
          </div>
          {project.photoPath && (
            <label className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" name="removePhoto" value="1" checked={removePhoto} onChange={(e) => setRemovePhoto(e.target.checked)} />
              Remove the current photo
            </label>
          )}
        </Field>
      </section>

      <div className="border-t" />

      <section className="grid gap-4">
        <SectionTitle icon={Wallet}>Property &amp; budget</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Property type" htmlFor="propertyType">
            <Input id="propertyType" name="propertyType" defaultValue={project.propertyType ?? ""} />
          </Field>
          <Field label="Built-up area" htmlFor="builtUpArea">
            <Input id="builtUpArea" name="builtUpArea" defaultValue={project.builtUpArea ?? ""} />
          </Field>
          <Field label="Budget min (RM)" htmlFor="budgetMin">
            <Input id="budgetMin" name="budgetMin" type="number" min={0} value={min} onChange={(e) => setMin(e.target.value)} />
          </Field>
          <Field label="Budget max (RM)" htmlFor="budgetMax">
            <Input
              id="budgetMax"
              name="budgetMax"
              type="number"
              min={0}
              value={max}
              onChange={(e) => setMax(e.target.value)}
              className={budgetInvalid ? "border-red-500" : undefined}
            />
            {budgetInvalid && <p className="text-xs text-red-600">Max budget must be greater than min budget</p>}
          </Field>
        </div>
      </section>

      <div className="border-t" />

      <section className="grid gap-4">
        <SectionTitle icon={UserRound}>Team</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Project manager" htmlFor="pmName">
            <Input id="pmName" name="pmName" defaultValue={project.pmName ?? ""} />
          </Field>
          <Field label="Site supervisor" htmlFor="siteName">
            <Input id="siteName" name="siteName" defaultValue={project.siteName ?? ""} />
          </Field>
        </div>
      </section>

      <div className="border-t" />

      <section className="grid gap-4">
        <SectionTitle icon={CalendarRange}>Timeline</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Site start" htmlFor="targetStart">
            <Input id="targetStart" name="targetStart" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="Target handover" htmlFor="targetHandover">
            <Input
              id="targetHandover"
              name="targetHandover"
              type="date"
              value={handover}
              onChange={(e) => setHandover(e.target.value)}
              className={datesInvalid ? "border-red-500" : undefined}
            />
            {datesInvalid && <p className="text-xs text-red-600">Handover must be after the site start</p>}
          </Field>
        </div>
      </section>

      <div className="border-t" />

      <section className="grid gap-4">
        <SectionTitle icon={Flag}>Stage</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Stage" htmlFor="stage" required>
            <Select name="stage" value={stage} onValueChange={setStage}>
              <SelectTrigger id="stage">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROJECT_STAGES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {PROJECT_STAGE_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {stage === "CANCELLED" && (
            <Field label="Reason for cancelling" htmlFor="cancelReason">
              <Input id="cancelReason" name="cancelReason" defaultValue={project.cancelReason ?? ""} />
            </Field>
          )}
        </div>
      </section>

      <div className="border-t" />

      <section className="grid gap-4">
        <SectionTitle icon={Building2}>Site address (Malaysia)</SectionTitle>
        <AddressFields
          layout="inline"
          required
          values={project.addressLine1 || project.postcode ? project : project.siteAddress ? { addressLine1: project.siteAddress } : undefined}
        />
      </section>
    </FormDialog>
  );
}
