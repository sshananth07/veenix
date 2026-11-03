import { describe, expect, it } from "vitest";
import { safeReturnPath } from "./redirect";

const O = "https://app.veenix.my";

describe("safeReturnPath", () => {
  it("keeps a page on this site, with its query", () => {
    expect(safeReturnPath("/concepts/abc?x=1", O)).toBe("/concepts/abc?x=1");
  });
  it("refuses anything that leaves the site", () => {
    for (const bad of ["//evil.com", "/\\evil.com", "/\t/evil.com", "/\n/evil.com", "https://evil.com", "javascript:alert(1)", "", null]) {
      expect(safeReturnPath(bad, O)).toBe("/");
    }
  });
});
