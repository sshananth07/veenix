"use client";

import { createWorkItem, updateWorkItem } from "@/actions/workItems";
import { FormDialog } from "@/components/FormDialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export function WorkItemDialog({
  projectId,
  workItem,
  trigger,
}: {
  projectId: string;
  workItem?: { id: string; name: string; description: string | null };
  trigger: React.ReactNode;
}) {
  return (
    <FormDialog
      trigger={trigger}
      title={workItem ? "Edit work item" : "New work item"}
      description={
        workItem
          ? undefined
          : "The area or scope a client thinks in, like Kitchen or Master Bathroom. Its cost is the sum of the BOM lines you add under it."
      }
      submitLabel={workItem ? "Save changes" : "Create work item"}
      action={(fd) => (workItem ? updateWorkItem(workItem.id, fd) : createWorkItem(projectId, fd))}
    >
      <Field label="Work item name" htmlFor="name" required>
        <Input id="name" name="name" defaultValue={workItem?.name} placeholder="e.g. Kitchen" required />
      </Field>
      <Field label="Description" htmlFor="description" hint="Optional. What this area covers.">
        <Input id="description" name="description" defaultValue={workItem?.description ?? ""} placeholder="e.g. Dry kitchen and wet kitchen" />
      </Field>
    </FormDialog>
  );
}
