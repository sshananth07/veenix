import { describe, expect, it } from "vitest";
import { quotationTotals } from "./quotation";

describe("quotationTotals", () => {
  it("totals cost, price, SST and margin in sen", () => {
    const t = quotationTotals([{ bomCost: 100000, clientPrice: 140000 }, { bomCost: 50000, clientPrice: 70000 }], 800);
    expect(t).toEqual({ cost: 150000, subtotal: 210000, sst: 16800, total: 226800, profit: 60000, marginPct: (60000 / 210000) * 100 });
  });
});