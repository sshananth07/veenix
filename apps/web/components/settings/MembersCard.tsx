"use client";

import { useState, useTransition } from "react";
import { AlertCircle, ShieldCheck, UserPlus } from "lucide-react";
import { ROLES, type InvitationDto, type MemberDto, type Role } from "@veenix/shared";
import { changeMemberRole, inviteMember, removeMember, revokeInvitation } from "@/actions/team";
import { ActionButton } from "@/components/ActionButton";
import { FormDialog } from "@/components/FormDialog";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDate } from "@/lib/utils";

const label = (r: Role) => r.replace("_", " ").replace(/^./, (c) => c.toUpperCase());

function RoleSelect({ member }: { member: MemberDto }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="grid gap-1">
      <Select
        value={member.role}
        disabled={pending}
        onValueChange={(role) =>
          startTransition(async () => {
            setError(null);
            const r = await changeMemberRole(member.id, role as Role);
            if (!r.ok) setError(r.error);
          })
        }
      >
        <SelectTrigger aria-label={`Role for ${member.email}`} className="h-8 w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ROLES.map((r) => (
            <SelectItem key={r} value={r}>
              {label(r)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && (
        <p role="alert" className="flex items-start gap-1 text-xs text-red-700">
          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}

export function MembersCard({ members, invitations }: { members: MemberDto[]; invitations: InvitationDto[] }) {
  return (
    <section id="users" className="rounded-xl border bg-card p-5 shadow-xs">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <h2 className="font-semibold">Users &amp; Permissions</h2>
        </div>
        <FormDialog
          trigger={
            <Button size="sm">
              <UserPlus className="h-3.5 w-3.5" />
              Invite
            </Button>
          }
          title="Invite a team member"
          description="They get an email with a link to join. The link works once and expires."
          submitLabel="Send invitation"
          action={inviteMember}
        >
          <Field label="Email" htmlFor="inviteEmail" required>
            <Input id="inviteEmail" name="email" type="email" required />
          </Field>
          <Field label="Role" htmlFor="inviteRole" required>
            <select id="inviteRole" name="role" defaultValue="project_manager" className="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {label(r)}
                </option>
              ))}
            </select>
          </Field>
        </FormDialog>
      </div>

      <ul className="divide-y rounded-lg border">
        {members.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
            <div className="min-w-0 flex-1">
              <div className="font-medium">{m.name || m.email}</div>
              <div className="text-xs text-muted-foreground">{m.email}</div>
            </div>
            <RoleSelect member={m} />
            <ActionButton size="sm" variant="outline" action={removeMember.bind(null, m.id)} pendingLabel="Removing...">
              Remove
            </ActionButton>
          </li>
        ))}
      </ul>

      {invitations.length > 0 && (
        <div className="mt-5">
          <h3 className="mb-2 text-sm font-semibold">Pending invitations</h3>
          <ul className="divide-y rounded-lg border">
            {invitations.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{i.email}</div>
                  <div className="text-xs text-muted-foreground">
                    {label(i.role)} · expires {formatDate(i.expiresAt)}
                  </div>
                </div>
                <ActionButton size="sm" variant="outline" action={revokeInvitation.bind(null, i.id)} pendingLabel="Revoking...">
                  Revoke
                </ActionButton>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
