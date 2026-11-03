import { z } from "zod";

/**
 * A room concept's 3D room, written by the model and drawn by the browser (spec §7).
 * Metres. The room is centred on the origin: x across the width, z along the length.
 * "back" is the wall the photo faces (z = -length/2), "front" the camera's side.
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

export const FLOORS = ["light_oak", "walnut", "white_tile", "grey_tile", "marble", "concrete", "carpet"] as const;
export const WALLS = ["back", "left", "right", "front"] as const;

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a #rrggbb colour");

// Every field required (no optionals), so the same schema is OpenAI's strict output format.
export const roomSchema = z.strictObject({
  width: z.number().min(2).max(15),
  length: z.number().min(2).max(15),
  height: z.number().min(2.4).max(4.5),
  wallColor: hex,
  floor: z.enum(FLOORS),
  openings: z.array(z.strictObject({
    wall: z.enum(WALLS),
    kind: z.enum(["window", "door"]),
    at: z.number().min(0).max(15), // centre, from the wall's left end seen from inside
    width: z.number().min(0.4).max(15),
    height: z.number().min(0.5).max(4.5),
    sill: z.number().min(0).max(4),
  })).max(8),
  items: z.array(z.strictObject({
    type: z.enum(FURNITURE_TYPES),
    x: z.number().min(-8).max(8),
    z: z.number().min(-8).max(8),
    rotation: z.number().min(0).max(360), // degrees
    color: hex,
  })).max(40),
});
export type Room = z.infer<typeof roomSchema>;

const clamp = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));

/** Pulls every item inside the walls (by its rotated footprint) and every opening inside its wall. */
export function fitRoom(room: Room): Room {
  const halfW = room.width / 2;
  const halfL = room.length / 2;
  return {
    ...room,
    items: room.items.map((it) => {
      const { w, d } = FURNITURE[it.type];
      const r = (it.rotation * Math.PI) / 180;
      const [c, s] = [Math.abs(Math.cos(r)), Math.abs(Math.sin(r))];
      const ex = (w * c + d * s) / 2;
      const ez = (w * s + d * c) / 2;
      return { ...it, x: clamp(it.x, -halfW + ex, halfW - ex), z: clamp(it.z, -halfL + ez, halfL - ez) };
    }),
    openings: room.openings.map((o) => {
      const wallLength = o.wall === "back" || o.wall === "front" ? room.width : room.length;
      const width = Math.min(o.width, wallLength);
      const height = Math.min(o.height, room.height);
      return { ...o, width, height, at: clamp(o.at, width / 2, wallLength - width / 2), sill: Math.min(o.sill, room.height - height) };
    }),
  };
}
