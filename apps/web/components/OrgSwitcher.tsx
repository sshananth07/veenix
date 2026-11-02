"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import type { MeDto } from "@veenix/shared";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { switchOrganization } from "@/app/(auth)/onboarding/actions";

export function OrgSwitcher({ orgs, currentOrgId }: { orgs: MeDto["memberships"]; currentOrgId: string }) {
  const current = orgs.find((o) => o.orgId === currentOrgId);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">
          <span className="max-w-48 truncate">{current?.companyName ?? "Choose organization"}</span>
          <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {orgs.map((org) => (
          <DropdownMenuItem key={org.orgId} asChild onSelect={(e) => e.preventDefault()}>
            <form action={switchOrganization.bind(null, org.orgId)}>
              <button type="submit" className="flex w-full items-center gap-2 text-left">
                <Check className={org.orgId === currentOrgId ? "h-4 w-4" : "h-4 w-4 opacity-0"} />
                {org.companyName}
              </button>
            </form>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
