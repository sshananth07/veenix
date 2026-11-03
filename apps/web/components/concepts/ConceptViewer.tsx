"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Bookmark, BookmarkCheck, Box, Image as ImageIcon, Loader2, Maximize, Minimize } from "lucide-react";
import type { ConceptDto } from "@veenix/shared";
import { updateConcept } from "@/actions/concepts";
import { cn } from "@/lib/utils";
import { BeforeAfter } from "./BeforeAfter";
import { NOT_TO_SCALE } from "./ConceptCard";

/** The concept full screen, for presenting to the client: the photo with a before/after slider, and the 3D room. */
export function ConceptViewer({ concept, canEdit }: { concept: ConceptDto; canEdit: boolean }) {
  const router = useRouter();
  const frame = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"photo" | "3d">("photo");
  const [full, setFull] = useState(false);
  const [pending, start] = useTransition();

  // ponytail: polls while generating; the chat's live event doesn't reach this page.
  useEffect(() => {
    if (concept.status !== "generating") return;
    const t = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(t);
  }, [concept.status, router]);
  useEffect(() => {
    const onChange = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const back = concept.projectId ? `/projects/${concept.projectId}` : concept.leadId ? `/leads/${concept.leadId}` : "/";
  const bar = "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium hover:bg-white/10 disabled:opacity-50";
  return (
    <div ref={frame} className="fixed inset-0 z-50 flex flex-col bg-neutral-950 text-white">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-white/10 px-3">
        <Link href={back} className={bar} aria-label="Back">
          <ArrowLeft className="size-4" aria-hidden />
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">{concept.name}</h1>
        {concept.room && (
          <div className="flex rounded-lg bg-white/10 p-0.5" role="group" aria-label="View">
            {(["photo", "3d"] as const).map((m) => (
              <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} className={cn("flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm", mode === m && "bg-white text-neutral-900")}>
                {m === "photo" ? <ImageIcon className="size-4" aria-hidden /> : <Box className="size-4" aria-hidden />}
                {m === "photo" ? "Photo" : "3D"}
              </button>
            ))}
          </div>
        )}
        {canEdit && concept.status === "ready" && (
          <button
            type="button"
            className={bar}
            disabled={pending}
            aria-pressed={concept.saved}
            onClick={() => start(async () => { await updateConcept(concept.id, { saved: !concept.saved }); router.refresh(); })}
          >
            {concept.saved ? <BookmarkCheck className="size-4" aria-hidden /> : <Bookmark className="size-4" aria-hidden />}
            <span className="hidden sm:inline">{concept.saved ? "Saved" : "Save"}</span>
          </button>
        )}
        <button type="button" className={bar} onClick={() => (document.fullscreenElement ? document.exitFullscreen() : frame.current?.requestFullscreen())}>
          {full ? <Minimize className="size-4" aria-hidden /> : <Maximize className="size-4" aria-hidden />}
          <span className="hidden sm:inline">{full ? "Exit" : "Present"}</span>
        </button>
      </header>

      <div className="relative min-h-0 flex-1">
        {concept.status === "generating" && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-white/70" role="status">
            <Loader2 className="size-6 animate-spin" aria-hidden /> Designing your room…
          </div>
        )}
        {concept.status === "failed" && <p className="flex h-full items-center justify-center text-sm text-red-300">{concept.error}</p>}
        {concept.status === "ready" && concept.imageUrl && mode === "photo" && (
          <BeforeAfter before={concept.photoUrl} after={concept.imageUrl} fit="contain" className="h-full w-full" />
        )}
        {concept.status === "ready" && mode === "3d" && <div className="flex h-full items-center justify-center text-white/60">3D view</div>}
        <span className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-black/60 px-2 py-1 text-xs font-medium">{NOT_TO_SCALE}</span>
      </div>
    </div>
  );
}
