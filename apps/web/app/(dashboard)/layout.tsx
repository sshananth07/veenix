import { NavBar } from "@/components/NavBar";
import { requireOrg, requireSession } from "@/lib/session";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireSession();
  const { me, orgId } = await requireOrg();
  return (
    <div className="min-h-screen bg-background">
      <NavBar userName={user.name} orgs={me.memberships} currentOrgId={orgId} />
      <main className="mx-auto max-w-[1400px] px-6 py-6">{children}</main>
    </div>
  );
}
