"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { AuthForm } from "@/components/auth/AuthForm";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function VerifyMfaPage() {
  const router = useRouter();
  const [backup, setBackup] = useState(false);
  return (
    <AuthForm
      key={backup ? "backup" : "totp"}
      title="Two-factor sign-in"
      subtitle={backup ? "Enter one of your backup codes." : "Enter the 6-digit code from your authenticator app."}
      submitLabel="Verify"
      footer={<button type="button" className="underline" onClick={() => setBackup(!backup)}>{backup ? "Use your authenticator app" : "Use a backup code"}</button>}
      onSubmit={async (f) => {
        const code = String(f.get("code"));
        const { error } = backup
          ? await authClient.twoFactor.verifyBackupCode({ code })
          : await authClient.twoFactor.verifyTotp({ code, trustDevice: false });
        if (error) return "That code didn't work. Try again.";
        router.push("/");
        return null;
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="code">{backup ? "Backup code" : "6-digit code"}</Label>
        {backup
          ? <Input id="code" name="code" required autoComplete="one-time-code" />
          : <Input id="code" name="code" inputMode="numeric" pattern="\d{6}" maxLength={6} required autoComplete="one-time-code" />}
      </div>
    </AuthForm>
  );
}
