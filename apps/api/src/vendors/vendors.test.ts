import { describe, expect, it } from "vitest";
import { VendorsService } from "./vendors.service";
import { asOrg, newId } from "../../test/ctx";

const svc = new VendorsService();
const base = { type: "Electrical", registrationNo: null, contactPerson: null, phone: null, email: null, location: "Shah Alam", experienceYears: null, notes: null };

describe("VendorsService", () => {
  const org = newId();
  it("refuses a duplicate name regardless of case, per organization", async () => {
    await asOrg(org, () => svc.create({ name: "Seng Heng Elektrik", ...base }));
    await expect(asOrg(org, () => svc.create({ name: "seng heng elektrik", ...base }))).rejects.toThrow('"seng heng elektrik" is already in your vendor list');
    await asOrg(newId(), () => svc.create({ name: "Seng Heng Elektrik", ...base })); // another org is fine
  });
  it("lists with trade filters and the trade list", async () => {
    const r = await asOrg(org, () => svc.list({ q: "", trade: "elec" }));
    expect(r.vendors.map((v) => v.name)).toEqual(["Seng Heng Elektrik"]);
    expect(r.trades).toEqual(["Electrical"]);
  });
});
