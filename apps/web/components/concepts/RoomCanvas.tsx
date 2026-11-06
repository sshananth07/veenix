"use client";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import type { Room } from "@veenix/shared";
import { buildBuiltIn } from "./builtins";
import { buildItem } from "./furniture";
import { buildShell, downlightSpots, type WallPart } from "./shell";

export type Light = "day" | "evening";
export type RoomCanvasProps = {
  room: Room;
  light: Light;
  walk: boolean;
  selected: number | null;
  onSelect: (index: number | null) => void;
  onMove: (index: number, x: number, z: number) => void;
  onError: () => void;
};
type Stage = {
  renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls;
  shell: THREE.Group; walls: WallPart[]; ceiling: THREE.Group; builtIns: THREE.Group; items: THREE.Group; lights: THREE.Group;
  glass: THREE.MeshStandardMaterial; helper: THREE.BoxHelper | null;
};

const WARM = "#ffb36b";

function dispose(o: THREE.Object3D) {
  o.traverse((m) => {
    if (!(m instanceof THREE.Mesh)) return;
    m.geometry.dispose();
    for (const material of [m.material].flat()) if (!material.userData.shared) material.dispose(); // finishes are shared and cached
  });
}

function buildBuiltIns(room: Room) {
  const g = new THREE.Group();
  for (const b of room.builtIns) g.add(buildBuiltIn(b, room.height));
  return g;
}

// ponytail: device heuristic for ambient occlusion; add a quality toggle if it guesses wrong.
const highQuality = () => matchMedia("(pointer: fine)").matches || (devicePixelRatio <= 2 && (navigator.hardwareConcurrency ?? 0) >= 8);

function buildItems(room: Room) {
  const g = new THREE.Group();
  room.items.forEach((it, index) => {
    const item = buildItem(it.type, it.color);
    item.position.set(it.x, it.type === "pendant_light" ? room.height - 0.62 : 0, it.z);
    item.rotation.y = (it.rotation * Math.PI) / 180;
    item.userData.index = index;
    g.add(item);
  });
  return g;
}

function buildLights(room: Room, light: Light, scene: THREE.Scene, glass: THREE.MeshStandardMaterial) {
  const g = new THREE.Group();
  const { width: W, length: L, height: H } = room;
  const day = light === "day";
  scene.environmentIntensity = day ? 0.55 : 0.12;
  glass.color.set(day ? "#cfe3f2" : "#0e1320"); // night outside the window
  glass.emissive.set(day ? "#d8ecff" : "#141b2e");
  glass.emissiveIntensity = day ? 1 : 0.4;
  g.add(new THREE.HemisphereLight(day ? "#ffffff" : "#33406a", day ? "#b8a48c" : "#1a1410", day ? 0.8 : 0.15));
  const sun = new THREE.DirectionalLight(day ? "#fff4e2" : "#9fb3ff", day ? 2.2 : 0.12);
  sun.position.set(W * 0.6, H * 3, L * 0.8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0005;
  const r = Math.max(W, L);
  Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 0.1, far: H * 8 });
  g.add(sun, sun.target);
  if (!day) {
    const lamps = room.items.filter((it) => it.type === "floor_lamp" || it.type === "pendant_light");
    const spots = [
      ...lamps.map((it) => [it.x, it.type === "pendant_light" ? H - 0.75 : 1.45, it.z] as const),
      ...downlightSpots(room).map(([x, z]) => [x, H - 0.3, z] as const),
    ];
    if (!spots.length) spots.push([0, H - 0.4, 0]);
    spots.slice(0, 4).forEach(([x, y, z], i) => {
      const lamp = new THREE.PointLight(WARM, Math.max(3, 12 / Math.min(4, spots.length)), 9, 1.6); // shared out, so more lights don't blow out the room
      lamp.position.set(x, y, z);
      lamp.castShadow = i === 0;
      g.add(lamp);
    });
  }
  return g;
}

/** The room in 3D: drag to rotate, scroll or pinch to zoom, tap an item to select it, drag a selected item to move it. */
export default function RoomCanvas(props: RoomCanvasProps) {
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<Stage | null>(null);
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    const el = host.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      latest.current.onError(); // no WebGL
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.85; // keeps light walls from washing out
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const canvas = renderer.domElement;
    el.appendChild(canvas);
    const lost = (e: Event) => {
      e.preventDefault();
      latest.current.onError();
    };
    canvas.addEventListener("webglcontextlost", lost);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#16181b");
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 200);
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI * 0.49; // never below the floor
    const glass = new THREE.MeshStandardMaterial({ color: "#cfe3f2", roughness: 0.1, metalness: 0.1 });
    const s: Stage = {
      renderer, scene, camera, controls, shell: new THREE.Group(), walls: [], ceiling: new THREE.Group(), builtIns: new THREE.Group(),
      items: new THREE.Group(), lights: new THREE.Group(), glass, helper: null,
    };
    // Ambient occlusion darkens corners and the feet of furniture; only where the device can afford it.
    let composer: EffectComposer | null = null;
    if (highQuality()) {
      composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      composer.addPass(new GTAOPass(scene, camera, el.clientWidth || 512, el.clientHeight || 512));
      composer.addPass(new OutputPass());
    }
    stage.current = s;

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = el;
      if (!w || !h) return;
      renderer.setSize(w, h);
      composer?.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    // Tap to select; drag a selected item along the floor. The room only changes on release.
    const ray = new THREE.Raycaster();
    const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const aim = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    };
    const itemUnder = () => {
      let o: THREE.Object3D | null = ray.intersectObjects(s.items.children, true)[0]?.object ?? null;
      while (o && o.userData.index === undefined) o = o.parent;
      return o;
    };
    const onFloor = () => ray.ray.intersectPlane(floorPlane, new THREE.Vector3());
    let press: { x: number; y: number; drag: THREE.Object3D | null; offset: THREE.Vector3 } | null = null;
    const down = (e: PointerEvent) => {
      aim(e);
      const hit = itemUnder();
      press = { x: e.clientX, y: e.clientY, drag: null, offset: new THREE.Vector3() };
      const p = onFloor();
      if (hit && p && hit.userData.index === latest.current.selected) {
        press.drag = hit;
        press.offset = hit.position.clone().sub(p);
        controls.enabled = false;
        canvas.setPointerCapture(e.pointerId);
      }
    };
    const move = (e: PointerEvent) => {
      if (!press?.drag) return;
      aim(e);
      const p = onFloor();
      if (!p) return;
      press.drag.position.set(p.x + press.offset.x, press.drag.position.y, p.z + press.offset.z);
      s.helper?.update();
    };
    const up = (e: PointerEvent) => {
      if (!press) return;
      const moved = Math.hypot(e.clientX - press.x, e.clientY - press.y) > 4;
      if (press.drag) {
        controls.enabled = true;
        if (moved) latest.current.onMove(press.drag.userData.index, press.drag.position.x, press.drag.position.z);
      } else if (!moved) {
        aim(e);
        latest.current.onSelect((itemUnder()?.userData.index as number | undefined) ?? null);
      }
      press = null;
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);

    const toCamera = new THREE.Vector3();
    renderer.setAnimationLoop(() => {
      controls.update();
      // Doll's house: in the overview, walls between the camera and the room drop to a low cut, and the ceiling goes.
      const walk = latest.current.walk;
      for (const w of s.walls) {
        const away = !walk && toCamera.copy(camera.position).sub(w.centre).dot(w.normal) < 0;
        w.full.visible = !away;
        w.low.visible = away;
      }
      s.ceiling.visible = walk;
      if (composer) composer.render();
      else renderer.render(scene, camera);
    });
    return () => {
      renderer.setAnimationLoop(null);
      ro.disconnect();
      controls.dispose();
      canvas.removeEventListener("webglcontextlost", lost);
      dispose(scene);
      scene.environment?.dispose();
      pmrem.dispose();
      composer?.dispose();
      renderer.dispose();
      canvas.remove();
      stage.current = null;
    };
  }, []);

  const { room, light, walk, selected } = props;

  // The room: rebuilt whenever it changes (≤ 40 simple items, so this stays fast).
  useEffect(() => {
    const s = stage.current;
    if (!s) return;
    s.scene.remove(s.shell, s.builtIns, s.items);
    dispose(s.shell);
    dispose(s.builtIns);
    dispose(s.items);
    ({ group: s.shell, walls: s.walls, ceiling: s.ceiling } = buildShell(room, s.glass));
    s.builtIns = buildBuiltIns(room);
    s.items = buildItems(room);
    s.scene.add(s.shell, s.builtIns, s.items);
  }, [room]);

  useEffect(() => {
    const s = stage.current;
    if (!s) return;
    s.scene.remove(s.lights);
    s.lights = buildLights(room, light, s.scene, s.glass);
    s.scene.add(s.lights);
  }, [room, light]);

  // The camera moves only when the view or the room's size changes, not when an item moves.
  const { width: W, length: L, height: H } = room;
  useEffect(() => {
    const s = stage.current;
    if (!s) return;
    if (walk) {
      s.camera.position.set(0, 1.6, L / 2 - 0.3);
      s.controls.target.set(0, 1.35, -L / 2 + 0.5);
    } else {
      const back = Math.max(1, 1.1 / s.camera.aspect); // a portrait phone needs the camera further out to fit the room
      s.camera.position.set(W * 0.75 * back, H * 2.1 * back, L * 1.25 * back);
      s.controls.target.set(0, H * 0.25, 0);
    }
    s.controls.minDistance = walk ? 0.5 : 1.5;
    s.controls.maxDistance = Math.max(W, L) * 3;
    s.controls.update();
  }, [walk, W, L, H]);

  useEffect(() => {
    const s = stage.current;
    if (!s) return;
    if (s.helper) s.scene.remove(s.helper);
    s.helper?.dispose();
    const item = selected === null ? undefined : s.items.children.find((c) => c.userData.index === selected);
    s.helper = item ? new THREE.BoxHelper(item, 0xffffff) : null;
    if (s.helper) s.scene.add(s.helper);
  }, [selected, room]);

  return <div ref={host} className="h-full w-full touch-none" />;
}
