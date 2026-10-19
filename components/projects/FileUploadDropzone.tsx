"use client";

import { useRef, useState, useTransition } from "react";
import { AlertCircle, UploadCloud } from "lucide-react";
import { uploadProjectFiles } from "@/actions/files";
import { cn } from "@/lib/utils";

// A click-to-browse and drag-and-drop area. Every file dropped or picked is
// uploaded in one call to the server action.
export function FileUploadDropzone({ projectId, compact = false }: { projectId: string; compact?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function upload(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    const formData = new FormData();
    list.forEach((f) => formData.append("files", f));
    setError(null);
    startTransition(async () => {
      const result = await uploadProjectFiles(projectId, formData);
      if (!result.ok) setError(result.error);
      if (inputRef.current) inputRef.current.value = "";
    });
  }

  return (
    <div className="grid gap-2">
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          upload(e.dataTransfer.files);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed text-center transition-colors",
          compact ? "px-4 py-4" : "px-6 py-10",
          dragging ? "border-primary bg-primary/5" : "border-border bg-muted/20 hover:border-primary/50 hover:bg-muted/30",
          pending && "pointer-events-none opacity-60"
        )}
      >
        <UploadCloud className={cn("text-muted-foreground", compact ? "h-6 w-6" : "h-8 w-8")} />
        <div className="text-sm">
          <span className="font-medium text-primary">{pending ? "Uploading..." : "Click to browse"}</span>
          <span className="text-muted-foreground"> or drag and drop files here</span>
        </div>
        <p className="text-xs text-muted-foreground">PDF, JPG, PNG, DOC, XLS (max 10 MB each)</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx"
          onChange={(e) => e.target.files && upload(e.target.files)}
        />
      </div>
      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}
