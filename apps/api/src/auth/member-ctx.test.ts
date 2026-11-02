import { describe, expect, it } from "vitest";
import mongoose from "mongoose";
import { memberCtx, runAsMember } from "./member-ctx";
import { MembershipModel } from "../orgs/membership.model";
import { newId } from "../../test/ctx";

const org = newId(), staff = newId(), removed = newId(), assigned = newId();

describe("memberCtx", () => {
  it("a removed member gets null and runAsMember doesn't run", async () => {
    await MembershipModel.create({ orgId: org, userId: removed, role: "owner", status: "removed" });
    expect(await memberCtx(org, removed)).toBeNull();
    let ran = false;
    expect(await runAsMember(org, removed, async () => { ran = true; })).toBe("not_a_member");
    expect(ran).toBe(false);
  });

  it("site staff get only their assigned projects", async () => {
    await MembershipModel.create({ orgId: org, userId: staff, role: "site_staff" });
    await mongoose.connection.collection("projects").insertMany([
      { _id: assigned, orgId: org, assignees: [{ userId: staff, role: "site_staff" }] },
      { _id: newId(), orgId: org, assignees: [] },
    ]);
    expect((await memberCtx(org, staff))!.projectScope).toEqual([assigned]);
  });
});
