import * as THREE from "three";
import type { Finish } from "@veenix/shared";

// Room geometry carries UVs in metres, so a texture repeats every `tile` metres whatever the surface size.
const loader = new THREE.TextureLoader();
type TextureEntry = { texture: THREE.Texture | null; waiting: ((t: THREE.Texture) => void)[] };
const textures = new Map<string, TextureEntry>();
const materials = new Map<string, THREE.MeshStandardMaterial>();
const METAL: Record<string, number> = { black_metal: 0.6, stainless: 0.85, mirror: 1 };

/** Calls `use` with the finish's map once it has loaded (straight away if cached). A map that fails never calls it. */
function withTexture(f: Finish, map: "color" | "normal" | "roughness", use: (t: THREE.Texture) => void) {
  const id = `${f.texture}/${map}:${f.tile}:${f.upright ?? false}`;
  let entry = textures.get(id);
  if (!entry) {
    const e: TextureEntry = { texture: null, waiting: [] };
    entry = e;
    textures.set(id, e);
    loader.load(`/materials/${f.texture}/${map}.jpg`, (t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(1 / f.tile, 1 / f.tile);
      if (f.upright) t.rotation = Math.PI / 2;
      t.anisotropy = 4;
      if (map === "color") t.colorSpace = THREE.SRGBColorSpace;
      e.texture = t;
      for (const fn of e.waiting.splice(0)) fn(t);
    }, undefined, () => { e.waiting.length = 0; }); // stays colour-only
  }
  if (entry.texture) use(entry.texture);
  else entry.waiting.push(use);
}

/**
 * The material for a finish, shared and cached (never dispose it). `key` is "<kind>:<finish>" (wall:marble,
 * top:marble...), since one finish name can differ by kind; the finish name picks metal and glass behaviour.
 * `tint` replaces the finish's colour (walls take theirs from the room). It's drawn in its colour until its maps load,
 * and stays that way if they can't, so a surface is never black.
 */
export function material(key: string, f: Finish, tint?: string): THREE.MeshStandardMaterial {
  const id = `${key}:${tint ?? ""}`;
  let m = materials.get(id);
  if (!m) {
    const name = key.slice(key.indexOf(":") + 1);
    const made = new THREE.MeshStandardMaterial({ color: tint ?? f.color, roughness: f.rough, metalness: METAL[name] ?? 0 });
    if (f.texture) {
      withTexture(f, "color", (t) => Object.assign(made, { map: t, needsUpdate: true }).color.set(tint ?? "#ffffff"));
      withTexture(f, "normal", (t) => Object.assign(made, { normalMap: t, needsUpdate: true }));
      withTexture(f, "roughness", (t) => Object.assign(made, { roughnessMap: t, needsUpdate: true }));
    }
    if (name === "glass") Object.assign(made, { transparent: true, opacity: 0.35, depthWrite: false });
    made.userData.shared = true;
    materials.set(id, made);
    m = made;
  }
  return m;
}

/** A plain colour material, shared like the finishes. */
export const plain = (color: string, rough = 0.85) => material(`plain:${color}:${rough}`, { label: "", tile: 1, color, rough });

/** Scales a 0–1 UV set to metres (planes and shapes built at their real size). */
export function metreUVs(geo: THREE.BufferGeometry, sx: number, sy: number, ox = 0, oy = 0) {
  const uv = geo.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, ox + uv.getX(i) * sx, oy + uv.getY(i) * sy);
  uv.needsUpdate = true;
  return geo;
}

/** A box whose every face carries UVs in metres. */
export function metreBox(w: number, h: number, d: number) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.getAttribute("uv") as THREE.BufferAttribute;
  const faces: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]; // +x, −x, +y, −y, +z, −z
  faces.forEach(([sx, sy], f) => {
    for (let i = f * 4; i < f * 4 + 4; i++) uv.setXY(i, uv.getX(i) * sx, uv.getY(i) * sy);
  });
  uv.needsUpdate = true;
  return geo;
}
