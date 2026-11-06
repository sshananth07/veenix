"use client";
import { Component, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Bookmark, BookmarkCheck, Box, Footprints, Image as ImageIcon, Loader2, Maximize, Minimize, Moon, Presentation, SlidersHorizontal, Sun, Undo2 } from "lucide-react";
import { fitRoom, type ConceptDto, type Room } from "@veenix/shared";
import { matchRender, renderConcept, restoreRoom, updateConcept } from "@/actions/concepts";
import { cn } from "@/lib/utils";
import { BeforeAfter } from "./BeforeAfter";
import { NOT_TO_SCALE } from "./ConceptCard";
import { RoomEditor } from "./RoomEditor";
import type { Light, Pick, RoomCanvasProps } from "./RoomCanvas";

// Three.js loads only here, in its own chunk, and never on the server.
const RoomCanvas = dynamic<RoomCanvasProps>(() => import("./RoomCanvas"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center gap-2 text-white/60" role="status">
      <Loader2 className="size-5 animate-spin" aria-hidden /> Building the room…
    </div>
  ),
});

/** Any render error inside the 3D view falls back to the photo instead of a blank screen. */
class Fallback extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** The concept full screen, for presenting to the client: the photo with a before/after slider, and the 3D room. */
export function ConceptViewer({ concept, canEdit }: { concept: ConceptDto; canEdit: boolean }) {
  const router = useRouter();
  const frame = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"photo" | "3d" | "render">(concept.room ? "3d" : "photo");
  const [no3d, setNo3d] = useState(false);
  const [full, setFull] = useState(false);
  const [room, setRoom] = useState<Room | null>(concept.room);
  const [selected, setSelected] = useState<Pick | null>(null);
  const [light, setLight] = useState<Light>("day");
  const [walk, setWalk] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Keyed on the stored room's value: polling (while a render is made) hands over a new but equal object every 5 s,
  // which must not wipe edits that aren't saved yet.
  const stored = JSON.stringify(concept.room);
  useEffect(() => setRoom(JSON.parse(stored) as Room | null), [stored]);
  // ponytail: polls while generating; the chat's live event doesn't reach this page.
  const waiting = concept.status === "generating" || concept.renderStatus === "generating";
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(t);
  }, [waiting, router]);
  useEffect(() => {
    const onChange = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const show3d = !!room && !no3d;
  const showRender = concept.status === "ready" && (canEdit || !!concept.renderUrl);
  const views = (["photo", "3d", "render"] as const).filter((m) => m === "photo" || (m === "3d" ? show3d : showRender));
  const VIEW = { photo: { label: "Photo", Icon: ImageIcon }, "3d": { label: "3D", Icon: Box }, render: { label: "Render", Icon: Presentation } };
  const act = (fn: (id: string) => Promise<{ ok: true } | { ok: false; error: string }>) => start(async () => {
    const r = await fn(concept.id);
    setError(r.ok ? null : r.error);
    if (r.ok) router.refresh();
  });
  const startRender = () => act(renderConcept);
  // A drag is fitted like any other edit, so nothing ends up through a wall.
  const moveItem = (p: Pick, x: number, z: number) => room && setRoom(fitRoom({ ...room, [p.kind]: room[p.kind].map((it, k) => (k === p.index ? { ...it, x, z } : it)) }));
  const dirty = JSON.stringify(room) !== JSON.stringify(concept.room);
  const fail3d = () => {
    setNo3d(true);
    setMode("photo");
  };
  const back = concept.projectId ? `/projects/${concept.projectId}` : concept.leadId ? `/leads/${concept.leadId}` : "/";
  const bar = "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium hover:bg-white/10 disabled:opacity-50";
  const chip = (on: boolean) => cn("flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium backdrop-blur disabled:opacity-50", on ? "bg-white text-neutral-900" : "bg-black/50 hover:bg-black/70");
  const unsaved = dirty ? "Save or reset your changes first" : undefined;
  return (
    <div ref={frame} className="fixed inset-0 z-50 flex flex-col bg-neutral-950 text-white">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-white/10 px-3">
        <Link href={back} className={bar} aria-label="Back">
          <ArrowLeft className="size-4" aria-hidden />
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">{concept.name}</h1>
        {views.length > 1 && (
          <div className="flex rounded-lg bg-white/10 p-0.5" role="group" aria-label="View">
            {views.map((m) => {
              const { label, Icon } = VIEW[m];
              return (
                <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} className={cn("flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm", mode === m && "bg-white text-neutral-900")}>
                  <Icon className="size-4" aria-hidden />
                  <span className={cn(m !== mode && "hidden sm:inline")}>{label}</span>
                </button>
              );
            })}
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
        {concept.status === "ready" && room && show3d && mode === "3d" && (
          <>
            <Fallback onError={fail3d}>
              <RoomCanvas room={room} light={light} walk={walk} selected={selected} onSelect={setSelected} onError={fail3d} onMove={moveItem} />
            </Fallback>
            <div className="absolute top-3 left-3 flex flex-wrap gap-1.5">
              <button type="button" aria-pressed={walk} onClick={() => setWalk(!walk)} className={chip(walk)}>
                <Footprints className="size-3.5" aria-hidden /> {walk ? "Overview" : "Walk in"}
              </button>
              <button type="button" onClick={() => setLight(light === "day" ? "evening" : "day")} className={chip(false)}>
                {light === "day" ? <Moon className="size-3.5" aria-hidden /> : <Sun className="size-3.5" aria-hidden />}
                {light === "day" ? "Evening" : "Studio"}
              </button>
              {canEdit && (
                <button type="button" aria-pressed={editing} onClick={() => setEditing(!editing)} className={chip(editing)}>
                  <SlidersHorizontal className="size-3.5" aria-hidden /> Edit
                </button>
              )}
              {canEdit && concept.canMatchRender && (
                <button type="button" disabled={pending || dirty} title={unsaved} onClick={() => act(matchRender)} className={chip(false)}>
                  <Presentation className="size-3.5" aria-hidden /> Match render
                </button>
              )}
              {canEdit && concept.canRestoreRoom && (
                <button type="button" disabled={pending || dirty} title={unsaved} onClick={() => act(restoreRoom)} className={chip(false)}>
                  <Undo2 className="size-3.5" aria-hidden /> Undo match
                </button>
              )}
            </div>
            {editing && (
              <aside aria-label="Edit the room" className="absolute top-14 right-3 bottom-12 flex w-72 max-w-[calc(100%-1.5rem)] flex-col rounded-xl bg-neutral-900/90 p-4 backdrop-blur">
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <RoomEditor room={room} selected={selected} onChange={setRoom} onSelect={setSelected} />
                </div>
                {dirty && (
                  <div className="mt-3 flex gap-2 border-t border-white/10 pt-3">
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => start(async () => {
                        const r = await updateConcept(concept.id, { room });
                        setError(r.ok ? null : r.error);
                        if (r.ok) router.refresh();
                      })}
                      className="flex-1 rounded-md bg-white px-3 py-1.5 text-sm font-medium text-neutral-900 disabled:opacity-50"
                    >
                      {pending ? "Saving…" : "Save changes"}
                    </button>
                    <button type="button" onClick={() => { setRoom(concept.room); setSelected(null); }} className="rounded-md px-3 py-1.5 text-sm hover:bg-white/10">
                      Reset
                    </button>
                  </div>
                )}
                {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
              </aside>
            )}
          </>
        )}
        {concept.status === "ready" && mode === "render" && (
          concept.renderUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- short-lived storage URLs
            <img src={concept.renderUrl} alt={`Presentation render of ${concept.name}`} className="h-full w-full bg-[radial-gradient(ellipse_at_center,#3a3a3a,#141414)] object-contain p-4" />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center" role="status">
              {concept.renderStatus === "generating" ? (
                <p className="flex items-center gap-2 text-white/70"><Loader2 className="size-5 animate-spin" aria-hidden /> Making the presentation render…</p>
              ) : (
                <>
                  <p className="max-w-sm text-sm text-white/70">
                    {concept.renderStatus === "failed" ? "The last render didn't work. You can try again." : "A photoreal dollhouse view of this design, for presenting to the client."}
                  </p>
                  <button type="button" disabled={pending} onClick={startRender} className="flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-neutral-900 disabled:opacity-50">
                    {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Presentation className="size-4" aria-hidden />}
                    Make presentation render
                  </button>
                  <p className="text-xs text-white/50">Takes about a minute</p>
                  {error && <p className="text-xs text-red-300">{error}</p>}
                </>
              )}
            </div>
          )
        )}
        {no3d && <p className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-md bg-black/60 px-2 py-1 text-xs">3D isn&apos;t available on this device, so here&apos;s the photo.</p>}
        <span className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-black/60 px-2 py-1 text-xs font-medium">{NOT_TO_SCALE}</span>
      </div>
    </div>
  );
}
