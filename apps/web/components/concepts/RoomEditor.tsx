"use client";
import { FLOOR_FINISHES, FLOOR_FINISH_KEYS, FURNITURE, FURNITURE_TYPES, fitRoom, type FurnitureType, type Room } from "@veenix/shared";
import { RotateCw, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

const WALL_COLOURS = ["#f4f1ea", "#efe8dc", "#d9d3c7", "#b7c4ad", "#b8c4cf", "#d4a58a", "#4a4a4a", "#ffffff"];
const ITEM_COLOURS = ["#d8cbb5", "#b9a88c", "#7a5c3e", "#3b2f2a", "#e8e0d0", "#6f7d6a", "#4f6b77", "#2b2b2b"];
const LIMITS = { width: [2, 15], length: [2, 15], height: [2.4, 4.5] } as const;

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

/** Re-finish the room in front of the client. Every change is fitted, so nothing ends up through a wall. */
export function RoomEditor({ room, selected, onChange, onSelect }: { room: Room; selected: number | null; onChange: (room: Room) => void; onSelect: (i: number | null) => void }) {
  const set = (patch: Partial<Room>) => onChange(fitRoom({ ...room, ...patch }));
  const item = selected === null ? null : room.items[selected];
  const setItem = (patch: Partial<Room["items"][number]>) => set({ items: room.items.map((it, i) => (i === selected ? { ...it, ...patch } : it)) });
  const heading = "text-[11px] font-semibold uppercase tracking-wide text-white/50";

  return (
    <div className="space-y-4 text-sm">
      {item && (
        <section className="space-y-2 rounded-lg bg-white/10 p-3">
          <div className="flex items-center justify-between">
            <p className="font-medium">{FURNITURE[item.type].label}</p>
            <div className="flex gap-1">
              <button type="button" onClick={() => setItem({ rotation: (item.rotation + 90) % 360 })} className="rounded-md p-1.5 hover:bg-white/10" aria-label="Rotate 90 degrees">
                <RotateCw className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  onSelect(null);
                  set({ items: room.items.filter((_, i) => i !== selected) });
                }}
                className="rounded-md p-1.5 text-red-300 hover:bg-white/10"
                aria-label="Remove"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          </div>
          <Swatches label="Colour" colours={ITEM_COLOURS} value={item.color} onPick={(color) => setItem({ color })} />
          <p className="text-xs text-white/50">Drag it in the room to move it.</p>
        </section>
      )}

      <section className="space-y-2">
        <p className={heading}>Walls</p>
        <Swatches label="Wall colour" colours={WALL_COLOURS} value={room.walls.back.color} onPick={(color) => set({ walls: { back: { ...room.walls.back, color }, left: { ...room.walls.left, color }, right: { ...room.walls.right, color }, front: { ...room.walls.front, color } } })} />
      </section>

      <section className="space-y-2">
        <p className={heading}>Floor</p>
        <div className="flex flex-wrap gap-1.5">
          {FLOOR_FINISH_KEYS.map((f) => (
            <button key={f} type="button" aria-pressed={room.floor === f} onClick={() => set({ floor: f })} className={cn("rounded-md px-2 py-1 text-xs", room.floor === f ? "bg-white text-neutral-900" : "bg-white/10 hover:bg-white/20")}>
              {FLOOR_FINISHES[f].label}
            </button>
          ))}
        </div>
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
        <select
          value=""
          aria-label="Add furniture"
          disabled={room.items.length >= 40}
          onChange={(e) => {
            const type = e.target.value as FurnitureType;
            if (!type) return;
            set({ items: [...room.items, { type, description: FURNITURE[type].label, x: 0, z: 0, rotation: 0, color: ITEM_COLOURS[0] }] });
            onSelect(room.items.length);
          }}
          className="w-full rounded-md bg-white/10 px-2 py-1.5 text-sm text-white"
        >
          <option value="">Choose furniture…</option>
          {FURNITURE_TYPES.map((t) => (
            <option key={t} value={t} className="text-neutral-900">{FURNITURE[t].label}</option>
          ))}
        </select>
      </section>
    </div>
  );
}
