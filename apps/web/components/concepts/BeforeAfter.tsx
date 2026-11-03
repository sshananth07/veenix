"use client";
import { useState } from "react";
import { cn } from "@/lib/utils";

/** The original photo over the restyled one, split by a divider the user drags (or moves with arrow keys). */
export function BeforeAfter({ before, after, fit = "cover", className }: { before: string; after: string; fit?: "cover" | "contain"; className?: string }) {
  const [pos, setPos] = useState(50);
  const img = cn("h-full w-full", fit === "cover" ? "object-cover" : "object-contain");
  return (
    <div className={cn("relative select-none overflow-hidden", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- short-lived storage URLs */}
      <img src={after} alt="The room restyled" className={img} draggable={false} />
      {/* eslint-disable-next-line @next/next/no-img-element -- short-lived storage URLs */}
      <img src={before} alt="The room as it is" className={cn(img, "absolute inset-0")} style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }} draggable={false} />
      <div className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_6px_rgba(0,0,0,0.5)]" style={{ left: `${pos}%` }}>
        <span className="absolute top-1/2 left-1/2 flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-[10px] font-bold text-neutral-700 shadow">
          ⇆
        </span>
      </div>
      <span className="pointer-events-none absolute top-2 left-2 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white">Before</span>
      <span className="pointer-events-none absolute top-2 right-2 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white">After</span>
      <input
        type="range"
        min={0}
        max={100}
        value={pos}
        onChange={(e) => setPos(Number(e.target.value))}
        aria-label="Compare the room before and after"
        className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
      />
    </div>
  );
}
