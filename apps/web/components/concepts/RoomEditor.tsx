"use client";
import { useState, type ReactNode } from "react";
import {
  BUILT_IN_FINISHES, BUILT_IN_FINISH_KEYS, BUILT_IN_KINDS, FLOOR_FINISHES, FLOOR_FINISH_KEYS, FURNITURE, FURNITURE_TYPES, TOP_FINISHES, TOP_FINISH_KEYS,
  WALL_FINISHES, WALL_FINISH_KEYS, WALLS, fitRoom, type BuiltInKind, type FurnitureType, type Room, type Wall,
} from "@veenix/shared";
import { Minus, Plus, RotateCw, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Pick } from "./RoomCanvas";

const WALL_COLOURS = ["#f4f1ea", "#efe8dc", "#d9d3c7", "#b7c4ad", "#8f9f7d", "#b8c4cf", "#d4a58a", "#4a4a4a", "#ffffff"];
const ITEM_COLOURS = ["#d8cbb5", "#b9a88c", "#7a5c3e", "#3b2f2a", "#e8e0d0", "#6f7d6a", "#4f6b77", "#2b2b2b"];
const LIMITS = { width: [2, 15], length: [2, 15], height: [2.4, 4.5] } as const;
export const BUILT_IN_LABELS: Record<BuiltInKind, string> = {
  base_run: "Base cabinets", tall_run: "Tall cabinets", wall_run: "Wall cabinets", island: "Island", bar: "Bar", counter: "Counter",
  shelving: "Shelving", banquette: "Banquette", partition: "Partition", planter_box: "Planter box",
};
// What a newly added built-in starts as: length, depth, height, body, top.
const NEW_BUILT_IN: Record<BuiltInKind, [number, number, number, Room["builtIns"][number]["body"], Room["builtIns"][number]["top"]]> = {
  base_run: [2.4, 0.6, 0.9, "white_laminate", "quartz_white"], tall_run: [0.6, 0.6, 2.2, "white_laminate", null], wall_run: [2.4, 0.35, 0.7, "white_laminate", null],
  island: [1.8, 0.9, 0.9, "oak_veneer", "quartz_white"], bar: [1.8, 0.5, 1.05, "oak_veneer", "oak"], counter: [2, 0.6, 1, "white_laminate", "quartz_white"],
  shelving: [1.2, 0.35, 1.9, "oak_veneer", null], banquette: [1.8, 0.6, 0.9, "matte_green", null], partition: [1.6, 0.06, 1.2, "glass", null], planter_box: [1.2, 0.4, 0.5, "oak_veneer", null],
};
const heading = "text-[11px] font-semibold uppercase tracking-wide text-white/50";
const chip = (on: boolean) => cn("rounded-md px-2 py-1 text-xs", on ? "bg-white text-neutral-900" : "bg-white/10 hover:bg-white/20");

function Swatches({ colours, value, onPick, label }: { colours: string[]; value: string; onPick: (c: string) => void; label: string }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
      {colours.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={c}
          aria-pressed={value.toLowerCase() === c}
          onClick={() => onPick(c)}
          className={cn("size-7 rounded-full border border-white/20", value.toLowerCase() === c && "ring-2 ring-white ring-offset-2 ring-offset-neutral-900")}
          style={{ background: c }}
        />
      ))}
    </div>
  );
}

function Chips<K extends string>({ keys, label, value, onPick, labelOf }: { keys: readonly K[]; label: string; value: K | null; onPick: (k: K) => void; labelOf: (k: K) => string }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
      {keys.map((k) => (
        <button key={k} type="button" aria-pressed={value === k} onClick={() => onPick(k)} className={chip(value === k)}>{labelOf(k)}</button>
      ))}
    </div>
  );
}

/** The selected item or built-in: name, rotate, delete, and what can be changed about it. */
function Selected({ title, onRotate, onDelete, children }: { title: string; onRotate: () => void; onDelete: () => void; children: ReactNode }) {
  return (
    <section className="space-y-2 rounded-lg bg-white/10 p-3">
      <div className="flex items-center justify-between">
        <p className="font-medium">{title}</p>
        <div className="flex gap-1">
          <button type="button" onClick={onRotate} className="rounded-md p-1.5 hover:bg-white/10" aria-label="Rotate 90 degrees">
            <RotateCw className="size-4" />
          </button>
          <button type="button" onClick={onDelete} className="rounded-md p-1.5 text-red-300 hover:bg-white/10" aria-label="Remove">
            <Trash2 className="size-4" />
          </button>
        </div>
      </div>
      {children}
      <p className="text-xs text-white/50">Drag it in the room to move it.</p>
    </section>
  );
}

/** Re-finish the room in front of the client. Every change is fitted, so nothing ends up through a wall. */
export function RoomEditor({ room, selected, onChange, onSelect }: { room: Room; selected: Pick | null; onChange: (room: Room) => void; onSelect: (p: Pick | null) => void }) {
  const [wall, setWall] = useState<Wall | "all">("all");
  const set = (patch: Partial<Room>) => onChange(fitRoom({ ...room, ...patch }));
  const item = selected?.kind === "items" ? room.items[selected.index] : null;
  const built = selected?.kind === "builtIns" ? room.builtIns[selected.index] : null;
  const setItem = (patch: Partial<Room["items"][number]>) => set({ items: room.items.map((it, i) => (i === selected?.index ? { ...it, ...patch } : it)) });
  const setBuilt = (patch: Partial<Room["builtIns"][number]>) => set({ builtIns: room.builtIns.map((b, i) => (i === selected?.index ? { ...b, ...patch } : b)) });
  const remove = () => {
    if (!selected) return;
    onSelect(null);
    set({ [selected.kind]: room[selected.kind].filter((_, i) => i !== selected.index) });
  };
  const shown = room.walls[wall === "all" ? "back" : wall];
  const setWalls = (patch: Partial<Room["walls"][Wall]>) =>
    set({ walls: Object.fromEntries(WALLS.map((w) => [w, wall === "all" || wall === w ? { ...room.walls[w], ...patch } : room.walls[w]])) as Room["walls"] });
  const add = (value: string) => {
    const [kind, name] = value.split(":");
    if (kind === "item") {
      const type = name as FurnitureType;
      set({ items: [...room.items, { type, description: FURNITURE[type].label, x: 0, z: 0, rotation: 0, color: ITEM_COLOURS[0] }] });
      onSelect({ kind: "items", index: room.items.length });
    } else if (kind === "built") {
      const k = name as BuiltInKind;
      const [length, depth, height, body, top] = NEW_BUILT_IN[k];
      const free = k === "island" || k === "partition";
      set({ builtIns: [...room.builtIns, { kind: k, x: 0, z: free ? 0 : -room.length / 2 + depth / 2, rotation: 0, length, depth, height, body, top }] });
      onSelect({ kind: "builtIns", index: room.builtIns.length });
    }
  };

  return (
    <div className="space-y-4 text-sm">
      {item && (
        <Selected title={item.description || FURNITURE[item.type].label} onRotate={() => setItem({ rotation: (item.rotation + 90) % 360 })} onDelete={remove}>
          <Swatches label="Colour" colours={ITEM_COLOURS} value={item.color} onPick={(color) => setItem({ color })} />
        </Selected>
      )}
      {built && (
        <Selected title={BUILT_IN_LABELS[built.kind]} onRotate={() => setBuilt({ rotation: (built.rotation + 90) % 360 })} onDelete={remove}>
          <p className={heading}>Finish</p>
          <Chips keys={BUILT_IN_FINISH_KEYS} label="Finish" value={built.body} onPick={(body) => setBuilt({ body })} labelOf={(k) => BUILT_IN_FINISHES[k].label} />
          <p className={heading}>Top</p>
          <select
            value={built.top ?? ""}
            aria-label="Top"
            onChange={(e) => setBuilt({ top: (e.target.value || null) as Room["builtIns"][number]["top"] })}
            className="w-full rounded-md bg-white/10 px-2 py-1.5 text-sm text-white"
          >
            <option value="" className="text-neutral-900">No top</option>
            {TOP_FINISH_KEYS.map((k) => <option key={k} value={k} className="text-neutral-900">{TOP_FINISHES[k].label}</option>)}
          </select>
          <label className="block space-y-1 text-xs text-white/70">
            Length (m)
            <input
              type="number" step={0.1} min={0.3} max={8} value={built.length}
              onChange={(e) => { const v = Number(e.target.value); if (v >= 0.3 && v <= 8) setBuilt({ length: v }); }}
              className="w-full rounded-md bg-white/10 px-2 py-1 text-sm text-white"
            />
          </label>
        </Selected>
      )}

      <section className="space-y-2">
        <p className={heading}>Walls</p>
        <Chips keys={["all", ...WALLS] as const} label="Which wall" value={wall} onPick={setWall} labelOf={(w) => (w === "all" ? "All" : w[0].toUpperCase() + w.slice(1))} />
        <Chips keys={WALL_FINISH_KEYS} label="Wall finish" value={wall === "all" && WALLS.some((w) => room.walls[w].finish !== shown.finish) ? null : shown.finish} onPick={(finish) => setWalls({ finish })} labelOf={(k) => WALL_FINISHES[k].label} />
        <Swatches label="Wall colour" colours={WALL_COLOURS} value={shown.color} onPick={(color) => setWalls({ color })} />
      </section>

      <section className="space-y-2">
        <p className={heading}>Floor</p>
        <Chips keys={FLOOR_FINISH_KEYS} label="Floor" value={room.floor} onPick={(floor) => set({ floor })} labelOf={(k) => FLOOR_FINISHES[k].label} />
      </section>

      <section className="space-y-2">
        <p className={heading}>Ceiling</p>
        <div className="flex items-center justify-between gap-2">
          <button type="button" aria-pressed={room.ceiling.cove} onClick={() => set({ ceiling: { ...room.ceiling, cove: !room.ceiling.cove } })} className={chip(room.ceiling.cove)}>
            Cove lighting
          </button>
          <div className="flex items-center gap-1 text-xs text-white/70" role="group" aria-label="Downlights">
            <button type="button" aria-label="Fewer downlights" disabled={!room.ceiling.downlights} onClick={() => set({ ceiling: { ...room.ceiling, downlights: room.ceiling.downlights - 1 } })} className="rounded-md p-1 hover:bg-white/10 disabled:opacity-40">
              <Minus className="size-3.5" />
            </button>
            <span className="w-24 text-center tabular-nums">{room.ceiling.downlights} downlight{room.ceiling.downlights === 1 ? "" : "s"}</span>
            <button type="button" aria-label="More downlights" disabled={room.ceiling.downlights >= 12} onClick={() => set({ ceiling: { ...room.ceiling, downlights: room.ceiling.downlights + 1 } })} className="rounded-md p-1 hover:bg-white/10 disabled:opacity-40">
              <Plus className="size-3.5" />
            </button>
          </div>
        </div>
        <p className="text-xs text-white/50">The ceiling shows when you walk in.</p>
      </section>

      <section className="space-y-2">
        <p className={heading}>Size (m)</p>
        <div className="grid grid-cols-3 gap-2">
          {(Object.keys(LIMITS) as (keyof typeof LIMITS)[]).map((k) => (
            <label key={k} className="space-y-1 text-xs capitalize text-white/70">
              {k}
              <input
                type="number"
                step={0.1}
                min={LIMITS[k][0]}
                max={LIMITS[k][1]}
                value={room[k]}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (v >= LIMITS[k][0] && v <= LIMITS[k][1]) set({ [k]: v });
                }}
                className="w-full rounded-md bg-white/10 px-2 py-1 text-sm text-white"
              />
            </label>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <p className={heading}>Add</p>
        <select value="" aria-label="Add to the room" onChange={(e) => e.target.value && add(e.target.value)} className="w-full rounded-md bg-white/10 px-2 py-1.5 text-sm text-white">
          <option value="">Choose something to add…</option>
          <optgroup label="Furniture" className="text-neutral-900">
            {FURNITURE_TYPES.map((t) => <option key={t} value={`item:${t}`} disabled={room.items.length >= 40}>{FURNITURE[t].label}</option>)}
          </optgroup>
          <optgroup label="Built-ins" className="text-neutral-900">
            {BUILT_IN_KINDS.map((k) => <option key={k} value={`built:${k}`} disabled={room.builtIns.length >= 12}>{BUILT_IN_LABELS[k]}</option>)}
          </optgroup>
        </select>
      </section>
    </div>
  );
}
