"use client";

import Link from "next/link";
import { ExternalLink, MoreHorizontal, Pencil } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export function LeadRowMenu({ leadId, name, projectId }: { leadId: string; name: string; projectId: string | null }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={`Actions for ${name}`}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href={`/leads/${leadId}`}>
            <ExternalLink className="mr-2 h-4 w-4" />
            Open lead
          </Link>
        </DropdownMenuItem>
        {projectId ? (
          <DropdownMenuItem asChild>
            <Link href={`/projects/${projectId}`}>
              <ExternalLink className="mr-2 h-4 w-4" />
              Open project
            </Link>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem asChild>
            <Link href={`/leads/${leadId}?edit=1`}>
              <Pencil className="mr-2 h-4 w-4" />
              Edit lead
            </Link>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
