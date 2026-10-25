"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { liveTicket } from "@/actions/session";

/** Re-renders the page when something it shows changes. Events carry ids only; the refresh refetches through the API. */
export function LiveRefresh({ projectId }: { projectId?: string }) {
  const router = useRouter();
  useEffect(() => {
    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let retry = 1000;
    let stopped = false;

    const connect = async () => {
      if (stopped) return;
      try {
        source = new EventSource(`${process.env.NEXT_PUBLIC_API_URL}/v1/live?ticket=${encodeURIComponent(await liveTicket())}`);
      } catch {
        return void setTimeout(connect, (retry = Math.min(retry * 2, 30_000)));
      }
      source.onopen = () => (retry = 1000);
      source.onmessage = (m) => {
        const e = JSON.parse(m.data) as { projectId?: string };
        if (projectId && e.projectId !== projectId) return;
        clearTimeout(timer);
        timer = setTimeout(() => router.refresh(), 300);
      };
      // The stream ends at the function's time limit; reconnect with a fresh ticket.
      source.onerror = () => {
        source?.close();
        setTimeout(connect, (retry = Math.min(retry * 2, 30_000)));
      };
    };
    void connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      source?.close();
    };
  }, [projectId, router]);
  return null;
}
