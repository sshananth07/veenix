import { redirect } from "next/navigation";
import type { MeDto } from "@veenix/shared";
import { apiRaw, requireSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createOrganization } from "./actions";

export default async function OnboardingPage() {
  await requireSession();
  const me = await apiRaw<MeDto>("/me");
  if (me.memberships.length > 0) redirect("/");
  return (
    <form action={createOrganization} className="w-full max-w-sm space-y-4 rounded-xl border bg-card p-6 shadow-xs">
      <div>
        <h1 className="text-xl font-semibold">Set up your company</h1>
        <p className="mt-1 text-sm text-muted-foreground">Were you invited? Open the link in your invitation email instead.</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="companyName">Your company name</Label>
        <Input id="companyName" name="companyName" required minLength={2} maxLength={160} autoComplete="organization" />
      </div>
      <Button type="submit" className="w-full">Create company</Button>
    </form>
  );
}
