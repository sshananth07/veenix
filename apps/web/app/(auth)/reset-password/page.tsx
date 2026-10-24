"use client";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { AuthForm } from "@/components/auth/AuthForm";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function ResetPasswordForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  return (
    <AuthForm
      title="Choose a new password"
      submitLabel="Save password"
      onSubmit={async (f) => {
        const { error } = await authClient.resetPassword({ newPassword: String(f.get("password")), token });
        if (error) return error.message ?? "This reset link has expired. Ask for a new one.";
        router.push("/login");
        return null;
      }}
    >
      <div className="space-y-1.5"><Label htmlFor="password">New password</Label><Input id="password" name="password" type="password" required minLength={12} autoComplete="new-password" /><p className="text-xs text-muted-foreground">At least 12 characters. A short sentence works well.</p></div>
    </AuthForm>
  );
}

// useSearchParams needs a Suspense boundary, or `next build` refuses to prerender the page.
export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
