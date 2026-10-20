"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

// One back control for every detail page: goes to the previous page in the
// user's history, and falls back to the parent list when there is none
// (a deep link or a fresh tab).
export function BackButton({ fallbackHref, label }: { fallbackHref: string; label: string }) {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => (window.history.length > 1 ? router.back() : router.push(fallbackHref))}
      className="group inline-flex items-center gap-2 rounded-full border bg-card py-1.5 pl-2 pr-4 text-sm font-medium text-muted-foreground shadow-sm transition-all hover:border-primary/40 hover:text-primary hover:shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98]"
    >
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
        <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
      </span>
      Back to {label}
    </button>
  );
}
