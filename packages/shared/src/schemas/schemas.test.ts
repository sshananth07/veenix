import { describe, expect, it } from "vitest";
import { leadInput, poTermsInput, termsInput, bomItemInput } from "./index";

describe("schemas", () => {
  it("turns blank optional text into null and rejects unknown keys", () => {
    const ok = leadInput.parse({ name: "Aisyah", phone: "012", campaign: "  " });
    expect(ok.campaign).toBeNull();
    expect(() => leadInput.parse({ name: "A", phone: "1", orgId: "x" })).toThrow();
  });
  it("keeps today's messages", () => {
    const r = leadInput.safeParse({ name: "", phone: "1" });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0].message).toBe("Lead name is required");
  });
  it("names the actual sum when terms do not total 100%", () => {
    const r = termsInput.safeParse({ terms: [{ name: "Deposit", trigger: "", pct: 30 }, { name: "Final", trigger: "", pct: 60 }] });
    expect(r.error!.issues[0].message).toBe("Payment terms add up to 90%. They must total 100%.");
    const po = poTermsInput.safeParse({ terms: [{ label: "All", pct: 100 }] });
    expect(po.success).toBe(true);
  });
  it("rejects fractional sen and operator injection", () => {
    expect(bomItemInput.safeParse({ workItemId: "a".repeat(24), workPackage: "Tiling", unit: "sq ft", qty: 1, unitCost: 12.5, performedBy: "SELF" }).success).toBe(false);
    expect(leadInput.safeParse({ name: { $ne: null }, phone: "1" }).success).toBe(false);
  });
});