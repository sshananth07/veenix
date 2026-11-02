import { File, FileImage, FileSpreadsheet, FileText, FolderOpen, Trash2 } from "lucide-react";
import type { ProjectDetail } from "@/lib/projectQuery";
import { deleteProjectFile } from "@/actions/files";
import { formatFileSize } from "@/lib/files";
import { formatDate } from "@/lib/utils";
import { FormDialog } from "@/components/FormDialog";
import { FileUploadDropzone } from "@/components/projects/FileUploadDropzone";

const ICONS: Record<string, { icon: typeof File; tint: string }> = {
  "application/pdf": { icon: FileText, tint: "bg-red-100 text-red-700" },
  "image/png": { icon: FileImage, tint: "bg-blue-100 text-blue-700" },
  "image/jpeg": { icon: FileImage, tint: "bg-blue-100 text-blue-700" },
  "image/webp": { icon: FileImage, tint: "bg-blue-100 text-blue-700" },
  "application/vnd.ms-excel": { icon: FileSpreadsheet, tint: "bg-emerald-100 text-emerald-700" },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { icon: FileSpreadsheet, tint: "bg-emerald-100 text-emerald-700" },
};

export function FilesTab({ project }: { project: ProjectDetail }) {
  const files = project.files;

  if (files.length === 0) {
    return (
      <div className="rounded-xl border border-dashed bg-card px-6 py-14 text-center">
        <FolderOpen className="mx-auto h-9 w-9 text-muted-foreground" />
        <h3 className="mt-3 text-lg font-semibold">No files uploaded yet</h3>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Keep your project documents, drawings, photos and other files in one place.</p>
        <div className="mx-auto mt-6 max-w-md">
          <FileUploadDropzone projectId={project.id} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Files</h2>
          <p className="text-sm text-muted-foreground">
            {files.length} {files.length === 1 ? "file" : "files"}
          </p>
        </div>
        <div className="w-full max-w-sm">
          <FileUploadDropzone projectId={project.id} compact />
        </div>
      </div>

      <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-xs">
        {files.map((f) => {
          const { icon: Icon, tint } = ICONS[f.contentType] ?? { icon: File, tint: "bg-muted text-muted-foreground" };
          return (
            <li key={f.id} className="flex items-center gap-3 px-4 py-3">
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${tint}`}>
                <Icon className="h-5 w-5" />
              </span>
              <a href={`/api/uploads/file/${f.id}`} target="_blank" rel="noreferrer" className="min-w-0 flex-1 hover:underline">
                <div className="truncate font-medium">{f.name}</div>
                <div className="text-xs text-muted-foreground">
                  {formatFileSize(f.size)} · Uploaded {formatDate(f.createdAt)}
                </div>
              </a>
              <FormDialog
                destructive
                title={`Delete "${f.name}"?`}
                description="This cannot be undone."
                submitLabel="Delete file"
                action={deleteProjectFile.bind(null, f.id)}
                trigger={
                  <button className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-red-50 hover:text-red-600" aria-label={`Delete ${f.name}`} title="Delete file">
                    <Trash2 className="h-4 w-4" />
                  </button>
                }
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
