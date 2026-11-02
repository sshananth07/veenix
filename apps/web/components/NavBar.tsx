"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, FolderKanban, Home, LogOut, Settings, Truck, Users } from "lucide-react";
import { can, type MeDto, type Permission, type Role } from "@veenix/shared";
import { Avatar } from "@/components/ui/avatar";
import { GlobalSearch } from "@/components/GlobalSearch";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { OrgSwitcher } from "@/components/OrgSwitcher";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

// `needs` only hides links; the API enforces every permission.
const LINKS: { href: string; label: string; icon: typeof Home; needs?: Permission }[] = [
  { href: "/", label: "Home", icon: Home },
  { href: "/leads", label: "Leads", icon: Users, needs: "lead:read" },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/vendors", label: "Vendors", icon: Truck, needs: "vendor:read" },
  { href: "/reports", label: "Reports", icon: BarChart3, needs: "report:read" },
  { href: "/settings", label: "Settings", icon: Settings, needs: "org:manage" },
];

export function NavBar({ userName, orgs, currentOrgId, role }: { userName: string; orgs: MeDto["memberships"]; currentOrgId: string; role: Role }) {
  const pathname = usePathname();
  const links = LINKS.filter((l) => !l.needs || can(role, l.needs));
  return (
    <header className="border-b bg-card">
      <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-6 px-6">
        <Link href="/" className="flex items-center gap-2 text-xl font-bold tracking-tight text-primary">
          <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 11.5 12 4l9 7.5" />
            <path d="M5.5 10v9.5h13V10" />
            <path d="m9 19.5 3-6 3 6" />
          </svg>
          Veenix
        </Link>
        <span className="hidden h-7 w-px bg-border md:block" aria-hidden />
        <nav className="flex min-w-0 items-center gap-1 overflow-x-auto">
          {links.map((link) => {
            const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-16 items-center gap-2 whitespace-nowrap px-3 text-sm font-medium transition-colors",
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <link.icon className="h-[18px] w-[18px]" />
                <span>{link.label}</span>
                {active && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-primary" />}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-4">
          <GlobalSearch />
          {orgs.length > 1 && <OrgSwitcher orgs={orgs} currentOrgId={currentOrgId} />}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button aria-label="Account menu" className="rounded-full focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">
                <Avatar name={userName} className="h-9 w-9" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{userName}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={async () => {
                  await authClient.signOut();
                  window.location.href = "/login";
                }}
              >
                <LogOut className="mr-2 h-4 w-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
