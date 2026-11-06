import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { FURNITURE, type FurnitureType } from "@veenix/shared";
import { withProp, type PropName } from "./props";

const LEAF = "#5b8a4e";
// ponytail: furniture is built from rounded boxes and cylinders, so there are no model files or licences.
// It reads as an architectural model, not a photo; swap in GLB models per type if clients need more realism.

const DARK_WOOD = "#3b2f2a";
const METAL = "#2b2b2b";
const LINEN = "#f3efe7";

const mat = (color: string, roughness = 0.75, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });

function box(g: THREE.Group, w: number, h: number, d: number, color: string, x: number, y: number, z: number, r = 0.02) {
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2)), mat(color));
  m.position.set(x, y + h / 2, z); // y is the bottom of the box
  g.add(m);
  return m;
}

function cyl(g: THREE.Group, rTop: number, rBottom: number, h: number, color: string, x: number, y: number, z: number, m = mat(color)) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, 24), m);
  mesh.position.set(x, y + h / 2, z);
  g.add(mesh);
  return mesh;
}

const legs = (g: THREE.Group, w: number, d: number, h: number, color: string, inset = 0.06, r = 0.02) => {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(g, r, r, h, color, sx * (w / 2 - inset), 0, sz * (d / 2 - inset));
};

function seat(g: THREE.Group, w: number, d: number, h: number, color: string) {
  legs(g, w, d, 0.1, DARK_WOOD, 0.08, 0.025);
  box(g, w, 0.32, d, color, 0, 0.1, 0, 0.06); // base
  box(g, w - 0.36, 0.14, d - 0.25, color, 0, 0.42, 0.06, 0.06); // seat cushion
  box(g, w, h - 0.1, 0.22, color, 0, 0.1, -d / 2 + 0.11, 0.08); // back
  for (const s of [-1, 1]) box(g, 0.18, 0.5, d, color, s * (w / 2 - 0.09), 0.1, 0, 0.07); // arms
}

function table(g: THREE.Group, w: number, d: number, h: number, color: string) {
  box(g, w, 0.04, d, color, 0, h - 0.04, 0, 0.015);
  legs(g, w, d, h - 0.04, color, 0.08, 0.025);
}

function cabinet(g: THREE.Group, w: number, d: number, h: number, color: string, doors: number) {
  box(g, w, h - 0.06, d, color, 0, 0.06, 0, 0.015);
  box(g, w - 0.04, 0.06, d - 0.04, DARK_WOOD, 0, 0, 0, 0.005); // plinth
  for (let i = 1; i < doors; i++) box(g, 0.006, h - 0.12, 0.01, DARK_WOOD, -w / 2 + (w / doors) * i, 0.09, d / 2, 0.002);
}

function chair(g: THREE.Group, w: number, d: number, seatH: number, h: number, color: string, back: boolean) {
  legs(g, w, d, seatH - 0.04, DARK_WOOD, 0.04, 0.018);
  box(g, w, 0.05, d, color, 0, seatH - 0.05, 0, 0.02);
  if (back) box(g, w, h - seatH, 0.04, color, 0, seatH, -d / 2 + 0.02, 0.02);
}

const BUILDERS: Record<FurnitureType, (g: THREE.Group, s: { w: number; d: number; h: number }, color: string) => void> = {
  sofa: (g, s, c) => seat(g, s.w, s.d, s.h, c),
  armchair: (g, s, c) => seat(g, s.w, s.d, s.h, c),
  coffee_table: (g, s, c) => table(g, s.w, s.d, s.h, c),
  side_table: (g, s, c) => { cyl(g, s.w / 2, s.w / 2, 0.04, c, 0, s.h - 0.04, 0); cyl(g, 0.03, 0.03, s.h - 0.04, METAL, 0, 0, 0); cyl(g, 0.18, 0.18, 0.02, METAL, 0, 0, 0); },
  dining_table: (g, s, c) => table(g, s.w, s.d, s.h, c),
  dining_chair: (g, s, c) => chair(g, s.w, s.d, 0.46, s.h, c, true),
  bed: (g, s, c) => {
    box(g, s.w, 0.3, s.d, DARK_WOOD, 0, 0, 0, 0.02);
    box(g, s.w - 0.06, 0.22, s.d - 0.12, LINEN, 0, 0.3, 0.03, 0.06); // mattress
    box(g, s.w - 0.02, 0.06, s.d * 0.62, c, 0, 0.5, s.d * 0.18, 0.03); // duvet
    for (const x of [-1, 1]) box(g, s.w * 0.36, 0.12, 0.35, LINEN, x * s.w * 0.22, 0.52, -s.d / 2 + 0.3, 0.05); // pillows
    box(g, s.w, s.h, 0.08, c, 0, 0, -s.d / 2 + 0.04, 0.03); // headboard
  },
  bedside_table: (g, s, c) => cabinet(g, s.w, s.d, s.h, c, 1),
  wardrobe: (g, s, c) => cabinet(g, s.w, s.d, s.h, c, 3),
  tv_console: (g, s, c) => cabinet(g, s.w, s.d, s.h, c, 3),
  tv: (g, s) => { box(g, s.w, s.h, 0.04, "#111111", 0, 0.6, 0, 0.01); }, // ponytail: mounted at 0.6 m, above a console
  bookshelf: (g, s, c) => {
    for (const x of [-1, 1]) box(g, 0.03, s.h, s.d, c, x * (s.w / 2 - 0.015), 0, 0, 0.005);
    for (let i = 0; i <= 5; i++) box(g, s.w, 0.025, s.d, c, 0, (i * (s.h - 0.025)) / 5, 0, 0.005);
    for (let i = 0; i < 5; i++) box(g, s.w * 0.55, 0.22, s.d * 0.7, ["#8a6d5a", "#4f6b77", "#b7a07c"][i % 3], -s.w * 0.12 + (i % 2) * 0.1, (i * (s.h - 0.025)) / 5 + 0.025, 0, 0.01); // books
  },
  desk: (g, s, c) => table(g, s.w, s.d, s.h, c),
  office_chair: (g, s, c) => { cyl(g, 0.3, 0.3, 0.03, METAL, 0, 0.05, 0); cyl(g, 0.03, 0.03, 0.4, METAL, 0, 0.05, 0); box(g, 0.5, 0.08, 0.48, c, 0, 0.45, 0, 0.04); box(g, 0.46, 0.5, 0.06, c, 0, 0.5, -0.22, 0.04); },
  rug: (g, s, c) => { box(g, s.w, 0.012, s.d, c, 0, 0, 0, 0.004); },
  floor_lamp: (g, s, c) => {
    cyl(g, 0.14, 0.16, 0.03, METAL, 0, 0, 0);
    cyl(g, 0.012, 0.012, s.h - 0.3, METAL, 0, 0.03, 0);
    cyl(g, 0.12, 0.2, 0.3, c, 0, s.h - 0.3, 0, new THREE.MeshStandardMaterial({ color: c, emissive: "#ffd9a0", emissiveIntensity: 0.25, side: THREE.DoubleSide }));
  },
  pendant_light: (g, s, c) => {
    cyl(g, 0.005, 0.005, s.h, METAL, 0, 0, 0);
    cyl(g, 0.06, s.w / 2, 0.22, c, 0, 0, 0, new THREE.MeshStandardMaterial({ color: c, emissive: "#ffd9a0", emissiveIntensity: 0.3, side: THREE.DoubleSide }));
  },
  plant: (g, s, c) => {
    cyl(g, 0.17, 0.13, 0.32, c, 0, 0, 0); // the colour is the pot; leaves are always green
    for (const [x, y, z, r] of [[0, 0.75, 0, 0.26], [0.12, 0.95, 0.05, 0.2], [-0.1, 1.0, -0.04, 0.18], [0.02, 0.55, 0.1, 0.2]]) {
      const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), mat(LEAF, 0.9));
      leaf.position.set(x, y, z);
      g.add(leaf);
    }
  },
  kitchen_counter: (g, s, c) => { cabinet(g, s.w, s.d, s.h - 0.04, c, 4); box(g, s.w + 0.02, 0.04, s.d + 0.02, "#e9e6df", 0, s.h - 0.04, 0, 0.005); },
  kitchen_island: (g, s, c) => { cabinet(g, s.w, s.d, s.h - 0.04, c, 3); box(g, s.w + 0.1, 0.04, s.d + 0.1, "#e9e6df", 0, s.h - 0.04, 0, 0.005); },
  bar_stool: (g, s, c) => chair(g, s.w, s.d, s.h, s.h, c, false),
  vanity: (g, s, c) => { cabinet(g, s.w, s.d, s.h - 0.04, c, 2); box(g, s.w, 0.04, s.d, "#f2f2f0", 0, s.h - 0.04, 0, 0.005); cyl(g, 0.18, 0.15, 0.12, "#ffffff", 0, s.h, 0.02); },
};

// The catalogue types drawn with a CC0 model (plan 18); the rest stay procedural.
const PROPS_OF: Partial<Record<FurnitureType, PropName>> = { plant: "plant", dining_chair: "dining_chair" };

/** One catalogue item, its origin on the floor at the centre of its footprint, its front facing +z. */
export const buildItem = (type: FurnitureType, color: string) => buildSized(type, FURNITURE[type], color);

/** A catalogue piece at a size other than the catalogue's (a set's bed, sofa or table). */
export function buildSized(type: FurnitureType, size: { w: number; d: number; h: number }, color: string): THREE.Group {
  const g = new THREE.Group();
  BUILDERS[type](g, size, color);
  const prop = PROPS_OF[type];
  if (prop) withProp(g, prop, size, color); // the shape stays until the model loads, and if it can't
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = type !== "rug";
      o.receiveShadow = true;
    }
  });
  return g;
}
