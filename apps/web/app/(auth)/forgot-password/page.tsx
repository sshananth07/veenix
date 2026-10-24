"use client";
import Link from "next/link";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { AuthForm } from "@/components/auth/AuthForm";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  return (
    <AuthForm
      title="Reset your password"
      subtitle={sent ? "If that email has an account, a reset link is on its way." : "We'll email you a link to choose a new password."}
      submitLabel="Send reset link"
      footer={<Link className="underline" href="/login">Back to sign in</Link>}
      onSubmit={async (f) => {
        // The same answer whatever happens, so the form reveals nothing about which emails have accounts.
        await authClient.requestPasswordReset({ email: String(f.get("email")), redirectTo: "/reset-password" });
        setSent(true);
        return null;
      }}
    >
      <div className="space-y-1.5"><Label htmlFor="email">Email</Label><Input id="email" name="email" type="email" required autoComplete="email" /></div>
    </AuthForm>
  );
}
