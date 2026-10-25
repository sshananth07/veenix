"use client";

import { useState, useTransition } from "react";
import { AlertCircle } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";

export function ActionButton({
  action,
  pendingLabel,
  children,
  ...props
}: ButtonProps & { action: () => Promise<unknown>; pendingLabel?: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button
        {...props}
        disabled={pending || props.disabled}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await action();
            // Actions that return an ActionResult can refuse; show why, the same way FormDialog does.
            if (result && typeof result === "object" && "ok" in result && result.ok === false) setError(String((result as { error?: string }).error ?? "Something went wrong"));
          })
        }
      >
        {pending ? pendingLabel ?? "Working..." : children}
      </Button>
      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </p>
      )}
    </>
  );
}
