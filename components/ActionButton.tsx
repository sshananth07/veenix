"use client";

import { useTransition } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";

export function ActionButton({
  action,
  pendingLabel,
  children,
  ...props
}: ButtonProps & { action: () => Promise<unknown>; pendingLabel?: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      {...props}
      disabled={pending || props.disabled}
      onClick={() =>
        startTransition(async () => {
          await action();
        })
      }
    >
      {pending ? pendingLabel ?? "Working..." : children}
    </Button>
  );
}
