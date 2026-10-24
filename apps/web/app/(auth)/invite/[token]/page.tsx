import { requireSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { acceptInvitation } from "../../onboarding/actions";

export default async function InvitePage({ params }: { params: { token: string } }) {
  await requireSession();
  return (
    <form action={acceptInvitation.bind(null, params.token)} className="w-full max-w-sm space-y-4 rounded-xl border bg-card p-6 shadow-sm">
      <div>
        <h1 className="text-xl font-semibold">You're invited</h1>
        <p className="mt-1 text-sm text-muted-foreground">Join the organization to start working with your team.</p>
      </div>
      <Button type="submit" className="w-full">Join the organization</Button>
    </form>
  );
}
