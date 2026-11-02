"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowRight, Check, X } from "lucide-react";
import type { AssistantCardDto } from "@veenix/shared";
import { approveAssistantAction, rejectAssistantAction } from "@/actions/assistant";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

/** An approval card: nothing changes until the user taps Approve. */
export function ActionCard({ card, onDone }: { card: AssistantCardDto; onDone: () => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const open = card.status === "pending" && !card.expired;
  const run = (fn: (id: string) => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const r = await fn(card.id);
      setError(r.ok ? null : (r.error ?? "That didn't work"));
      onDone();
    });

  return (
    <div className="rounded-xl border bg-background p-4 shadow-xs">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold">{card.title}</p>
        {card.status === "applied" && <Badge variant="success">Approved</Badge>}
        {card.status === "rejected" && <Badge variant="secondary">Rejected</Badge>}
        {card.status === "pending" && card.expired && <Badge variant="secondary">Expired</Badge>}
      </div>
      {card.lines.length > 0 && (
        <dl className="mt-3 space-y-1 text-sm">
          {card.lines.map((l) => (
            <div key={l.label} className="flex gap-2">
              <dt className="w-24 shrink-0 text-muted-foreground">{l.label}</dt>
              <dd className="min-w-0">{l.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {card.changes.length > 0 && (
        <div className="mt-3 space-y-2">
          {card.changes.map((c) => (
            <div key={c.label} className="rounded-lg bg-muted/60 p-2.5 text-sm">
              <p className="text-xs font-medium text-muted-foreground">{c.label}</p>
              <p className="mt-1 text-muted-foreground line-through decoration-muted-foreground/50">{c.before}</p>
              <p className="flex items-start gap-1.5 font-medium">
                <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
                {c.after}
              </p>
            </div>
          ))}
        </div>
      )}
      {card.missing.length > 0 && open && (
        <p className="mt-3 rounded-lg bg-accent px-2.5 py-2 text-sm text-accent-foreground">Needs: {card.missing.join(", ")}. Fill these in Veenix before approving.</p>
      )}
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      {open && (
        <div className="mt-4 flex items-center justify-end gap-2">
          {card.link && card.missing.length > 0 && (
            <Button asChild variant="ghost" size="sm">
              <Link href={card.link}>Open in Veenix</Link>
            </Button>
          )}
          <Button variant="outline" size="sm" disabled={pending} onClick={() => run(rejectAssistantAction)}>
            <X className="size-3.5" aria-hidden /> Reject
          </Button>
          <Button size="sm" disabled={pending || card.missing.length > 0} onClick={() => run(approveAssistantAction)}>
            <Check className="size-3.5" aria-hidden /> Approve
          </Button>
        </div>
      )}
    </div>
  );
}
