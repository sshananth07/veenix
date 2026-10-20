import { describe, expect, it } from "vitest";
import { mytStartOfDay, mytYear, toDateInput } from "./time";

describe("Malaysia time", () => {
  it("rolls the year at Malaysian midnight, not UTC midnight", () => {
    expect(mytYear(new Date("2026-12-31T16:30:00Z"))).toBe(2027);
    expect(mytYear(new Date("2026-12-31T15:30:00Z"))).toBe(2026);
  });
  it("finds the start of the Malaysian day", () => {
    expect(mytStartOfDay(new Date("2026-05-10T20:00:00Z")).toISOString()).toBe("2026-05-10T16:00:00.000Z");
  });
  it("gives the Malaysian date for date inputs", () => {
    expect(toDateInput(new Date("2026-05-10T20:00:00Z"))).toBe("2026-05-11");
  });
});