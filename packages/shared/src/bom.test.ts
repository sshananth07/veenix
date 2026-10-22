import { describe, expect, it } from "vitest";
import { bomCosts, calcBomTotal, quotationReadiness } from "./bom";
import type { BomItemDto, WorkItemDto } from "./dto";

const line = (over: Partial<BomItemDto>): BomItemDto => ({
  id: "b1", workItemId: "w1", seq: 1, workPackage: "Kitchen cabinets", description: null,
  qty: 1, unit: "lot", unitCost: 0, estTotal: 0, performedBy: "OUTSOURCED", materials: [], awarded: null, ...over,
});
const kitchen: WorkItemDto = { id: "w1", seq: 1, name: "Kitchen", description: null };

describe("calcBomTotal", () => {
  it("adds labour and materials in sen", () => {
    expect(calcBomTotal({ qty: 10, unitCost: 1250, materials: [{ qty: 2.5, unitCost: 333 }] })).toEqual({ base: 12500, materials: 833, total: 13333 });
  });
});

describe("bomCosts", () => {
  it("prices outsourced work from the awarded PO and self work from its estimate", () => {
    const costs = bomCosts([
      line({ id: "a", estTotal: 500000 }),
      line({ id: "b", estTotal: 500000, awarded: { poId: "p", amount: 450000 } }),
      line({ id: "c", performedBy: "SELF", estTotal: 120000 }),
    ]);
    expect(costs.a).toEqual({ cost: 500000, priced: false, source: "ESTIMATE" });
    expect(costs.b).toEqual({ cost: 450000, priced: true, source: "PO" });
    expect(costs.c).toEqual({ cost: 120000, priced: true, source: "SELF" });
  });
});

describe("quotationReadiness", () => {
  it("blocks on unpriced outsourced lines and empty work items", () => {
    const r = quotationReadiness([kitchen, { id: "w2", seq: 2, name: "Bathroom", description: null }], [line({ id: "a", estTotal: 1 })]);
    expect(r.ready).toBe(false);
    expect(r.blockers.map((b) => b.message)).toEqual([
      'Work item "Bathroom" has no BOM lines yet',
      '"Kitchen cabinets" is waiting for an accepted vendor quote',
    ]);
  });
  it("is ready when every line is priced", () => {
    const r = quotationReadiness([kitchen], [line({ awarded: { poId: "p", amount: 100 } })]);
    expect(r).toEqual({ ready: true, blockers: [], total: 1, priced: 1 });
  });
});
