import Link from "next/link";
import { Bot, Check, ListChecks, Trash2 } from "lucide-react";
import type { TaskDto } from "@veenix/shared";
import { completeTask, deleteTask } from "@/actions/tasks";
import { ActionButton } from "@/components/ActionButton";
import { FormDialog } from "@/components/FormDialog";
import { cn, formatDateTime } from "@/lib/utils";

/** Tasks with complete and delete. Used on the Tasks screen and a project's Updates tab. */
export function TaskList({ tasks, canDelete, showProject = true }: { tasks: TaskDto[]; canDelete: boolean; showProject?: boolean }) {
  if (tasks.length === 0) {
    return (
      <div className="rounded-xl border border-dashed bg-card px-6 py-10 text-center">
        <ListChecks className="mx-auto size-8 text-muted-foreground" />
        <p className="mt-2 font-semibold">No tasks</p>
        <p className="text-sm text-muted-foreground">Ask the assistant to create one, e.g. &ldquo;remind me to order tiles on Friday&rdquo;.</p>
      </div>
    );
  }
  const now = Date.now();
  return (
    <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-xs">
      {tasks.map((t) => {
        const overdue = t.status === "open" && t.dueAt && new Date(t.dueAt).getTime() < now;
        return (
          <li key={t.id} className="flex items-center gap-3 px-4 py-3">
            <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full", t.status === "done" ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground")}>
              {t.status === "done" ? <Check className="size-4" /> : <ListChecks className="size-4" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className={cn("truncate font-medium", t.status === "done" && "text-muted-foreground line-through")}>{t.title}</p>
              <p className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                {t.dueAt && <span className={cn(overdue && "font-medium text-red-600")}>Due {formatDateTime(t.dueAt)}</span>}
                {t.assigneeName && <span>For {t.assigneeName}</span>}
                {showProject && t.projectId && (
                  <Link href={`/projects/${t.projectId}?tab=updates`} className="hover:underline">
                    {t.projectName ?? "Project"}
                  </Link>
                )}
                {t.fromAssistant && (
                  <span className="flex items-center gap-1">
                    <Bot className="size-3" aria-hidden /> From the assistant
                  </span>
                )}
              </p>
            </div>
            {t.status === "open" && (
              <ActionButton variant="outline" size="sm" action={completeTask.bind(null, t.id)} pendingLabel="Saving...">
                <Check className="size-3.5" /> Done
              </ActionButton>
            )}
            {canDelete && (
              <FormDialog
                destructive
                title={`Delete "${t.title}"?`}
                description="This cannot be undone."
                submitLabel="Delete task"
                action={deleteTask.bind(null, t.id)}
                trigger={
                  <button className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-red-50 hover:text-red-600" aria-label={`Delete ${t.title}`}>
                    <Trash2 className="size-4" />
                  </button>
                }
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
