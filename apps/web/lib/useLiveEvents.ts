"use client";
import { useEffect, useRef } from "react";
import { liveTicket } from "@/actions/session";

export type LiveEvent = { kind: string; id?: string; projectId?: string; userId?: string };

/** Calls onEvent for each live event this user may see. Events carry ids only; callers refetch through the API. */
export function useLiveEvents(onEvent: (e: LiveEvent) => void) {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  useEffect(() => {
    let source: EventSource | null = null;
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
      source.onmessage = (m) => handler.current(JSON.parse(m.data) as LiveEvent);
      // The stream ends at the function's time limit; reconnect with a fresh ticket.
      source.onerror = () => {
        source?.close();
        setTimeout(connect, (retry = Math.min(retry * 2, 30_000)));
      };
    };
    void connect();
    return () => {
      stopped = true;
      source?.close();
    };
  }, []);
}
