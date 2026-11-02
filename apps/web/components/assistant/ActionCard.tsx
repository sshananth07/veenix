"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowRight, Check, Plus, X } from "lucide-react";
import { parseRinggit, type AssistantCardDto } from "@veenix/shared";
import { approveAssistantAction, rejectAssistantAction } from "@/actions/assistant";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

/** An approval card: nothing changes until the user taps Approve. */
export function ActionCard({ card, onDone }: { card: AssistantCardDto; onDone: () => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const open = card.status === "pending" && !card.expired;
  const inputs = open ? card.inputs : [];
  const [money, setMoney] = useState<Record<string, string>>({});
  const [terms, setTerms] = useState([{ label: "", pct: "" }]);
  const setTerm = (n: number, patch: Partial<{ label: string; pct: string }>) => setTerms(terms.map((t, k) => (k === n ? { ...t, ...patch } : t)));
  const termRows = terms.map((t) => ({ label: t.label.trim(), pct: Number(t.pct) }));
  const termsTotal = termRows.reduce((s, t) => s + (Number.isInteger(t.pct) ? t.pct : 0), 0);
  // The card's inputs as edits keyed by path, or null while any is incomplete. The server checks them again.
  const edits = inputs.every((i) => (i.kind === "money" ? parseRinggit(money[i.key] ?? "") : termsTotal === 100 && termRows.every((t) => t.label && t.pct >= 1)))
    ? Object.fromEntries(inputs.map((i) => [i.key, i.kind === "money" ? parseRinggit(money[i.key]!) : termRows]))
    : null;
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
      {inputs.length > 0 && (
        <div className="mt-3 space-y-3 rounded-lg bg-accent/60 p-2.5">
          <p className="text-xs font-medium text-accent-foreground">Fill in before approving</p>
          {inputs.map((i) =>
            i.kind === "money" ? (
              <label key={i.key} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1">{i.label}</span>
                <span className="text-muted-foreground">RM</span>
                <Input className="h-8 w-32" inputMode="decimal" placeholder="0.00" value={money[i.key] ?? ""} onChange={(e) => setMoney({ ...money, [i.key]: e.target.value })} />
              </label>
            ) : (
              <div key={i.key} className="space-y-2 text-sm">
                <p>{i.label}</p>
                {terms.map((t, n) => (
                  <div key={n} className="flex items-center gap-2">
                    <Input className="h-8 min-w-0 flex-1" aria-label={`Term ${n + 1} name`} placeholder="e.g. Deposit" value={t.label} onChange={(e) => setTerm(n, { label: e.target.value })} />
                    <Input className="h-8 w-16" aria-label={`Term ${n + 1} percent`} inputMode="numeric" placeholder="%" value={t.pct} onChange={(e) => setTerm(n, { pct: e.target.value })} />
                    <span className="text-muted-foreground">%</span>
                    {terms.length > 1 && (
                      <Button variant="ghost" size="icon" className="size-8" aria-label={`Remove term ${n + 1}`} onClick={() => setTerms(terms.filter((_, k) => k !== n))}>
                        <X className="size-3.5" aria-hidden />
                      </Button>
                    )}
                  </div>
                ))}
                <div className="flex items-center justify-between">
                  <Button variant="ghost" size="sm" onClick={() => setTerms([...terms, { label: "", pct: "" }])}>
                    <Plus className="size-3.5" aria-hidden /> Add term
                  </Button>
                  <span className={termsTotal === 100 ? "text-muted-foreground" : "text-destructive"}>Total {termsTotal}% of 100%</span>
                </div>
              </div>
            ),
          )}
        </div>
      )}
      {card.missing.length > 0 && open && inputs.length === 0 && (
        <p className="mt-3 rounded-lg bg-accent px-2.5 py-2 text-sm text-accent-foreground">Needs: {card.missing.join(", ")}. Fill these in Veenix before approving.</p>
      )}
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      {open && (
        <div className="mt-4 flex items-center justify-end gap-2">
          {card.link && card.missing.length > 0 && inputs.length === 0 && (
            <Button asChild variant="ghost" size="sm">
              <Link href={card.link}>Open in Veenix</Link>
            </Button>
          )}
          <Button variant="outline" size="sm" disabled={pending} onClick={() => run(rejectAssistantAction)}>
            <X className="size-3.5" aria-hidden /> Reject
          </Button>
          <Button size="sm" disabled={pending || (card.missing.length > 0 && (inputs.length === 0 || !edits))} onClick={() => run((id) => approveAssistantAction(id, edits ?? {}))}>
            <Check className="size-3.5" aria-hidden /> Approve
          </Button>
        </div>
      )}
    </div>
  );
}
