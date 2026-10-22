import { describe, expect, it } from "vitest";
import { allocate, lineTotal, parseRinggit, senToInput, splitSstInclusive, sstOn, withMarkup } from "./money";
import { formatCurrency, formatBudget } from "./format";

describe("parseRinggit", () => {
  it("reads ringgit text into sen", () => {
    expect(parseRinggit("1,234.50")).toBe(123450);
    expect(parseRinggit("RM 12")).toBe(1200);
    expect(parseRinggit("0.05")).toBe(5);
  });
  it("rejects blanks, negatives and fractions of a sen", () => {
    expect(parseRinggit("")).toBeNull();
    expect(parseRinggit("-5")).toBeNull();
    expect(parseRinggit("1.234")).toBeNull();
    expect(parseRinggit("abc")).toBeNull();
  });
});

describe("rounding", () => {
  it("rounds qty x price half-up on the exact decimal, not the float", () => {
    expect(lineTotal(0.145, 100)).toBe(15);
    expect(lineTotal(12.5, 345)).toBe(4313);
    expect(lineTotal(3, 1999)).toBe(5997);
  });
  it("applies markup", () => {
    expect(withMarkup(10000, 40)).toBe(14000);
    expect(withMarkup(333, 40)).toBe(466);
  });
  it("computes and splits SST", () => {
    expect(sstOn(100000, 800)).toBe(8000);
    expect(splitSstInclusive(108000, 800)).toEqual({ exSst: 100000, sst: 8000 });
    const s = splitSstInclusive(12345, 800);
    expect(s.exSst + s.sst).toBe(12345);
  });
  it("allocates so parts always sum to the total", () => {
    expect(allocate(100001, [{ pct: 30 }, { pct: 70 }])).toEqual([30000, 70001]);
    const parts = allocate(99999, [{ pct: 33 }, { pct: 33 }, { pct: 34 }]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(99999);
  });
});

describe("display", () => {
  it("formats sen as ringgit", () => {
    expect(formatCurrency(123450)).toBe("RM 1,234.50");
    expect(formatCurrency(120000)).toBe("RM 1,200");
    expect(senToInput(123450)).toBe("1234.50");
    expect(senToInput(120000)).toBe("1200");
    expect(senToInput(null)).toBe("");
  });
  it("formats budgets in sen", () => {
    expect(formatBudget(10_000_000, 20_000_000)).toBe("RM 100k – 200k");
    expect(formatBudget(null, null)).toBeNull();
  });
});
