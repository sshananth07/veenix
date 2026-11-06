import * as THREE from "three";
import { FLOOR_FINISHES, TINTED_FINISHES, WALL_FACING, WALL_FINISHES, WALLS, wallLength, wallPieces, wallPoint, type Room, type Wall } from "@veenix/shared";
import { material, metreBox, metreUVs, plain } from "./materials";

export const WALL_T = 0.12; // wall thickness
export const CUT = 1.0; // the height near walls drop to in the overview, so the room reads as a doll's house
const EXTERIOR = "#e8e5df";
const CAP = "#2a2a2a"; // the dark cut top of every wall
const GLOW = "#ffe2b8";
// Where each wall's group sits and turns, so its local x runs from the wall's left end (seen from inside) and +z faces in.
const PLACE: Record<Wall, (W: number, L: number) => [number, number]> = {
  back: (W, L) => [-W / 2, -L / 2], left: (W, L) => [-W / 2, L / 2], right: (W, L) => [W / 2, -L / 2], front: (W, L) => [W / 2, L / 2],
};
const INWARD: Record<Wall, THREE.Vector3> = { back: new THREE.Vector3(0, 0, 1), left: new THREE.Vector3(1, 0, 0), right: new THREE.Vector3(-1, 0, 0), front: new THREE.Vector3(0, 0, -1) };

export type WallPart = { side: Wall; full: THREE.Group; low: THREE.Group; normal: THREE.Vector3; centre: THREE.Vector3 };

function mesh(geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, shadows = true) {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z);
  o.castShadow = shadows;
  o.receiveShadow = true;
  return o;
}

/** One wall `h` high: solid pieces around the openings (so reveals come free), its finish on the inside, a dark cap, skirting. */
function buildWall(room: Room, side: Wall, h: number, glass: THREE.Material) {
  const g = new THREE.Group();
  const len = wallLength(room, side);
  const ext = side === "back" || side === "front" ? WALL_T : 0; // these two close the corners
  const { finish, color } = room.walls[side];
  const skin = material(`wall:${finish}`, WALL_FINISHES[finish], TINTED_FINISHES.includes(finish) ? color : undefined);
  const openings = room.openings.filter((o) => o.wall === side);

  for (const [x0, x1, y0, y1] of wallPieces(len, h, openings)) {
    const [bx0, bx1] = [x0 === 0 ? -ext : x0, x1 === len ? len + ext : x1];
    g.add(mesh(metreBox(bx1 - bx0, y1 - y0, WALL_T), plain(EXTERIOR, 0.9), (bx0 + bx1) / 2, (y0 + y1) / 2, -WALL_T / 2));
    g.add(mesh(metreUVs(new THREE.PlaneGeometry(x1 - x0, y1 - y0), x1 - x0, y1 - y0, x0, y0), skin, (x0 + x1) / 2, (y0 + y1) / 2, 0.002, false));
    if (y1 >= h) g.add(mesh(new THREE.BoxGeometry(bx1 - bx0, 0.012, WALL_T + 0.002), plain(CAP, 0.8), (bx0 + bx1) / 2, h + 0.006, -WALL_T / 2, false));
    if (y0 === 0) g.add(mesh(new THREE.BoxGeometry(x1 - x0, 0.08, 0.012), plain("#f2f0ec", 0.6), (x0 + x1) / 2, 0.04, 0.008, false));
  }

  for (const o of openings) {
    if (o.sill >= h) continue;
    const top = Math.min(h, o.sill + o.height);
    if (o.kind === "window") {
      g.add(mesh(new THREE.PlaneGeometry(o.width, top - o.sill), glass, o.at, (o.sill + top) / 2, -WALL_T / 2, false));
      if (o.sill > 0) g.add(mesh(new THREE.BoxGeometry(o.width + 0.1, 0.03, 0.14), plain("#f4f2ee", 0.5), o.at, o.sill, 0.03));
    } else {
      g.add(mesh(new THREE.PlaneGeometry(o.width - 0.04, top - 0.01), plain("#8a6a4f", 0.6), o.at, top / 2, -WALL_T * 0.75, false));
      const trim = plain("#f4f2ee", 0.5);
      for (const x of [o.at - o.width / 2 - 0.025, o.at + o.width / 2 + 0.025]) g.add(mesh(new THREE.BoxGeometry(0.05, top, 0.015), trim, x, top / 2, 0.008, false));
      if (o.sill + o.height <= h) g.add(mesh(new THREE.BoxGeometry(o.width + 0.1, 0.05, 0.015), trim, o.at, o.sill + o.height + 0.025, 0.008, false));
    }
  }

  const [x, z] = PLACE[side](room.width, room.length);
  g.position.set(x, 0, z);
  g.rotation.y = (WALL_FACING[side] * Math.PI) / 180;
  return g;
}

/** Downlight positions spread over the ceiling, inside any lowered bands. */
export function downlightSpots(room: Room): [number, number][] {
  const n = room.ceiling.downlights;
  if (!n) return [];
  const margin = Math.max(0.6, ...room.ceiling.drops.map((d) => d.depth + 0.3));
  const [iw, il] = [Math.max(0.2, room.width - 2 * margin), Math.max(0.2, room.length - 2 * margin)];
  const cols = Math.max(1, Math.round(Math.sqrt((n * iw) / il)));
  const rows = Math.ceil(n / cols);
  const spots: [number, number][] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) spots.push([-iw / 2 + (iw * (c + 0.5)) / cols, -il / 2 + (il * (r + 0.5)) / rows]);
  return spots.slice(0, n);
}

/** The ceiling and everything on it: lowered bands, cove glow, downlights, AC units and fans. Shown only when walking in. */
function buildCeiling(room: Room) {
  const g = new THREE.Group();
  const { width: W, length: L, height: H, ceiling: c } = room;
  const board = plain(c.color, 1);
  const glow = new THREE.MeshBasicMaterial({ color: GLOW });
  const ceiling = mesh(new THREE.PlaneGeometry(W, L), board, 0, H, 0, false);
  ceiling.rotation.x = Math.PI / 2; // faces down
  g.add(ceiling);

  const along = (side: Wall, thick: number, depth: number, inset: number, y: number, m: THREE.Material) => {
    const len = wallLength(room, side);
    const [x, z] = wallPoint(room, side, len / 2, inset);
    const across = side === "back" || side === "front";
    g.add(mesh(new THREE.BoxGeometry(across ? len : depth, thick, across ? depth : len), m, x, y, z, false));
  };
  for (const d of c.drops) {
    for (const side of d.wall === "all" ? WALLS : [d.wall]) {
      along(side, d.gap, d.depth, d.depth / 2, H - d.gap / 2, board);
      if (c.cove) along(side, 0.02, 0.03, d.depth + 0.015, H - 0.012, glow);
    }
  }
  if (c.cove && !c.drops.length) for (const side of WALLS) along(side, 0.02, 0.03, 0.03, H - 0.012, glow);

  for (const [x, z] of downlightSpots(room)) {
    const disc = mesh(new THREE.CircleGeometry(0.07, 24), glow, x, H - 0.004, z, false);
    disc.rotation.x = Math.PI / 2;
    g.add(disc);
  }

  const white = plain("#f4f4f2", 0.5);
  for (const u of c.units) {
    const [x, z] = u.wall ? wallPoint(room, u.wall, u.along, u.kind === "ac_wall" ? 0.11 : u.kind === "ac_cassette" ? 1 : 1.5) : [0, 0];
    const unit = new THREE.Group();
    if (u.kind === "ac_cassette") {
      unit.add(mesh(new THREE.BoxGeometry(0.62, 0.06, 0.62), white, 0, H - 0.03, 0));
      unit.add(mesh(new THREE.BoxGeometry(0.5, 0.005, 0.5), plain("#c9cbcc", 0.6), 0, H - 0.062, 0, false));
    } else if (u.kind === "ac_wall") {
      unit.add(mesh(new THREE.BoxGeometry(0.9, 0.3, 0.22), white, 0, H - 0.35, 0));
      unit.add(mesh(new THREE.BoxGeometry(0.8, 0.02, 0.01), plain("#bfc2c4", 0.6), 0, H - 0.47, 0.111, false));
    } else {
      unit.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.2), plain("#3a3a3a", 0.5), 0, H - 0.1, 0));
      unit.add(mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.08), white, 0, H - 0.24, 0));
      for (let i = 0; i < 3; i++) {
        const blade = mesh(new THREE.BoxGeometry(0.6, 0.01, 0.12), plain("#b08a62", 0.6), 0, H - 0.25, 0);
        blade.geometry.translate(0.38, 0, 0);
        blade.rotation.y = (i * 2 * Math.PI) / 3;
        unit.add(blade);
      }
    }
    unit.position.set(x, 0, z);
    if (u.wall) unit.rotation.y = (WALL_FACING[u.wall] * Math.PI) / 180;
    g.add(unit);
  }
  return g;
}

/** The floor on a plinth, every wall at full height and cut down (the canvas shows one of each), and the ceiling. */
export function buildShell(room: Room, glass: THREE.Material) {
  const g = new THREE.Group();
  const { width: W, length: L, height: H } = room;
  const f = FLOOR_FINISHES[room.floor];
  const floor = mesh(metreUVs(new THREE.PlaneGeometry(W, L), W, L), material(`floor:${room.floor}`, f), 0, 0, 0, false);
  floor.rotation.x = -Math.PI / 2;
  g.add(floor, mesh(new THREE.BoxGeometry(W + 2 * WALL_T, 0.08, L + 2 * WALL_T), plain(EXTERIOR, 0.9), 0, -0.041, 0, false));

  const walls: WallPart[] = WALLS.map((side) => {
    const full = buildWall(room, side, H, glass);
    const low = buildWall(room, side, Math.min(CUT, H), glass);
    low.visible = false;
    g.add(full, low);
    const [x, z] = wallPoint(room, side, wallLength(room, side) / 2, 0);
    return { side, full, low, normal: INWARD[side], centre: new THREE.Vector3(x, 0, z) };
  });
  const ceiling = buildCeiling(room);
  ceiling.visible = false;
  g.add(ceiling);
  return { group: g, walls, ceiling };
}
