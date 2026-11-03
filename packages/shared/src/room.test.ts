import { describe, expect, it } from "vitest";
import { FURNITURE, fitRoom, roomSchema, type Room } from "./room";

const room = (over: Partial<Room> = {}): Room => ({
  width: 4, length: 5, height: 2.8, wallColor: "#f4f1ea", floor: "light_oak", openings: [], items: [], ...over,
});

describe("fitRoom", () => {
  it("keeps every item inside the walls, rotation included", () => {
    const fitted = fitRoom(room({
      items: [
        { type: "sofa", x: 10, z: -10, rotation: 0, color: "#cccccc" }, // far outside, back-right corner
        { type: "sofa", x: -1.9, z: 0, rotation: 90, color: "#cccccc" }, // turned against the left wall
        { type: "rug", x: 0, z: 0, rotation: 0, color: "#cccccc" }, // already inside
      ],
    }));
    const { w, d } = FURNITURE.sofa;
    const [corner, turned, rug] = fitted.items;
    expect(corner.x).toBeCloseTo(2 - w / 2);
    expect(corner.z).toBeCloseTo(-2.5 + d / 2);
    expect(turned.x).toBeCloseTo(-2 + d / 2); // rotated 90°, so its depth runs along x
    expect(rug).toMatchObject({ x: 0, z: 0 });
  });

  it("centres an item wider than the room", () => {
    expect(FURNITURE.kitchen_counter.w).toBeGreaterThan(2);
    const [counter] = fitRoom(room({ width: 2, items: [{ type: "kitchen_counter", x: 3, z: 0, rotation: 0, color: "#ffffff" }] })).items;
    expect(counter.x).toBe(0);
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

describe("roomSchema", () => {
  it("refuses junk", () => {
    expect(roomSchema.safeParse(room({ wallColor: "red" })).success).toBe(false);
    expect(roomSchema.safeParse(room({ items: Array(41).fill({ type: "plant", x: 0, z: 0, rotation: 0, color: "#00ff00" }) })).success).toBe(false);
    expect(roomSchema.safeParse(room({ width: Number.NaN })).success).toBe(false);
    expect(roomSchema.safeParse(room()).success).toBe(true);
  });
});
