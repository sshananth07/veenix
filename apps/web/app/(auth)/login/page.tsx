"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient, returnPath } from "@/lib/auth-client";
import { AuthForm } from "@/components/auth/AuthForm";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage() {
  const router = useRouter();
  return (
    <AuthForm
      title="Sign in"
      submitLabel="Sign in"
      footer={<><Link className="underline" href="/forgot-password">Forgot password?</Link> · <Link className="underline" href="/signup">Create an account</Link></>}
      onSubmit={async (f) => {
        const next = returnPath(); // remembered before the MFA redirect
        const { data, error } = await authClient.signIn.email({ email: String(f.get("email")), password: String(f.get("password")) });
        if (error) return error.status === 403 ? "Verify your email first. We've sent you a new link." : "Email or password is incorrect";
        // Enrolled users are sent to /verify-mfa by the twoFactorClient redirect.
        if (!(data && "twoFactorRedirect" in data && data.twoFactorRedirect)) router.push(next);
        return null;
      }}
    >
      <div className="space-y-1.5"><Label htmlFor="email">Email</Label><Input id="email" name="email" type="email" required autoComplete="email" /></div>
      <div className="space-y-1.5"><Label htmlFor="password">Password</Label><Input id="password" name="password" type="password" required autoComplete="current-password" /></div>
    </AuthForm>
  );
}
