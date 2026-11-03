"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { Bookmark, BookmarkCheck, Expand, Loader2, Palette } from "lucide-react";
import type { ConceptDto } from "@veenix/shared";
import { updateConcept } from "@/actions/concepts";
import { Button } from "@/components/ui/button";
import { BeforeAfter } from "./BeforeAfter";

export const NOT_TO_SCALE = "AI concept, not to scale";

/** A room concept inside the chat: generating, failed, or the before/after preview with its actions. */
export function ConceptCard({ concept, onTryAnother, onChange }: { concept: ConceptDto; onTryAnother: (text: string) => void; onChange: () => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (concept.status === "generating") {
    return (
      <div className="flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded-xl border bg-muted/40 text-sm text-muted-foreground" role="status">
        <Loader2 className="size-5 animate-spin" aria-hidden />
        Designing your room…
        <span className="text-xs">About a minute. You can keep chatting.</span>
      </div>
    );
  }
  if (concept.status === "failed" || !concept.imageUrl) {
    return <p className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{concept.error ?? "The room concept didn't work. Please try again."}</p>;
  }
  return (
    <div className="overflow-hidden rounded-xl border bg-background">
      <BeforeAfter before={concept.photoUrl} after={concept.imageUrl} className="aspect-[4/3]" />
      <div className="space-y-2 p-3">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-sm font-medium">{concept.name}</p>
          <span className="shrink-0 text-[11px] text-muted-foreground">{NOT_TO_SCALE}</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button asChild size="sm">
            <Link href={`/concepts/${concept.id}`}>
              <Expand className="size-3.5" aria-hidden /> {concept.room ? "View in 3D" : "View"}
            </Link>
          </Button>
          <Button size="sm" variant="outline" onClick={() => onTryAnother(`Try another style for "${concept.name}": `)}>
            <Palette className="size-3.5" aria-hidden /> Try another style
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            aria-pressed={concept.saved}
            onClick={() =>
              start(async () => {
                const r = await updateConcept(concept.id, { saved: !concept.saved });
                setError(r.ok ? null : r.error);
                onChange();
              })
            }
          >
            {concept.saved ? <BookmarkCheck className="size-3.5" aria-hidden /> : <Bookmark className="size-3.5" aria-hidden />}
            {concept.saved ? "Saved" : "Save"}
          </Button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </div>
  );
}
