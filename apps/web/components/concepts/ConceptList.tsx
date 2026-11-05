import Link from "next/link";
import type { ConceptDto } from "@veenix/shared";
import { NOT_TO_SCALE } from "./ConceptCard";

/** Saved room concepts on a project or lead. Nothing when there are none. */
export function ConceptList({ concepts }: { concepts: ConceptDto[] }) {
  if (concepts.length === 0) return null;
  return (
    <section className="rounded-xl border bg-card p-5 shadow-xs">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Room concepts</h2>
        <span className="text-xs text-muted-foreground">{NOT_TO_SCALE}</span>
      </div>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 @5xl:grid-cols-4">
        {concepts.map((c) => (
          <li key={c.id}>
            <Link href={`/concepts/${c.id}`} className="group block overflow-hidden rounded-lg border">
              {/* eslint-disable-next-line @next/next/no-img-element -- short-lived storage URLs */}
              <img src={c.imageUrl ?? c.photoUrl} alt="" className="aspect-[4/3] w-full object-cover transition group-hover:opacity-90" />
              <p className="truncate px-2.5 py-2 text-xs font-medium">{c.name}</p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
