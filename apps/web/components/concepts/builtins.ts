import * as THREE from "three";
import { BUILT_IN_FINISHES, TINTED_BUILT_INS, TOP_FINISHES, type Room } from "@veenix/shared";
import { buildItem } from "./furniture";
import { material, metreBox, plain } from "./materials";

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

  g.position.set(b.x, b.kind === "wall_run" ? Math.max(0, Math.min(1.45, roomHeight - h - 0.05)) : 0, b.z);
  g.rotation.y = (b.rotation * Math.PI) / 180;
  return g;
}
