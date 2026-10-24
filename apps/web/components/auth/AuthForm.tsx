"use client";

import { useState, useTransition } from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AuthForm({ title, subtitle, submitLabel, onSubmit, children, footer }: {
  title: string;
  subtitle?: string;
  submitLabel: string;
  onSubmit: (form: FormData) => Promise<string | null>; // resolves to an error message, or null
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="w-full max-w-sm space-y-4 rounded-xl border bg-card p-6 shadow-sm"
      action={(form) => start(async () => setError(await onSubmit(form)))}
    >
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {children}
      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>{pending ? "Please wait..." : submitLabel}</Button>
      {footer && <div className="text-center text-sm text-muted-foreground">{footer}</div>}
    </form>
  );
}
