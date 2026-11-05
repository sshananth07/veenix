"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowRight, Check, Plus, Sparkles, X } from "lucide-react";
import { parseRinggit, type AssistantCardDto, type AssistantCardInput } from "@veenix/shared";
import { approveAssistantAction, rejectAssistantAction } from "@/actions/assistant";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AddressFields } from "@/components/ui/AddressFields";

const ADDRESS_KEYS = ["addressLine1", "addressLine2", "addressLine3", "postcode", "city", "state"] as const;
type Address = Record<(typeof ADDRESS_KEYS)[number], string | null>;
/** The address form's values, or null until line 1, a 5-digit postcode, city and state are in. The server checks again. */
function readAddress(form: HTMLFormElement): Address | null {
  const fd = new FormData(form);
  const a = Object.fromEntries(ADDRESS_KEYS.map((k) => [k, String(fd.get(k) ?? "").trim() || null])) as Address;
  return a.addressLine1 && /^\d{5}$/.test(a.postcode ?? "") && a.city && a.state ? a : null;
}

/** An approval card: nothing changes until the user taps Approve. */
export function ActionCard({ card, onDone, onDraft }: { card: AssistantCardDto; onDone: () => void; onDraft: (text: string) => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const open = card.status === "pending" && !card.expired;
  const inputs = open ? card.inputs : [];
  // Typed fields (money, date, choice, text), prefilled with what the assistant proposed.
  const [fields, setFields] = useState<Record<string, string>>(() => Object.fromEntries(card.inputs.filter((i) => i.value).map((i) => [i.key, i.value!])));
  const setField = (key: string, value: string) => setFields({ ...fields, [key]: value });
  const [terms, setTerms] = useState([{ label: "", pct: "" }]);
  const [address, setAddress] = useState<Address | null>(null);
  const setTerm = (n: number, patch: Partial<{ label: string; pct: string }>) => setTerms(terms.map((t, k) => (k === n ? { ...t, ...patch } : t)));
  const termRows = terms.map((t) => ({ label: t.label.trim(), pct: Number(t.pct) }));
  const termsTotal = termRows.reduce((s, t) => s + (Number.isInteger(t.pct) ? t.pct : 0), 0);
  // The card's inputs as edits keyed by path, or null while any is incomplete. The server checks them again.
  const valueOf = (i: AssistantCardInput) => {
    const v = (fields[i.key] ?? "").trim();
    if (i.kind === "money") return parseRinggit(v);
    if (i.kind === "date") return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
    if (i.kind === "choice") return i.options?.includes(v) ? v : null;
    if (i.kind === "text") return v || null;
    if (i.kind === "address") return address;
    return termsTotal === 100 && termRows.every((t) => t.label && t.pct >= 1) ? termRows : null;
  };
  // Web-only fields are optional; every other one must be filled.
  const edits = inputs.every((i) => i.webOnly || valueOf(i)) ? Object.fromEntries(inputs.map((i) => [i.key, valueOf(i)])) : null;
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
          <p className="text-xs font-medium text-accent-foreground">{edits ? "Check before approving" : "Fill in before approving"}</p>
          {inputs.map((i) =>
            i.kind === "address" ? (
              // Uncontrolled fields, read on every change; Enter doesn't submit anything.
              <form key={i.key} onChange={(e) => setAddress(readAddress(e.currentTarget))} onSubmit={(e) => e.preventDefault()}>
                <AddressFields required label={i.label} />
              </form>
            ) : i.kind === "money" ? (
              <label key={i.key} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1">{i.label}</span>
                <span className="text-muted-foreground">RM</span>
                <Input className="h-8 w-32 tabular-nums" inputMode="decimal" placeholder="0.00" value={fields[i.key] ?? ""} onChange={(e) => setField(i.key, e.target.value)} />
              </label>
            ) : i.kind === "date" ? (
              <label key={i.key} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1">{i.label}</span>
                <Input type="date" className="h-8 w-40" value={fields[i.key] ?? ""} onChange={(e) => setField(i.key, e.target.value)} />
              </label>
            ) : i.kind === "choice" ? (
              <fieldset key={i.key} className="text-sm">
                <legend className="mb-1.5">{i.label}</legend>
                <div className="flex flex-wrap gap-1.5">
                  {(i.options ?? []).map((o) => (
                    <label
                      key={o}
                      className="cursor-pointer rounded-md border bg-background px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted has-checked:border-primary has-checked:bg-primary/10 has-checked:text-primary has-focus-visible:ring-2 has-focus-visible:ring-ring"
                    >
                      <input type="radio" className="sr-only" name={`${card.id}-${i.key}`} value={o} checked={fields[i.key] === o} onChange={() => setField(i.key, o)} />
                      {o}
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : i.kind === "text" ? (
              <label key={i.key} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1">
                  {i.label}
                  {i.webOnly && <span className="block text-xs text-muted-foreground">Optional. Not shared with the AI.</span>}
                </span>
                <Input className="h-8 w-40" maxLength={80} value={fields[i.key] ?? ""} onChange={(e) => setField(i.key, e.target.value)} />
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
      {card.status === "applied" && (card.done || card.link) && (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-lg bg-emerald-50 px-2.5 py-2 text-sm text-emerald-900">
          <span className="flex min-w-0 items-center gap-1.5"><Check className="size-3.5 shrink-0" aria-hidden />{card.done ?? "Done."}</span>
          {card.link && <Link href={card.link} className="shrink-0 font-medium underline">Open</Link>}
        </div>
      )}
      {card.status === "applied" && card.next && (
        <div className="mt-2 flex justify-end">
          <Button size="sm" variant="outline" onClick={() => onDraft(card.next!.prompt)}>
            <Sparkles className="size-3.5" aria-hidden /> {card.next.label}
          </Button>
        </div>
      )}
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
          <Button size="sm" disabled={pending || (inputs.length > 0 ? !edits : card.missing.length > 0)} onClick={() => run((id) => approveAssistantAction(id, edits ?? {}))}>
            <Check className="size-3.5" aria-hidden /> Approve
          </Button>
        </div>
      )}
    </div>
  );
}
