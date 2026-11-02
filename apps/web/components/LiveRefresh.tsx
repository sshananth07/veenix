"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useLiveEvents } from "@/lib/useLiveEvents";

/** Re-renders the page when something it shows changes. Events carry ids only; the refresh refetches through the API. */
export function LiveRefresh({ projectId }: { projectId?: string }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  useLiveEvents((e) => {
    if (e.kind === "assistant" || (projectId && e.projectId !== projectId)) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => router.refresh(), 300);
  });
  return null;
}
