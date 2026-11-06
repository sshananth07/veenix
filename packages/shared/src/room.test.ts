import { describe, expect, it } from "vitest";
import { FURNITURE, fitRoom, resolveRoom, roomSchema, upgradeRoom, type Room, type RoomDescription } from "./room";

const paint = { finish: "paint" as const, color: "#f4f1ea" };
const shell = {
  width: 4, length: 5, height: 2.8, floor: "light_oak" as const,
  walls: { back: paint, left: paint, right: paint, front: paint },
  ceiling: { color: "#f7f6f2", drops: [], cove: false, downlights: 0, units: [] },
  openings: [] as Room["openings"],
};
const room = (over: Partial<Room> = {}): Room => ({ version: 2, ...shell, builtIns: [], items: [], ...over });
const described = (over: Partial<RoomDescription> = {}): RoomDescription => ({ ...shell, builtIns: [], items: [], ...over });
const item = (over: Partial<RoomDescription["items"][number]>) => ({ type: "bookshelf" as const, description: "oak bookshelf", wall: null, along: 0, out: 0, rotation: 0, color: "#c9a77c", ...over });
const builtIn = (over: Partial<RoomDescription["builtIns"][number]>) => ({
  kind: "base_run" as const, wall: "back" as const, along: 2, out: 0, rotation: 0, length: 1.2, depth: 0.6, height: 0.9, body: "white_laminate" as const, top: "quartz_white" as const, ...over,
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
