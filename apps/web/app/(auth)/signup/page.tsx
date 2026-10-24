"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { AuthForm } from "@/components/auth/AuthForm";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function SignupPage() {
  const router = useRouter();
  return (
    <AuthForm
      title="Create your account"
      subtitle="You'll verify your email and set up two-factor sign-in next."
      submitLabel="Create account"
      footer={<>Already have an account? <Link className="underline" href="/login">Sign in</Link></>}
      onSubmit={async (f) => {
        const email = String(f.get("email"));
        const { error } = await authClient.signUp.email({ name: String(f.get("name")), email, password: String(f.get("password")), callbackURL: "/setup-mfa" });
        if (error) return error.message ?? "Could not create the account";
        router.push(`/verify-email?email=${encodeURIComponent(email)}`);
        return null;
      }}
    >
      <div className="space-y-1.5"><Label htmlFor="name">Your name</Label><Input id="name" name="name" required autoComplete="name" /></div>
      <div className="space-y-1.5"><Label htmlFor="email">Email</Label><Input id="email" name="email" type="email" required autoComplete="email" /></div>
      <div className="space-y-1.5"><Label htmlFor="password">Password</Label><Input id="password" name="password" type="password" required minLength={12} autoComplete="new-password" /><p className="text-xs text-muted-foreground">At least 12 characters. A short sentence works well.</p></div>
    </AuthForm>
  );
}
