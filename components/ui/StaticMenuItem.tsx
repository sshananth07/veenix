"use client";

import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

// A dropdown item that holds its own trigger (e.g. a dialog button) instead
// of navigating on select: selecting it must not close the menu before the
// child's own click handler runs.
export function StaticMenuItem({ children }: { children: React.ReactNode }) {
  return (
    <DropdownMenuItem asChild onSelect={(e) => e.preventDefault()}>
      <div>{children}</div>
    </DropdownMenuItem>
  );
}
