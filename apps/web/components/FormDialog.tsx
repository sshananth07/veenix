"use client";

import { useState, useTransition } from "react";
import { AlertCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DrawerContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { UploadPurpose } from "@veenix/shared";
import type { ActionResult } from "@/lib/actionResult";
import { uploadFormFiles } from "@/lib/upload-client";
import { cn } from "@/lib/utils";

export function FormDialog({
  trigger,
  title,
  description,
  submitLabel = "Save",
  pendingLabel = "Saving...",
  action,
  children,
  size = "md",
  destructive = false,
  disabled = false,
  presentation = "dialog",
  defaultOpen = false,
  uploadPurpose,
}: {
  trigger: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  submitLabel?: string;
  pendingLabel?: string;
  action: (formData: FormData) => Promise<ActionResult>;
  children?: React.ReactNode;
  size?: "md" | "lg" | "xl";
  destructive?: boolean;
  disabled?: boolean;
  presentation?: "dialog" | "drawer";
  defaultOpen?: boolean;
  /** Uploads the form's files to storage first and sends their keys instead (Task 8.4). */
  uploadPurpose?: UploadPurpose;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (formData: FormData) =>
    startTransition(async () => {
      setError(null);
      try {
        const data = uploadPurpose ? await uploadFormFiles(formData, uploadPurpose) : formData;
        const result = await action(data);
        if (result.ok) setOpen(false);
        else setError(result.error);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not upload the file");
      }
    });

  const errorBox = error && (
    <p role="alert" className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      {error}
    </p>
  );

  const buttons = (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(false)}>
        Cancel
      </Button>
      <Button type="submit" variant={destructive ? "destructive" : "default"} disabled={pending || disabled}>
        {pending ? pendingLabel : submitLabel}
      </Button>
    </>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      {presentation === "drawer" ? (
        <DrawerContent>
          <div className="flex items-start justify-between gap-4 border-b px-6 py-5">
            <div>
              <DialogTitle className="text-xl">{title}</DialogTitle>
              {description && <DialogDescription className="mt-1.5">{description}</DialogDescription>}
            </div>
            <DialogClose className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring">
              <X className="h-5 w-5" />
              <span className="sr-only">Close</span>
            </DialogClose>
          </div>
          <form action={run} className="flex min-h-0 flex-1 flex-col">
            <div className="grid flex-1 content-start gap-6 overflow-y-auto px-6 py-5">
              {children}
              {errorBox}
            </div>
            <div className="flex justify-end gap-3 border-t bg-background px-6 py-4">{buttons}</div>
          </form>
        </DrawerContent>
      ) : (
        <DialogContent className={cn(size === "lg" && "max-w-2xl", size === "xl" && "max-w-4xl")}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <form action={run} className="grid gap-4">
            {children}
            {errorBox}
            <DialogFooter className="gap-2 sm:gap-0">{buttons}</DialogFooter>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}
