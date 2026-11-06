import { WALLS, type Room, type Wall } from "./room";

// Layout maths for the built-in sets (plan 18), kept here so it's tested; the web builds the pieces from it. Metres.

/** Desks in a workstation run: back-to-back from 1.2 m deep, about 1.4 m a desk. */
export function workstationSeats(length: number, depth: number) {
  const perSide = Math.max(1, Math.round(length / 1.4));
  return { sides: (depth >= 1.2 ? 2 : 1) as 1 | 2, perSide, deskWidth: length / perSide };
}

const CHAIR_OUT = 0.2; // a chair's centre past the table edge, tucked in

/**
 * A dining set's table and chairs within its `length × depth` footprint: chairs along both long sides about 0.6 m apart,
 * one at each end of a table 1.6 m or longer. Each chair is [x, z, rotation in degrees], facing the table.
 */
export function diningChairs(length: number, depth: number) {
  const table: [number, number] = [Math.max(0.8, length - 0.9), Math.max(0.7, depth - 0.9)];
  const [tl, td] = table;
  const n = Math.max(1, Math.floor(tl / 0.6));
  const chairs: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const x = -tl / 2 + (tl * (i + 0.5)) / n;
    chairs.push([x, -(td / 2 + CHAIR_OUT), 0], [x, td / 2 + CHAIR_OUT, 180]);
  }
  if (tl >= 1.6) chairs.push([-(tl / 2 + CHAIR_OUT), 0, 90], [tl / 2 + CHAIR_OUT, 0, 270]);
  return { table, chairs };
}

/** A bed set `length` wide: side tables when there's room for them, the bed at most 1.8 m wide. */
export function bedSet(length: number) {
  const sideTables = length >= 2.4;
  return { bed: Math.min(1.8, sideTables ? length - 1.0 : length), sideTables };
}

/** The walls a cove strip runs along: its drops' walls, or every wall when there are no drops. */
export function coveSides(room: Pick<Room, "ceiling">): Wall[] {
  const { cove, drops } = room.ceiling;
  if (!cove) return [];
  if (!drops.length || drops.some((d) => d.wall === "all")) return [...WALLS];
  return WALLS.filter((w) => drops.some((d) => d.wall === w));
}
