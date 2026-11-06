import * as THREE from "three";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

// ponytail: no office chair; Poly Haven has no CC0 task chair (owner, 2026-11-06), so it stays procedural.
export type PropName = "plant" | "plant_small" | "dining_chair" | "books" | "frame";

/**
 * CC0 models in public/models (sources in its LICENSE.md), one per prop. `facing` is the degrees that turn the model's
 * front to +z; `tint` is the name of the material the item's colour replaces (a plant's pot, a chair's seat), or null.
 */
export const PROPS: Record<PropName, { file: string; facing: number; tint: string | null }> = {
  plant: { file: "plant.glb", facing: 0, tint: "potted_plant_02_pot" },
  plant_small: { file: "plant_small.glb", facing: 0, tint: null },
  dining_chair: { file: "dining_chair.glb", facing: 0, tint: null }, // one material: tinting it would tint the wood too
  books: { file: "books.glb", facing: 0, tint: null },
  frame: { file: "frame.glb", facing: 0, tint: null },
};

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder); // the models are meshopt-compressed (gltf-transform optimize)
const models = new Map<PropName, Promise<THREE.Object3D | null>>();
const tints = new Map<string, THREE.Material>();

/** Each file loads once. Its geometry and materials are shared by every copy, so the canvas never disposes them. */
function load(name: PropName) {
  let p = models.get(name);
  if (!p) {
    p = loader.loadAsync(`/models/${PROPS[name].file}`).then(
      (gltf) => {
        gltf.scene.traverse((o) => {
          if (!(o instanceof THREE.Mesh)) return;
          o.castShadow = o.receiveShadow = true;
          o.geometry.userData.shared = true;
          for (const m of [o.material].flat()) m.userData.shared = true;
        });
        return gltf.scene;
      },
      (e) => {
        console.warn(`Model ${name} didn't load; keeping its shape`, e); // the procedural shape stays
        return null;
      },
    );
    models.set(name, p);
  }
  return p;
}

function dispose(o: THREE.Object3D) {
  o.traverse((m) => {
    if (!(m instanceof THREE.Mesh)) return;
    if (!m.geometry.userData.shared) m.geometry.dispose();
    for (const mat of [m.material].flat()) if (!mat.userData.shared) mat.dispose();
  });
}

/**
 * Swaps `group`'s procedural shape for the prop's model once it has loaded: turned to face +z, scaled to `size.h`, its
 * footprint centred on the origin and its base on the floor, `tint` recoloured. The group (and what it's picked by) stays.
 */
export function withProp(group: THREE.Group, name: PropName, size: { w: number; d: number; h: number }, color: string) {
  const { facing, tint } = PROPS[name];
  void load(name).then((source) => {
    if (!source) return;
    const model = source.clone(true);
    if (tint) {
      model.traverse((o) => {
        if (!(o instanceof THREE.Mesh) || [o.material].flat()[0]?.name !== tint) return;
        const key = `${name}:${color}`;
        let m = tints.get(key);
        if (!m) {
          const made = (o.material as THREE.MeshStandardMaterial).clone();
          made.color.set(color);
          made.userData.shared = true;
          tints.set(key, made);
          m = made;
        }
        o.material = m;
      });
    }
    const pivot = new THREE.Group();
    model.rotation.y = (facing * Math.PI) / 180;
    pivot.add(model);
    pivot.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(pivot);
    const centre = box.getCenter(new THREE.Vector3());
    model.position.set(-centre.x, -box.min.y, -centre.z);
    pivot.scale.setScalar(size.h / Math.max(1e-3, box.max.y - box.min.y));
    const old = [...group.children];
    group.clear();
    old.forEach(dispose);
    group.add(pivot);
  });
}
