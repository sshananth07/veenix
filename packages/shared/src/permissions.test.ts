import { describe, expect, it } from "vitest";
import { can, isProjectScoped, PERMISSIONS, ROLES } from "./permissions";

describe("permission matrix", () => {
  it("gives owner and admin every permission", () => {
    for (const p of PERMISSIONS) {
      expect(can("owner", p)).toBe(true);
      expect(can("admin", p)).toBe(true);
    }
  });
  it("matches the spec for the restricted roles", () => {
    expect(can("sales", "lead:write")).toBe(true);
    expect(can("sales", "bom:write")).toBe(false);
    expect(can("project_manager", "quotation:send")).toBe(true);
    expect(can("project_manager", "lead:read")).toBe(false);
    expect(can("site_staff", "file:write")).toBe(true);
    expect(can("site_staff", "vendor:read")).toBe(false);
    expect(can("finance", "billing:mark_paid")).toBe(true);
    expect(can("procurement", "billing:write")).toBe(false);
  });
  it("scopes only project managers and site staff to assigned projects", () => {
    expect(ROLES.filter(isProjectScoped)).toEqual(["project_manager", "site_staff"]);
  });
});
