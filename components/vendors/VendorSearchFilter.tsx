"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Filter, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const ALL = "all";

export function VendorSearchFilter({ trades }: { trades: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  const trade = params.get("trade") ?? ALL;
  const status = params.get("status") ?? ALL;
  const activeFilters = (trade !== ALL ? 1 : 0) + (status !== ALL ? 1 : 0);

  function update(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value && value !== ALL) next.set(key, value);
      else next.delete(key);
    }
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  useEffect(() => {
    if (q.trim() === (params.get("q") ?? "")) return;
    const t = setTimeout(() => update({ q: q.trim() || null }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (panel.current && !panel.current.contains(target) && !target.closest("[role=listbox]")) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search vendor name, trade or job..."
          aria-label="Search vendors"
          className="h-10 w-full min-w-[240px] rounded-lg border border-input bg-card pl-9 pr-9 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:w-[280px]"
        />
        {q && (
          <button type="button" aria-label="Clear search" className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-muted" onClick={() => { setQ(""); update({ q: null }); }}>
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="relative" ref={panel}>
        <Button type="button" variant="outline" className={cn("h-10 gap-2 bg-card", activeFilters > 0 && "border-primary text-primary")} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <Filter className="h-4 w-4" />
          Filter
          {activeFilters > 0 && <span className="rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground">{activeFilters}</span>}
        </Button>
        {open && (
          <div className="absolute right-0 top-full z-30 mt-2 grid w-64 gap-4 rounded-xl border bg-card p-4 shadow-lg">
            <Field label="Trade" htmlFor="filterTrade">
              <Select value={trade} onValueChange={(v) => update({ trade: v })}>
                <SelectTrigger id="filterTrade">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All trades</SelectItem>
                  {trades.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Status" htmlFor="filterStatus">
              <Select value={status} onValueChange={(v) => update({ status: v })}>
                <SelectTrigger id="filterStatus">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {activeFilters > 0 && (
              <button type="button" className="w-fit text-sm font-medium text-primary hover:underline" onClick={() => update({ trade: null, status: null })}>
                Clear filters
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
