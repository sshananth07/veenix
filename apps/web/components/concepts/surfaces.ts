import * as THREE from "three";
import { TINTED_FINISHES, WALL_FINISHES, type WallFinish } from "@veenix/shared";
import { material, metreBox, plain } from "./materials";

const SLAT = { w: 0.04, d: 0.02, gap: 0.03 };
const PAD = { w: 0.6, h: 1.2, d: 0.02, gap: 0.006 };
const BOARD = 0.018;
/** Wall finishes drawn with real depth (instead of a flat skin) when they cover a whole wall. */
export const DEEP_FINISHES: readonly WallFinish[] = ["timber_slats", "fabric_panel"];
/** How far a deep finish stands off its wall. */
export const RELIEF = 0.02;

function instanced(geo: THREE.BufferGeometry, m: THREE.Material, at: [number, number, number][]) {
  const mesh = new THREE.InstancedMesh(geo, m, at.length);
  const o = new THREE.Object3D();
  at.forEach(([x, y, z], i) => {
    o.position.set(x, y, z);
    o.updateMatrix();
    mesh.setMatrixAt(i, o.matrix);
  });
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

function backing(color: string, w: number, h: number) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), plain(color, 0.95));
  m.position.set(w / 2, h / 2, 0.001);
  m.receiveShadow = true;
  return m;
}

/**
 * A finish with real depth on a `w × h` patch of wall, local x from 0 to w and y from 0 to h, its back on z = 0 and its
 * front towards +z: timber slats (one instanced mesh on a dark backing), padded fabric tiles with dark seams, or an 18 mm
 * board in any other finish. `color` tints the tinted finishes, as on walls.
 */
export function surface(finish: WallFinish, color: string, w: number, h: number): THREE.Group {
  const g = new THREE.Group();
  const skin = material(`wall:${finish}`, WALL_FINISHES[finish], TINTED_FINISHES.includes(finish) ? color : undefined);
  if (finish === "timber_slats") {
    const stride = SLAT.w + SLAT.gap;
    const n = Math.max(1, Math.floor((w + SLAT.gap) / stride));
    const start = (w - (n * stride - SLAT.gap)) / 2 + SLAT.w / 2;
    g.add(backing("#2b2a28", w, h));
    g.add(instanced(metreBox(SLAT.w, h, SLAT.d), skin, Array.from({ length: n }, (_, i) => [start + i * stride, h / 2, SLAT.d / 2])));
  } else if (finish === "fabric_panel") {
    const [cols, rows] = [Math.max(1, Math.ceil(w / PAD.w)), Math.max(1, Math.ceil(h / PAD.h))];
    const [pw, ph] = [w / cols, h / rows];
    g.add(backing(`#${new THREE.Color(color).multiplyScalar(0.7).getHexString()}`, w, h));
    const at: [number, number, number][] = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) at.push([(c + 0.5) * pw, (r + 0.5) * ph, PAD.d / 2]);
    g.add(instanced(metreBox(pw - PAD.gap, ph - PAD.gap, PAD.d), skin, at));
  } else {
    const board = new THREE.Mesh(metreBox(w, h, BOARD), skin);
    board.position.set(w / 2, h / 2, BOARD / 2);
    board.castShadow = board.receiveShadow = true;
    g.add(board);
  }
  return g;
}
