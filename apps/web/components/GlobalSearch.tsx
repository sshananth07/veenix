"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { SearchResultDto } from "@veenix/shared";
import { searchAction } from "@/actions/session";

const GROUPS: { kind: SearchResultDto["kind"]; label: string }[] = [
  { kind: "project", label: "Projects" },
  { kind: "lead", label: "Leads" },
  { kind: "vendor", label: "Vendors" },
  { kind: "quotation", label: "Quotations" },
  { kind: "po", label: "Purchase orders" },
  { kind: "invoice", label: "Invoices" },
];

function href(r: SearchResultDto) {
  switch (r.kind) {
    case "lead": return `/leads/${r.refId}`;
    case "project": return `/projects/${r.refId}`;
    case "vendor": return `/vendors/${r.refId}`;
    case "quotation": return `/projects/${r.projectId}?tab=quotation`;
    case "po": return `/projects/${r.projectId}?tab=vendors`;
    case "invoice": return `/projects/${r.projectId}?tab=payments`;
  }
}

/** Fuzzy search across the organization. Typos are fine ("wawsan" finds Wawasan). */
export function GlobalSearch() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResultDto[] | null>(null);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (q.trim().length < 2) return setResults(null);
    let live = true;
    const t = setTimeout(async () => {
      const r = await searchAction(q).catch(() => []);
      if (live) setResults(r);
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);

  useEffect(() => {
    const away = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);

  const close = () => {
    setOpen(false);
    setQ("");
  };

  return (
    <div ref={box} className="relative hidden @[58rem]:block">
      <input
        type="search"
        aria-label="Search"
        placeholder="Search..."
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        className="h-9 w-36 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
      />
      {open && results && (
        <div className="absolute right-0 z-50 mt-1 max-h-96 w-80 overflow-y-auto rounded-md border bg-popover p-1 text-sm shadow-lg">
          {results.length === 0 ? (
            <p className="px-3 py-2 text-muted-foreground">No matches</p>
          ) : (
            GROUPS.map((g) => {
              const rows = results.filter((r) => r.kind === g.kind);
              if (rows.length === 0) return null;
              return (
                <div key={g.kind} className="py-1">
                  <div className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{g.label}</div>
                  {rows.map((r) => (
                    <Link key={`${r.kind}-${r.refId}`} href={href(r)} onClick={close} className="block rounded px-3 py-1.5 hover:bg-muted">
                      <div className="truncate font-medium">{r.title}</div>
                      {r.subtitle && <div className="truncate text-xs text-muted-foreground">{r.subtitle}</div>}
                    </Link>
                  ))}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
