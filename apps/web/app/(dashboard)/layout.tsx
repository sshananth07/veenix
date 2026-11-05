import { NavBar } from "@/components/NavBar";
import { AssistantPanel, AssistantProvider } from "@/components/assistant/AssistantPanel";
import { requireOrg, requireSession } from "@/lib/session";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireSession();
  const { me, orgId, role } = await requireOrg();
  return (
    <AssistantProvider>
      <div className="flex min-h-screen bg-background">
        {/* A size container: page layouts follow the space left beside the assistant, not the window. */}
        <div className="@container min-w-0 flex-1">
          <NavBar userName={user.name} orgs={me.memberships} currentOrgId={orgId} role={role} />
          <main className="mx-auto max-w-[1400px] px-6 py-6">{children}</main>
        </div>
        <AssistantPanel />
      </div>
    </AssistantProvider>
  );
}
