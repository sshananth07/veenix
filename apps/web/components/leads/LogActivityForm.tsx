"use client";

import { useRef, useTransition } from "react";
import { Send } from "lucide-react";
import { logLeadActivity } from "@/actions/leads";
import { authClient } from "@/lib/auth-client";

export function LogActivityForm({ leadId }: { leadId: string }) {
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const userName = authClient.useSession().data?.user.name ?? "";

  return (
    <form
      action={(formData) => {
        const note = String(formData.get("note") ?? "");
        startTransition(async () => {
          await logLeadActivity(leadId, note);
          if (inputRef.current) inputRef.current.value = "";
        });
      }}
      className="rounded-xl border bg-muted/20 p-3"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
          {userName.slice(0, 2).toUpperCase()}
        </span>
        <textarea
          ref={inputRef}
          name="note"
          rows={2}
          placeholder="Add a note..."
          className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>
      <div className="mt-2 flex justify-end">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
        >
          {pending ? "Posting..." : "Post"}
          <Send className="h-3.5 w-3.5" />
        </button>
      </div>
    </form>
  );
}
