import { can, type TaskDto } from "@veenix/shared";
import { api } from "@/lib/api";
import { requireOrg } from "@/lib/session";
import { TaskList } from "@/components/TaskList";

export default async function TasksPage() {
  const { role } = await requireOrg();
  const tasks = await api<TaskDto[]>("/tasks");
  const open = tasks.filter((t) => t.status === "open").length;
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">My tasks</h1>
        <p className="text-sm text-muted-foreground">{open} open. Tasks assigned to you, and ones you created for nobody in particular.</p>
      </div>
      <TaskList tasks={tasks} canDelete={can(role, "task:write")} />
    </div>
  );
}
