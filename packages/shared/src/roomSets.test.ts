import { describe, expect, it } from "vitest";
import type { Room } from "./room";
import { bedSet, coveSides, diningChairs, workstationSeats } from "./roomSets";

describe("workstationSeats", () => {
  it("2.8 × 1.4 is back-to-back, two 1.4 m desks a side", () => {
    expect(workstationSeats(2.8, 1.4)).toEqual({ sides: 2, perSide: 2, deskWidth: 1.4 });
  });
  it("1.0 × 0.7 is one single desk", () => {
    expect(workstationSeats(1.0, 0.7)).toEqual({ sides: 1, perSide: 1, deskWidth: 1.0 });
  });
});

describe("diningChairs", () => {
  it("2.6 × 1.8 seats 2 a side and one at each end, all facing the table, inside the set", () => {
    const { table, chairs } = diningChairs(2.6, 1.8);
    expect(table[0]).toBeCloseTo(1.7);
    expect(table[1]).toBeCloseTo(0.9);
    expect(chairs).toHaveLength(6);
    for (const [x, z, rotation] of chairs) {
      const r = (rotation * Math.PI) / 180;
      expect(Math.sin(r) * -x + Math.cos(r) * -z).toBeGreaterThan(0); // its front (+z turned by rotation) points at the table
      expect(Math.abs(x)).toBeLessThanOrEqual(1.3 - 0.2 + 1e-9);
      expect(Math.abs(z)).toBeLessThanOrEqual(0.9 - 0.2 + 1e-9);
    }
  });
  it("a short table has no end chairs", () => {
    expect(diningChairs(2.0, 1.6).chairs).toHaveLength(2); // table 1.1 × 0.7: one a side
  });
});

describe("bedSet", () => {
  it("2.6 has side tables and a 1.6 bed; 2.0 is a 1.8 bed alone", () => {
    expect(bedSet(2.6)).toEqual({ bed: 1.6, sideTables: true });
    expect(bedSet(2.0)).toEqual({ bed: 1.8, sideTables: false });
  });
});

describe("coveSides", () => {
  const ceiling = (over: Partial<Room["ceiling"]>) => ({ ceiling: { color: "#ffffff", drops: [], cove: true, downlights: 0, units: [], ...over } });
  it("drops on back and left give those two; no drops gives all four; no cove gives none", () => {
    expect(coveSides(ceiling({ drops: [{ wall: "back", depth: 0.6, gap: 0.2 }, { wall: "left", depth: 0.6, gap: 0.2 }] }))).toEqual(["back", "left"]);
    expect(coveSides(ceiling({}))).toEqual(["back", "left", "right", "front"]);
    expect(coveSides(ceiling({ drops: [{ wall: "all", depth: 0.6, gap: 0.2 }] }))).toEqual(["back", "left", "right", "front"]);
    expect(coveSides(ceiling({ cove: false }))).toEqual([]);
  });
});
