import * as THREE from "three";
import { BUILT_IN_FINISHES, FURNITURE, TINTED_BUILT_INS, TOP_FINISHES, bedSet, diningChairs, workstationSeats, type Room } from "@veenix/shared";
import { buildItem, buildSized } from "./furniture";
import { material, metreBox, plain } from "./materials";
import { withProp } from "./props";
import { GLOW } from "./shell";

type BuiltIn = Room["builtIns"][number];
const TOE = 0.1; // kick under base cabinets
const TOP = 0.03; // worktop thickness
const DOOR = 0.6; // typical door width, for the split lines

function box(g: THREE.Group, w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) {
  const mesh = new THREE.Mesh(metreBox(w, h, d), m);
  mesh.position.set(x, y, z);
  mesh.castShadow = mesh.receiveShadow = true;
  g.add(mesh);
  return mesh;
}

/** Thin dark grooves on the front face: door splits every ~60 cm, and a drawer line under the top on base runs. */
function grooves(g: THREE.Group, w: number, y0: number, h: number, d: number, drawer: boolean) {
  const m = plain("#2b2a28", 0.9);
  const n = Math.max(1, Math.round(w / DOOR));
  for (let i = 1; i < n; i++) box(g, 0.004, h, 0.004, m, -w / 2 + (i * w) / n, y0 + h / 2, d / 2 + 0.002);
  if (drawer && h > 0.5) box(g, w, 0.004, 0.004, m, 0, y0 + h - 0.18, d / 2 + 0.002);
}

const SOFT = "#8f9f7d"; // a set's soft parts when it has no colour: sage fabric
const DESK_Y = 0.73; // desktop height
const DESK_T = 0.025;
const BOOKS = ["#8a6d5a", "#4f6b77", "#b7a07c", "#6f7d6a", "#3b2f2a"];

function put(g: THREE.Group, o: THREE.Object3D, x: number, z: number, rotation = 0, y = 0) {
  o.position.set(x, y, z);
  o.rotation.y = (rotation * Math.PI) / 180;
  g.add(o);
}

type SetBuilder = (g: THREE.Group, b: BuiltIn, body: THREE.Material, top: THREE.Material | null) => void;

/**
 * The sets: groups the model only sizes (plan 18). Each fills its `length × depth` footprint, its front facing +z;
 * `color` (or sage) is the soft parts, `body` the frame and `top` the desktop or table.
 */
const SETS: Partial<Record<Room["builtIns"][number]["kind"], SetBuilder>> = {
  workstation: (g, b, body, top) => {
    const { length: w, depth: d } = b;
    const { sides, perSide, deskWidth } = workstationSeats(w, d);
    const deskD = d / sides;
    const desktop = top ?? material("top:oak", TOP_FINISHES.oak);
    const screen = material("body:fabric", BUILT_IN_FINISHES.fabric, b.color ?? SOFT);
    const screenH = Math.max(1.0, b.height) - DESK_Y;
    for (let s = 0; s < sides; s++) {
      const sign = s === 0 ? 1 : -1; // side 0 is the front (+z); side 1, back to back, faces −z
      const zc = sides === 2 ? (sign * deskD) / 2 : 0;
      for (let i = 0; i < perSide; i++) {
        const x = -w / 2 + deskWidth * (i + 0.5);
        box(g, deskWidth - 0.01, DESK_T, deskD - 0.01, desktop, x, DESK_Y - DESK_T / 2, zc);
        box(g, 0.4, 0.6, Math.min(0.5, deskD - 0.1), body, x + deskWidth / 2 - 0.25, 0.3, zc); // pedestal
        put(g, buildItem("office_chair", "#2b2b2b"), x, zc + sign * (deskD / 2 + 0.05), sign > 0 ? 180 : 0); // tucked in, facing the desk
      }
      for (let i = 0; i <= perSide; i++) {
        const x = Math.min(w / 2 - 0.015, Math.max(-w / 2 + 0.015, -w / 2 + deskWidth * i));
        box(g, 0.03, DESK_Y - DESK_T, deskD - 0.02, body, x, (DESK_Y - DESK_T) / 2, zc); // frame panel at each desk edge
      }
    }
    box(g, w, screenH, 0.03, screen, 0, DESK_Y + screenH / 2, sides === 2 ? 0 : -d / 2 + 0.015); // spine screen
    for (let i = 1; i < perSide; i++) box(g, 0.03, screenH, d - 0.02, screen, -w / 2 + deskWidth * i, DESK_Y + screenH / 2, 0); // between seats
  },
  dining_set: (g, b) => {
    const { table: [tl, td], chairs } = diningChairs(b.length, b.depth);
    put(g, buildSized("dining_table", { w: tl, d: td, h: b.height }, TOP_FINISHES[b.top ?? "oak"].color), 0, 0);
    for (const [x, z, rotation] of chairs) put(g, buildItem("dining_chair", b.color ?? SOFT), x, z, rotation);
  },
  bed_set: (g, b) => {
    const { bed, sideTables } = bedSet(b.length);
    put(g, buildSized("bed", { w: bed, d: b.depth, h: b.height }, b.color ?? SOFT), 0, 0);
    if (!sideTables) return;
    const side = FURNITURE.bedside_table;
    for (const sx of [-1, 1]) put(g, buildItem("bedside_table", BUILT_IN_FINISHES[b.body].color), sx * (bed / 2 + 0.05 + side.w / 2), -b.depth / 2 + side.d / 2);
  },
  lounge_set: (g, b) => {
    const { length: w, depth: d } = b;
    put(g, buildSized("rug", { w, d: d - 0.3, h: 0.01 }, "#e8e0d0"), 0, 0.15);
    put(g, buildSized("sofa", { w: Math.min(w, 2.6), d: 0.9, h: b.height }, b.color ?? SOFT), 0, -d / 2 + 0.45);
    put(g, buildItem("coffee_table", BUILT_IN_FINISHES[b.body].color), 0, -d / 2 + 0.9 + 0.45 + FURNITURE.coffee_table.d / 2);
  },
  wall_shelf: (g, b, body) => {
    const { length: w, depth: d, height: h } = b;
    const n = Math.max(1, Math.round(h / 0.35));
    const glow = new THREE.MeshBasicMaterial({ color: GLOW });
    for (let i = 0; i < n; i++) {
      const y = (i * h) / n;
      box(g, w, 0.03, d, body, 0, y + 0.015, 0);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(w - 0.04, 0.006, 0.01), glow);
      strip.position.set(0, y - 0.003, d / 2 - 0.02);
      g.add(strip);
      // Decor, one kind a board in turn: CC0 models, with these shapes until they load (or if they can't).
      const decor = new THREE.Group();
      const kind = i % 3;
      if (kind === 0) {
        BOOKS.forEach((c, k) => box(decor, 0.035, 0.2 + (k % 2) * 0.03, d * 0.7, plain(c, 0.8), -0.08 + k * 0.04, (0.2 + (k % 2) * 0.03) / 2, 0));
        withProp(decor, "books", { w: 0.2, d: d * 0.7, h: 0.23 }, BOOKS[0]);
        put(g, decor, -w / 2 + 0.18, 0, 0, y + 0.03);
      } else if (kind === 1) {
        const plant = buildItem("plant", "#d8cbb5");
        plant.scale.setScalar(0.28);
        decor.add(plant);
        withProp(decor, "plant_small", { w: 0.2, d: 0.2, h: 0.3 }, "#d8cbb5");
        put(g, decor, -w / 4, 0, 0, y + 0.03);
      } else {
        box(decor, 0.3, 0.36, 0.02, plain("#2b2a28", 0.6), 0, 0.18, 0); // a frame against the wall
        box(decor, 0.26, 0.32, 0.005, plain("#e8e0d0", 0.9), 0, 0.18, 0.012);
        withProp(decor, "frame", { w: 0.3, d: 0.05, h: 0.36 }, "#2b2a28");
        put(g, decor, -w / 4, -d / 2 + 0.05, 0, y + 0.03);
      }
    }
  },
};

/**
 * A built-in from boxes: runs, islands and counters get a toe kick, door lines and their top; shelving is open boards;
 * banquettes a seat and back; partitions a panel (framed glass when the body is glass); planter boxes are filled with plants.
 * Local x runs along its length and its front faces +z; the group sits on the floor (wall runs at worktop-plus height).
 */
export function buildBuiltIn(b: BuiltIn, roomHeight: number): THREE.Group {
  const g = new THREE.Group();
  const body = material(`body:${b.body}`, BUILT_IN_FINISHES[b.body], TINTED_BUILT_INS.includes(b.body) ? (b.color ?? undefined) : undefined);
  const top = b.top ? material(`top:${b.top}`, TOP_FINISHES[b.top]) : null;
  const { length: w, depth: d, height: h } = b;

  if (b.kind === "shelving") {
    for (const x of [-w / 2 + 0.01, w / 2 - 0.01]) box(g, 0.02, h, d, body, x, h / 2, 0);
    for (let y = 0.01; y < h; y += 0.38) box(g, w, 0.02, d, body, 0, y, 0);
    box(g, w, 0.02, d, body, 0, h - 0.01, 0);
    box(g, w, h, 0.01, body, 0, h / 2, -d / 2 + 0.005);
  } else if (b.kind === "banquette") {
    const seat = Math.min(0.45, h);
    box(g, w, seat, d, body, 0, seat / 2, 0);
    if (h > seat) box(g, w, h - seat, 0.12, body, 0, seat + (h - seat) / 2, -d / 2 + 0.06);
  } else if (b.kind === "partition") {
    const t = Math.max(0.04, Math.min(d, 0.12));
    if (b.body === "glass") {
      const frame = plain("#26272a", 0.4);
      box(g, w, h, 0.01, body, 0, h / 2, 0);
      for (const y of [0.02, h - 0.02]) box(g, w, 0.04, t, frame, 0, y, 0);
      for (const x of [-w / 2 + 0.02, w / 2 - 0.02]) box(g, 0.04, h, t, frame, x, h / 2, 0);
    } else box(g, w, h, t, body, 0, h / 2, 0);
  } else if (b.kind === "planter_box") {
    box(g, w, h, d, body, 0, h / 2, 0);
    box(g, w - 0.04, 0.02, d - 0.04, plain("#3b2e24", 1), 0, h - 0.02, 0);
    const n = Math.max(1, Math.round(w / 0.55));
    for (let i = 0; i < n; i++) {
      const plant = buildItem("plant", "#3b2e24"); // pot hidden in the soil
      const s = Math.min(1, (d + 0.2) / 0.6);
      plant.scale.setScalar(s);
      plant.position.set(-w / 2 + (w / n) * (i + 0.5), h - 0.12 * s, 0);
      g.add(plant);
    }
  } else if (SETS[b.kind]) {
    SETS[b.kind]!(g, b, body, top);
  } else {
    // base_run, tall_run, wall_run, island, bar, counter
    const toe = b.kind === "wall_run" || b.kind === "bar" ? 0 : TOE;
    const worktop = top ? TOP : 0;
    const bodyH = Math.max(0.1, h - toe - worktop);
    if (toe) box(g, w - 0.02, toe, d - 0.06, plain("#3a3836", 0.9), 0, toe / 2, -0.03);
    box(g, w, bodyH, d, body, 0, toe + bodyH / 2, 0);
    grooves(g, w, toe, bodyH, d, b.kind !== "tall_run" && b.kind !== "wall_run");
    if (top) {
      const overhang = b.kind === "bar" ? 0.25 : 0.02; // a bar's top reaches out for stools
      box(g, w + 0.02, worktop, d + overhang, top, 0, h - worktop / 2, overhang / 2);
    }
  }

  const mount = b.kind === "wall_run" ? 1.45 : b.kind === "wall_shelf" ? 1.1 : 0; // wall cabinets and shelves hang on the wall
  g.position.set(b.x, Math.max(0, Math.min(mount, roomHeight - h - 0.05)), b.z);
  g.rotation.y = (b.rotation * Math.PI) / 180;
  return g;
}
