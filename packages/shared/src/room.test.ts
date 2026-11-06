import { describe, expect, it } from "vitest";
import { FURNITURE, WALL_FACING, fitRoom, panelPieces, resolveRoom, roomSchema, upgradeRoom, wallPieces, wallPoint, withContents, type Room, type RoomDescription } from "./room";

const paint = { finish: "paint" as const, color: "#f4f1ea" };
const shell = {
  width: 4, length: 5, height: 2.8, floor: "light_oak" as const,
  walls: { back: paint, left: paint, right: paint, front: paint },
  ceiling: { color: "#f7f6f2", drops: [], cove: false, downlights: 0, units: [] },
  openings: [] as Room["openings"],
  nibs: [] as Room["nibs"],
};
const room = (over: Partial<Room> = {}): Room => ({ version: 2, ...shell, panels: [], builtIns: [], items: [], ...over });
const described = (over: Partial<RoomDescription> = {}): RoomDescription => ({ ...shell, panels: [], builtIns: [], items: [], ...over });
const item = (over: Partial<RoomDescription["items"][number]>) => ({ type: "bookshelf" as const, description: "oak bookshelf", wall: null, along: 0, out: 0, rotation: 0, color: "#c9a77c", ...over });
const builtIn = (over: Partial<RoomDescription["builtIns"][number]>) => ({
  kind: "base_run" as const, wall: "back" as const, along: 2, out: 0, rotation: 0, length: 1.2, depth: 0.6, height: 0.9, body: "white_laminate" as const, top: "quartz_white" as const, color: null, ...over,
});

describe("fitRoom", () => {
  it("keeps every item inside the walls, rotation included", () => {
    const fitted = fitRoom(room({
      items: [
        { type: "sofa", description: "sofa", x: 10, z: -10, rotation: 0, color: "#cccccc" }, // far outside, back-right corner
        { type: "sofa", description: "sofa", x: -1.9, z: 0, rotation: 90, color: "#cccccc" }, // turned against the left wall
        { type: "rug", description: "rug", x: 0, z: 0, rotation: 0, color: "#cccccc" }, // already inside
      ],
    }));
    const { w, d } = FURNITURE.sofa;
    const [corner, turned, rug] = fitted.items;
    expect(corner.x).toBeCloseTo(2 - w / 2);
    expect(corner.z).toBeCloseTo(-2.5 + d / 2);
    expect(turned.x).toBeCloseTo(-2 + d / 2); // rotated 90°, so its depth runs along x
    expect(rug).toMatchObject({ x: 0, z: 0 });
  });

  it("keeps built-ins inside the walls by their own size", () => {
    const [run] = fitRoom(room({ builtIns: [{ kind: "base_run", x: 5, z: 0, rotation: 270, length: 2, depth: 0.6, height: 0.9, body: "white_laminate", top: null }] })).builtIns;
    expect(run.x).toBeCloseTo(2 - 0.3); // turned 270°, so its 0.6 m depth runs along x
  });

  it("clamps openings to their wall and the ceiling", () => {
    const fitted = fitRoom(room({
      openings: [
        { wall: "back", kind: "window", at: 9, width: 6, height: 2, sill: 1.5 }, // back wall is 4 m wide
        { wall: "left", kind: "door", at: 0, width: 0.9, height: 2.1, sill: 0 }, // left wall is 5 m long
      ],
    }));
    const [win, door] = fitted.openings;
    expect(win.width).toBe(4);
    expect(win.at).toBe(2);
    expect(win.sill + win.height).toBeLessThanOrEqual(2.8);
    expect(door.at).toBeCloseTo(0.45);
  });
});

describe("resolveRoom", () => {
  it("places a wall item against its wall, facing into the room", () => {
    const { d } = FURNITURE.bookshelf;
    const r = resolveRoom(described({
      items: [
        item({ wall: "back", along: 1, out: 0 }),
        item({ wall: "left", along: 1, out: 0.1 }),
        item({ wall: "right", along: 1, out: 0 }),
        item({ wall: "front", along: 1, out: 0 }),
        item({ wall: null, along: 0.5, out: -0.5, rotation: 45 }),
      ],
    }));
    const [back, left, right, front, free] = r.items;
    expect(back).toMatchObject({ x: -1, rotation: 0 });
    expect(back.z).toBeCloseTo(-2.5 + d / 2);
    // Seen from inside, the left wall's left end is the front corner (z = +2.5).
    expect(left).toMatchObject({ z: 1.5, rotation: 90 });
    expect(left.x).toBeCloseTo(-2 + 0.1 + d / 2);
    expect(right).toMatchObject({ z: -1.5, rotation: 270 });
    expect(right.x).toBeCloseTo(2 - d / 2);
    expect(front).toMatchObject({ x: 1, rotation: 180 });
    expect(front.z).toBeCloseTo(2.5 - d / 2);
    expect(free).toMatchObject({ x: 0.5, z: -0.5, rotation: 45 });
    expect(r.version).toBe(2);
    expect(r.items[0].description).toBe("oak bookshelf");
  });

  it("keeps built-ins and items out of door openings", () => {
    const r = resolveRoom(described({
      openings: [{ wall: "back", kind: "door", at: 2, width: 0.9, height: 2.1, sill: 0 }],
      builtIns: [builtIn({ along: 2.2, length: 1.2 })], // overlaps the door, nearer its right side
      items: [item({ wall: "back", along: 1.8 }), item({ wall: "back", along: 2, out: 1.5 })], // the second stands well clear
    }));
    const doorLeft = -2 + 2 - 0.45, doorRight = -2 + 2 + 0.45;
    const [run] = r.builtIns;
    expect(run.x - 0.6).toBeGreaterThanOrEqual(doorRight - 1e-9);
    const [shelf, clear] = r.items;
    expect(shelf.x + FURNITURE.bookshelf.w / 2).toBeLessThanOrEqual(doorLeft + 1e-9);
    expect(clear.x).toBeCloseTo(0);
  });

  it("keeps a corner run out of a door on the next wall, shortening it when it can't slide", () => {
    // Left-wall door next to the back corner: z −2.35…−1.45, its doorway reaching 0.9 m in (x −2…−1.1).
    const r = resolveRoom(described({
      openings: [{ wall: "left", kind: "door", at: 4.4, width: 0.9, height: 2.1, sill: 0 }],
      builtIns: [builtIn({ wall: "back", along: 2, length: 4 })], // the full back wall, across the doorway
    }));
    const [run] = r.builtIns;
    expect(run.x - run.length / 2).toBeGreaterThanOrEqual(-1.1 - 1e-9);
    expect(run.x + run.length / 2).toBeLessThanOrEqual(2 + 1e-9);
    expect(run.length).toBeCloseTo(3.1);
  });

  it("pushes a free-standing item out of a doorway, into the room", () => {
    const r = resolveRoom(described({
      openings: [{ wall: "front", kind: "door", at: 2, width: 0.9, height: 2.1, sill: 0 }], // x −0.45…0.45, doorway z 1.6…2.5
      items: [item({ type: "armchair", wall: null, along: 0, out: 2.1 })],
    }));
    const [chair] = r.items;
    expect(chair.z + FURNITURE.armchair.d / 2).toBeLessThanOrEqual(1.6 + 1e-9);
    expect(chair.x).toBeCloseTo(0);
  });

  it("pulls everything inside the walls, rotation included", () => {
    const r = resolveRoom(described({
      builtIns: [builtIn({ wall: "right", along: 9, length: 2 })],
      items: [item({ wall: "front", along: -3 })],
    }));
    expect(r.builtIns[0]).toMatchObject({ rotation: 270 });
    expect(r.builtIns[0].z).toBeCloseTo(2.5 - 1); // 2 m run, pulled back from beyond the front corner
    expect(r.items[0].x).toBeCloseTo(2 - FURNITURE.bookshelf.w / 2);
  });
});

describe("wallPieces", () => {
  const door = { wall: "back" as const, kind: "door" as const, at: 1, width: 0.8, height: 2.1, sill: 0 };
  const window = { wall: "back" as const, kind: "window" as const, at: 3, width: 1, height: 1.2, sill: 0.9 };

  it("splits a wall into solid pieces around its openings", () => {
    expect(wallPieces(4, 2.8, [])).toEqual([[0, 4, 0, 2.8]]);
    const pieces = wallPieces(4, 2.8, [door, window]);
    expect(pieces).toContainEqual([0.6, 1.4, 2.1, 2.8]); // over the door; nothing under it
    expect(pieces.some(([x0, , y0]) => x0 === 0.6 && y0 === 0)).toBe(false);
    expect(pieces).toContainEqual([2.5, 3.5, 0, 0.9]); // under the window
    expect(pieces).toContainEqual([2.5, 3.5, 2.1, 2.8]); // over it
    const area = pieces.reduce((a, [x0, x1, y0, y1]) => a + (x1 - x0) * (y1 - y0), 0);
    expect(area).toBeCloseTo(4 * 2.8 - 0.8 * 2.1 - 1 * 1.2);
  });

  it("a cut-down wall keeps only what's below the cut", () => {
    const pieces = wallPieces(4, 1, [door, window]);
    expect(pieces.every(([, , , y1]) => y1 <= 1)).toBe(true);
    expect(pieces.some(([x0]) => x0 === 0.6)).toBe(false); // the door goes right through a low wall
    expect(pieces).toContainEqual([2.5, 3.5, 0, 0.9]);
  });
});

describe("wallPoint", () => {
  it("matches resolveRoom's placement on every wall", () => {
    const r = { width: 4, length: 5 };
    expect(wallPoint(r, "back", 1, 0.5)).toEqual([-1, -2]);
    expect(wallPoint(r, "left", 1, 0.5)).toEqual([-1.5, 1.5]);
    expect(wallPoint(r, "right", 1, 0.5)).toEqual([1.5, -1.5]);
    expect(wallPoint(r, "front", 1, 0.5)).toEqual([1, 2]);
    expect(WALL_FACING).toEqual({ back: 0, left: 90, right: 270, front: 180 });
  });
});

describe("upgradeRoom", () => {
  it("turns a v1 room into v2 and passes v2 through", () => {
    const v1 = {
      width: 4, length: 5, height: 2.8, wallColor: "#e0d8cc", floor: "walnut",
      openings: [{ wall: "back", kind: "window", at: 2, width: 1.5, height: 1.4, sill: 0.9 }],
      items: [{ type: "sofa", x: 0, z: 1, rotation: 0, color: "#c8b8a0" }],
    };
    const up = upgradeRoom(v1)!;
    expect(up).toMatchObject({ version: 2, floor: "walnut", builtIns: [], ceiling: { cove: false, downlights: 0 } });
    expect(up.walls.left).toEqual({ finish: "paint", color: "#e0d8cc" });
    expect(up.items[0]).toMatchObject({ type: "sofa", description: "Sofa", x: 0, z: 1 });
    expect(roomSchema.safeParse(up).success).toBe(true);
    expect(upgradeRoom(room())).toEqual(room());
    expect(upgradeRoom({ width: "big" })).toBeNull();
    expect(upgradeRoom(null)).toBeNull();
  });
});

describe("roomSchema", () => {
  it("refuses junk", () => {
    expect(roomSchema.safeParse(room({ walls: { ...shell.walls, back: { finish: "paint", color: "red" } } })).success).toBe(false);
    expect(roomSchema.safeParse({ ...room(), walls: { ...shell.walls, back: { finish: "gold_leaf", color: "#ffffff" } } }).success).toBe(false);
    expect(roomSchema.safeParse(room({ items: Array(41).fill({ type: "plant", description: "plant", x: 0, z: 0, rotation: 0, color: "#00ff00" }) })).success).toBe(false);
    expect(roomSchema.safeParse(room({ builtIns: Array(13).fill({ kind: "base_run", x: 0, z: 0, rotation: 0, length: 1, depth: 0.6, height: 0.9, body: "white_laminate", top: null }) })).success).toBe(false);
    expect(roomSchema.safeParse(room({ width: Number.NaN })).success).toBe(false);
    expect(roomSchema.safeParse(room()).success).toBe(true);
  });
});

describe("plan 18 fields", () => {
  it("opens a v2 room stored before plan 18 with no nibs, panels or built-in colours", () => {
    const { nibs: _, ...oldShell } = shell;
    const old = { version: 2, ...oldShell, builtIns: [{ kind: "base_run", x: 0, z: -2.2, rotation: 0, length: 1.2, depth: 0.6, height: 0.9, body: "white_laminate", top: null }], items: [] };
    const up = upgradeRoom(old)!;
    expect(up.nibs).toEqual([]);
    expect(up.panels).toEqual([]);
    expect(up.builtIns[0].color).toBeNull();
  });

  it("clamps panels and nibs to their wall", () => {
    const r = fitRoom(room({
      panels: [{ wall: "back", at: 3.9, width: 6, height: 4, finish: "timber_slats", color: "#a87d55" }],
      nibs: [{ wall: "left", at: 0, width: 0.6, depth: 0.4 }],
    }));
    expect(r.panels[0]).toMatchObject({ width: 4, at: 2, height: 2.8 });
    expect(r.nibs[0]).toMatchObject({ at: 0.3, width: 0.6 });
  });

  it("withContents keeps the shell and resolves the new contents inside it, off the doors", () => {
    const base = room({
      openings: [{ wall: "back", kind: "door", at: 2, width: 0.9, height: 2.1, sill: 0 }],
      nibs: [{ wall: "right", at: 1, width: 0.4, depth: 0.3 }],
      builtIns: [{ kind: "base_run", x: 1, z: -2.2, rotation: 0, length: 1, depth: 0.6, height: 0.9, body: "white_laminate", top: null, color: null }],
    });
    const r = withContents(base, {
      panels: [{ wall: "left", at: 2, width: 1.2, height: 2.4, finish: "timber_slats", color: "#a87d55" }],
      builtIns: [builtIn({ kind: "workstation", along: 2, length: 1.4, depth: 0.7, height: 1.2, color: "#8f9f7d" })],
      items: [item({ wall: null, along: 9, out: 9 })],
    });
    expect({ ...r, panels: [], builtIns: [], items: [] }).toEqual({ ...base, builtIns: [] });
    expect(r.panels).toHaveLength(1);
    const [desk] = r.builtIns;
    expect(desk).toMatchObject({ kind: "workstation", color: "#8f9f7d" });
    const doorRight = -2 + 2 + 0.45, doorLeft = -2 + 2 - 0.45;
    expect(desk.x - 0.7 >= doorRight - 1e-9 || desk.x + 0.7 <= doorLeft + 1e-9).toBe(true);
    expect(r.items[0].x).toBeLessThanOrEqual(2);
    expect(r.items[0].z).toBeLessThanOrEqual(2.5);
  });

  it("panelPieces leaves a door and a window under a panel open", () => {
    const r = room({
      openings: [
        { wall: "back", kind: "door", at: 1.5, width: 0.9, height: 2.1, sill: 0 },
        { wall: "back", kind: "window", at: 3, width: 0.8, height: 1, sill: 1 },
        { wall: "left", kind: "window", at: 2, width: 1, height: 1, sill: 1 }, // another wall: ignored
      ],
    });
    const pieces = panelPieces(r, { wall: "back", at: 2, width: 3, height: 2.8, finish: "timber_slats", color: "#a87d55" });
    const holes = [[0.55, 1.45, 0, 2.1], [2.1, 2.9, 1, 2]]; // in the panel's coordinates (it starts 0.5 m along the wall)
    for (const [x0, x1, y0, y1] of pieces) for (const [a0, a1, b0, b1] of holes) expect(x0 < a1 - 1e-9 && x1 > a0 + 1e-9 && y0 < b1 - 1e-9 && y1 > b0 + 1e-9).toBe(false);
    const area = pieces.reduce((s, [x0, x1, y0, y1]) => s + (x1 - x0) * (y1 - y0), 0);
    expect(area).toBeCloseTo(3 * 2.8 - 0.9 * 2.1 - 0.8 * 1);
  });
});
