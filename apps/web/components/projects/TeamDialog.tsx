"use client";

import { Users } from "lucide-react";
import type { MemberDto } from "@veenix/shared";
import { setAssignees } from "@/actions/team";
import { FormDialog } from "@/components/FormDialog";
import { Button } from "@/components/ui/button";
import { ok } from "@/lib/actionResult";

type Assignable = "project_manager" | "site_staff";
const isAssignable = (r: string): r is Assignable => r === "project_manager" || r === "site_staff";

/** Who works on this project. Project managers and site staff only see projects they're assigned to. */
export function TeamDialog({ project, members }: { project: { id: string; assignees: { userId: string }[] }; members: MemberDto[] }) {
  const assignable = members.filter((m) => isAssignable(m.role));
  const current = new Set(project.assignees.map((a) => a.userId));
  return (
    <FormDialog
      trigger={
        <Button variant="outline" size="sm">
          <Users className="h-3.5 w-3.5" />
          Team
        </Button>
      }
      title="Project team"
      description="Project managers and site staff see only the projects they're assigned to."
      action={async (fd) => {
        const picked = new Set(fd.getAll("assignee").map(String));
        const assignees = assignable.filter((m) => picked.has(m.userId)).map((m) => ({ userId: m.userId, role: m.role as Assignable }));
        return assignable.length === 0 ? ok() : setAssignees(project.id, assignees);
      }}
    >
      {assignable.length === 0 ? (
        <p className="text-sm text-muted-foreground">No project managers or site staff yet. Invite them from Settings.</p>
      ) : (
        <ul className="grid gap-2">
          {assignable.map((m) => (
            <li key={m.userId}>
              <label className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm">
                <input type="checkbox" name="assignee" value={m.userId} defaultChecked={current.has(m.userId)} className="h-4 w-4" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{m.name || m.email}</span>
                  <span className="block text-xs text-muted-foreground">{m.email}</span>
                </span>
                <span className="text-xs capitalize text-muted-foreground">{m.role.replace("_", " ")}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </FormDialog>
  );
}
