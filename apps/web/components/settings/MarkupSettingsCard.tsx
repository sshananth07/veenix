"use client";

import { useState, useTransition } from "react";
import { Percent } from "lucide-react";
import { updateMarkupSettings } from "@/actions/settings";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const QUICK_PICKS = [10, 15, 20, 25, 30];

export function MarkupSettingsCard({ settings }: { settings: { defaultMarkupPct: number; minMarkupPct: number } }) {
  const [defaultPct, setDefaultPct] = useState(String(settings.defaultMarkupPct));
  const [minPct, setMinPct] = useState(String(settings.minMarkupPct));
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <section className="rounded-xl border bg-card p-5 shadow-sm">
      <h2 className="mb-4 flex items-center gap-2 font-semibold">
        <Percent className="h-4 w-4 text-primary" />
        Markup settings
      </h2>
      <form
        action={(fd) =>
          startTransition(async () => {
            const result = await updateMarkupSettings(fd);
            setMessage(result.ok ? { ok: true, text: "Settings saved" } : { ok: false, text: result.error });
          })
        }
        className="grid gap-5"
      >
        <PctField id="defaultMarkupPct" label="Default markup (%)" value={defaultPct} onChange={setDefaultPct} hint="Applied to every line when a quotation is first created." />
        <PctField id="minMarkupPct" label="Minimum markup (%)" value={minPct} onChange={setMinPct} hint="Applied when project margin is below minimum." />

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving..." : "Update settings"}
          </Button>
          {message && <span role="status" className={cn("text-sm", message.ok ? "text-emerald-700" : "text-red-700")}>{message.text}</span>}
        </div>
      </form>
    </section>
  );
}

function PctField({ id, label, value, onChange, hint }: { id: string; label: string; value: string; onChange: (v: string) => void; hint: string }) {
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <div className="flex flex-wrap items-center gap-2">
        <Input id={id} name={id} type="number" min={0} value={value} onChange={(e) => onChange(e.target.value)} required className="w-24" />
        {QUICK_PICKS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onChange(String(p))}
            className={cn(
              "rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
              Number(value) === p ? "border-primary bg-primary text-primary-foreground" : "bg-card text-foreground hover:bg-muted"
            )}
          >
            {p}%
          </button>
        ))}
      </div>
    </Field>
  );
}
