import { describe, expect, it } from "vitest";
import { Schema, Types, model } from "mongoose";
import { tenantPlugin, orgIdField, sen } from "./tenant.plugin";
import { asOrg, newId } from "../../test/ctx";

const thingSchema = new Schema({ orgId: orgIdField, projectId: { type: Schema.Types.ObjectId, required: true }, name: String, amount: sen() }, { collection: "test_things" });
thingSchema.plugin(tenantPlugin, { projectField: "projectId" });
const Thing = model("TestThing", thingSchema);

describe("tenantPlugin", () => {
  const orgA = newId(), orgB = newId(), p1 = newId(), p2 = newId();

  it("stamps orgId and hides other orgs' records from every read and write", async () => {
    const thing = await asOrg(orgA, async () => (await Thing.create([{ projectId: p1, name: "A", amount: 100 }]))[0]);
    expect(thing.orgId.equals(orgA)).toBe(true);

    await asOrg(orgB, async () => {
      expect(await Thing.findById(thing._id)).toBeNull();
      expect(await Thing.countDocuments()).toBe(0);
      expect(await Thing.aggregate([{ $match: {} }])).toEqual([]);
      expect((await Thing.updateOne({ _id: thing._id }, { name: "hacked" })).modifiedCount).toBe(0);
      expect((await Thing.deleteOne({ _id: thing._id })).deletedCount).toBe(0);
    });
    expect((await asOrg(orgA, () => Thing.findById(thing._id).lean()))!.name).toBe("A");
  });

  it("limits project-scoped users to their assigned projects", async () => {
    await asOrg(orgA, () => Thing.create([{ projectId: p2, name: "Other project" }]));
    const seen = await asOrg(orgA, () => Thing.find().lean(), { role: "project_manager", projectScope: [p1] });
    expect(seen.map((t) => t.name)).toEqual(["A"]);
    await expect(asOrg(orgA, () => Thing.create([{ projectId: p2, name: "x" }]), { role: "site_staff", projectScope: [p1] })).rejects.toThrow("not assigned");
  });

  it("refuses to query without a context", async () => {
    await expect(Thing.find().exec()).rejects.toThrow("No request context");
  });

  it("refuses fractional sen", async () => {
    await expect(asOrg(orgA, () => Thing.create([{ projectId: p1, amount: 10.5 }]))).rejects.toThrow("whole number of sen");
  });

  it("blocks bulk helpers that would skip the filter", async () => {
    await expect(asOrg(orgA, () => Thing.insertMany([{ projectId: p1 }]))).rejects.toThrow("not allowed");
  });
});
