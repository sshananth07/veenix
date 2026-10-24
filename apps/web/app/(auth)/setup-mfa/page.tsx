"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { authClient } from "@/lib/auth-client";
import { AuthForm } from "@/components/auth/AuthForm";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function SetupMfaPage() {
  const router = useRouter();
  const [setup, setSetup] = useState<{ qr: string; secret: string; backupCodes: string[] } | null>(null);

  if (!setup)
    return (
      <AuthForm
        title="Set up two-factor sign-in"
        subtitle="Confirm your password to link an authenticator app."
        submitLabel="Continue"
        onSubmit={async (f) => {
          const { data, error } = await authClient.twoFactor.enable({ password: String(f.get("password")) });
          if (error || data?.method !== "totp") return error?.message ?? "Could not start two-factor setup";
          const secret = new URL(data.totpURI).searchParams.get("secret") ?? "";
          setSetup({ qr: await QRCode.toDataURL(data.totpURI), secret, backupCodes: data.backupCodes });
          return null;
        }}
      >
        <div className="space-y-1.5"><Label htmlFor="password">Password</Label><Input id="password" name="password" type="password" required autoComplete="current-password" /></div>
      </AuthForm>
    );

  return (
    <AuthForm
      title="Scan the code"
      subtitle="Scan it with your authenticator app, then enter the 6-digit code it shows."
      submitLabel="Verify and finish"
      onSubmit={async (f) => {
        const { error } = await authClient.twoFactor.verifyTotp({ code: String(f.get("code")) });
        if (error) return "That code didn't match. Try the newest code.";
        router.push("/onboarding");
        return null;
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={setup.qr} alt="QR code for your authenticator app" className="mx-auto h-48 w-48" />
      <p className="break-all text-center font-mono text-xs text-muted-foreground">{setup.secret}</p>
      <div className="rounded-md border bg-muted/40 p-3">
        <p className="mb-2 text-xs text-muted-foreground">Save these somewhere safe. Each works once.</p>
        <ul className="grid grid-cols-2 gap-1 font-mono text-sm">{setup.backupCodes.map((c) => <li key={c}>{c}</li>)}</ul>
      </div>
      <div className="space-y-1.5"><Label htmlFor="code">6-digit code</Label><Input id="code" name="code" inputMode="numeric" pattern="\d{6}" maxLength={6} required autoComplete="one-time-code" /></div>
    </AuthForm>
  );
}
