import { z } from "zod";
import { BUILT_IN_FINISH_KEYS, FLOOR_FINISH_KEYS, TOP_FINISH_KEYS, WALL_FINISH_KEYS } from "./materials";

/**
 * Loose furniture a room concept can place (spec §7). Metres. Anything fixed (cabinet runs, counters, shelving,
 * partitions, planters) is a built-in instead, sized by the model.
 */
export const FURNITURE = {
  sofa: { label: "Sofa", w: 2.2, d: 0.9, h: 0.85 },
  armchair: { label: "Armchair", w: 0.85, d: 0.85, h: 0.85 },
  coffee_table: { label: "Coffee table", w: 1.1, d: 0.6, h: 0.42 },
  side_table: { label: "Side table", w: 0.5, d: 0.5, h: 0.55 },
  dining_table: { label: "Dining table", w: 1.8, d: 0.9, h: 0.75 },
  dining_chair: { label: "Dining chair", w: 0.45, d: 0.5, h: 0.9 },
  bed: { label: "Bed", w: 1.6, d: 2.1, h: 1.0 },
  bedside_table: { label: "Bedside table", w: 0.5, d: 0.4, h: 0.55 },
  wardrobe: { label: "Wardrobe", w: 1.8, d: 0.6, h: 2.2 },
  tv_console: { label: "TV console", w: 1.8, d: 0.4, h: 0.5 },
  tv: { label: "TV", w: 1.45, d: 0.08, h: 0.85 },
  bookshelf: { label: "Bookshelf", w: 1.0, d: 0.35, h: 1.9 },
  desk: { label: "Desk", w: 1.2, d: 0.6, h: 0.75 },
  office_chair: { label: "Office chair", w: 0.6, d: 0.6, h: 1.0 },
  rug: { label: "Rug", w: 2.4, d: 1.7, h: 0.01 },
  floor_lamp: { label: "Floor lamp", w: 0.4, d: 0.4, h: 1.6 },
  pendant_light: { label: "Pendant light", w: 0.5, d: 0.5, h: 0.4 },
  plant: { label: "Plant", w: 0.5, d: 0.5, h: 1.2 },
  kitchen_counter: { label: "Kitchen counter", w: 2.4, d: 0.6, h: 0.9 },
  kitchen_island: { label: "Kitchen island", w: 1.8, d: 0.9, h: 0.9 },
  bar_stool: { label: "Bar stool", w: 0.4, d: 0.4, h: 0.75 },
  vanity: { label: "Vanity", w: 1.0, d: 0.5, h: 0.85 },
} as const;
export type FurnitureType = keyof typeof FURNITURE;
export const FURNITURE_TYPES = Object.keys(FURNITURE) as [FurnitureType, ...FurnitureType[]];

export const WALLS = ["back", "left", "right", "front"] as const;
export type Wall = (typeof WALLS)[number];
export const BUILT_IN_KINDS = ["base_run", "tall_run", "wall_run", "island", "bar", "counter", "shelving", "banquette", "partition", "planter_box"] as const;
export type BuiltInKind = (typeof BUILT_IN_KINDS)[number];
export const CEILING_UNITS = ["ac_cassette", "ac_wall", "ceiling_fan"] as const;

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a #rrggbb colour");
const deg = z.number().min(0).max(360);

const opening = z.strictObject({
  wall: z.enum(WALLS),
  kind: z.enum(["window", "door"]),
  at: z.number().min(0).max(15), // centre, from the wall's left end seen from inside
  width: z.number().min(0.4).max(15),
  height: z.number().min(0.5).max(4.5),
  sill: z.number().min(0).max(4),
});
const wallFinish = z.strictObject({ finish: z.enum(WALL_FINISH_KEYS), color: hex }); // color tints paint, fabric and wallpaper
const shell = {
  width: z.number().min(2).max(15),
  length: z.number().min(2).max(15),
  height: z.number().min(2.4).max(4.5),
  floor: z.enum(FLOOR_FINISH_KEYS),
  walls: z.strictObject({ back: wallFinish, left: wallFinish, right: wallFinish, front: wallFinish }),
  ceiling: z.strictObject({
    color: hex,
    drops: z.array(z.strictObject({ wall: z.enum([...WALLS, "all"]), depth: z.number().min(0.1).max(2), gap: z.number().min(0.05).max(0.6) })).max(4), // lowered bands
    cove: z.boolean(), // a lit strip along the drops (or the edge, with none)
    downlights: z.int().min(0).max(12),
    units: z.array(z.strictObject({ kind: z.enum(CEILING_UNITS), wall: z.enum(WALLS).nullable(), along: z.number().min(0).max(15) })).max(4),
  }),
  openings: z.array(opening).max(8),
};
const builtIn = {
  kind: z.enum(BUILT_IN_KINDS),
  length: z.number().min(0.3).max(8), // along its front
  depth: z.number().min(0.1).max(1.5),
  height: z.number().min(0.3).max(3),
  body: z.enum(BUILT_IN_FINISH_KEYS),
  top: z.enum(TOP_FINISH_KEYS).nullable(),
};
const item = { type: z.enum(FURNITURE_TYPES), description: z.string().max(80), color: hex };
// Against a wall: `along` is the centre in metres from the wall's left end seen from inside, `out` the gap from the wall,
// and rotation is relative to facing into the room. Free-standing (wall null): along and out are x and z.
const described = { wall: z.enum(WALLS).nullable(), along: z.number().min(-8).max(15), out: z.number().min(-8).max(15), rotation: deg };
const placed = { x: z.number().min(-8).max(8), z: z.number().min(-8).max(8), rotation: deg };

// Every field required (no optionals), so it's also OpenAI's strict output format.
/** What the model returns: items and built-ins placed by wall. `resolveRoom` turns it into a `Room`. */
export const roomDescriptionSchema = z.strictObject({
  ...shell,
  builtIns: z.array(z.strictObject({ ...builtIn, ...described })).max(12),
  items: z.array(z.strictObject({ ...item, ...described })).max(40),
});
export type RoomDescription = z.infer<typeof roomDescriptionSchema>;

/**
 * A room concept's 3D room, v2 (plan 17): what's stored, edited and drawn. Metres, centred on the origin:
 * x across the width (left negative), z along the length. "back" is the wall the photo faces (z = -length/2).
 * Rotation 0 faces the camera's side (+z).
 */
export const roomSchema = z.strictObject({
  version: z.literal(2),
  ...shell,
  builtIns: z.array(z.strictObject({ ...builtIn, ...placed })).max(12),
  items: z.array(z.strictObject({ ...item, ...placed })).max(40),
});
export type Room = z.infer<typeof roomSchema>;

const clamp = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));
const rad = (d: number) => (d * Math.PI) / 180;
/** Half the footprint across x and z of a w × d box turned by `rotation` degrees. */
function extent(w: number, d: number, rotation: number) {
  const [c, s] = [Math.abs(Math.cos(rad(rotation))), Math.abs(Math.sin(rad(rotation)))];
  return { ex: (w * c + d * s) / 2, ez: (w * s + d * c) / 2 };
}
export const wallLength = (room: { width: number; length: number }, wall: Wall) => (wall === "back" || wall === "front" ? room.width : room.length);

/** Pulls every item and built-in inside the walls (by its rotated footprint) and every opening inside its wall. */
export function fitRoom(room: Room): Room {
  const halfW = room.width / 2;
  const halfL = room.length / 2;
  const inside = <T extends { x: number; z: number; rotation: number }>(it: T, w: number, d: number): T => {
    const { ex, ez } = extent(w, d, it.rotation);
    return { ...it, x: clamp(it.x, -halfW + ex, halfW - ex), z: clamp(it.z, -halfL + ez, halfL - ez) };
  };
  return {
    ...room,
    items: room.items.map((it) => inside(it, FURNITURE[it.type].w, FURNITURE[it.type].d)),
    builtIns: room.builtIns.map((b) => inside(b, b.length, b.depth)),
    openings: room.openings.map((o) => {
      const len = wallLength(room, o.wall);
      const width = Math.min(o.width, len);
      const height = Math.min(o.height, room.height);
      return { ...o, width, height, at: clamp(o.at, width / 2, len - width / 2), sill: Math.min(o.sill, room.height - height) };
    }),
  };
}

/** The rotation, in degrees, that faces into the room from each wall. */
export const WALL_FACING: Record<Wall, number> = { back: 0, left: 90, right: 270, front: 180 };
const DOOR_CLEARANCE = 0.9; // anything closer to a door's wall than this is moved off the doorway

/** Wall coordinates to x/z: `along` from the wall's left end seen from inside, `inset` into the room. */
export function wallPoint(room: { width: number; length: number }, wall: Wall, along: number, inset: number): [number, number] {
  const [W, L] = [room.width, room.length];
  if (wall === "back") return [-W / 2 + along, -L / 2 + inset];
  if (wall === "left") return [-W / 2 + inset, L / 2 - along];
  if (wall === "right") return [W / 2 - inset, -L / 2 + along];
  return [W / 2 - along, L / 2 - inset];
}

/**
 * The solid parts of a wall `len` long and `h` high, as [x0, x1, y0, y1] in wall coordinates: vertical strips split
 * at every opening's edge, less the openings. A door (or anything reaching above `h`) cuts right through.
 */
export function wallPieces(len: number, h: number, openings: { at: number; width: number; sill: number; height: number }[]): [number, number, number, number][] {
  const xs = [...new Set([0, len, ...openings.flatMap((o) => [o.at - o.width / 2, o.at + o.width / 2])])].filter((x) => x >= 0 && x <= len).sort((a, b) => a - b);
  const pieces: [number, number, number, number][] = [];
  for (let i = 0; i < xs.length - 1; i++) {
    const [x0, x1] = [xs[i], xs[i + 1]];
    const mid = (x0 + x1) / 2;
    const holes = openings
      .filter((o) => Math.abs(mid - o.at) < o.width / 2)
      .map((o) => [o.sill, Math.min(h, o.sill + o.height)] as const)
      .filter(([a, b]) => a < h && b > a)
      .sort((a, b) => a[0] - b[0]);
    let y = 0;
    for (const [a, b] of holes) {
      if (a > y) pieces.push([x0, x1, y, a]);
      y = Math.max(y, b);
    }
    if (h > y) pieces.push([x0, x1, y, h]);
  }
  return pieces;
}

type Described = { wall: Wall | null; along: number; out: number; rotation: number };

/** The model's description as a fitted Room: wall placements become x/z, nothing blocks a door, everything is inside. */
export function resolveRoom(d: RoomDescription): Room {
  const doors = d.openings.filter((o) => o.kind === "door");
  const place = (p: Described, w: number, depth: number) => {
    if (!p.wall) return { x: p.along, z: p.out, rotation: p.rotation };
    const wall = p.wall;
    const len = wallLength(d, wall);
    const { ex: halfAlong, ez: halfOut } = extent(w, depth, p.rotation); // in the wall's frame
    let along = clamp(p.along, halfAlong, len - halfAlong);
    if (p.out < DOOR_CLEARANCE) {
      for (const o of doors.filter((x) => x.wall === wall)) {
        const gap = o.width / 2 + halfAlong;
        if (Math.abs(along - o.at) >= gap) continue;
        const sides = [o.at - gap, o.at + gap].filter((a) => a >= halfAlong && a <= len - halfAlong);
        if (sides.length) along = sides.reduce((best, a) => (Math.abs(a - along) < Math.abs(best - along) ? a : best));
      }
    }
    const [x, z] = wallPoint(d, wall, along, p.out + halfOut);
    return { x, z, rotation: (WALL_FACING[wall] + p.rotation) % 360 };
  };
  const split = <T extends Described>({ wall, along, out, rotation, ...rest }: T) => [{ wall, along, out, rotation }, rest] as const;
  return fitRoom({
    version: 2,
    width: d.width, length: d.length, height: d.height, floor: d.floor, walls: d.walls, ceiling: d.ceiling, openings: d.openings,
    builtIns: d.builtIns.map((b) => {
      const [p, rest] = split(b);
      return { ...rest, ...place(p, b.length, b.depth) };
    }),
    items: d.items.map((it) => {
      const [p, rest] = split(it);
      return { ...rest, ...place(p, FURNITURE[it.type].w, FURNITURE[it.type].d) };
    }),
  });
}

// The room format concepts were stored in before plan 17, kept only so they still open.
const roomV1Schema = z.object({
  width: shell.width, length: shell.length, height: shell.height, wallColor: hex,
  floor: z.enum(["light_oak", "walnut", "white_tile", "grey_tile", "marble", "concrete", "carpet"]),
  openings: z.array(opening),
  items: z.array(z.object({ type: z.enum(FURNITURE_TYPES), x: z.number(), z: z.number(), rotation: deg, color: hex })),
});

/** A stored room as v2: v1 rooms are upgraded (painted walls, no ceiling features or built-ins), anything else is null. */
export function upgradeRoom(r: unknown): Room | null {
  const v2 = roomSchema.safeParse(r);
  if (v2.success) return v2.data;
  const v1 = roomV1Schema.safeParse(r);
  if (!v1.success) return null;
  const { wallColor, items, ...rest } = v1.data;
  const wall = { finish: "paint" as const, color: wallColor };
  return {
    version: 2, ...rest,
    walls: { back: wall, left: wall, right: wall, front: wall },
    ceiling: { color: "#f7f6f2", drops: [], cove: false, downlights: 0, units: [] },
    builtIns: [],
    items: items.map((it) => ({ ...it, description: FURNITURE[it.type].label })),
  };
}
