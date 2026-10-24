import { describe, expect, it } from "vitest";
import { Types } from "mongoose";
import { OrgsService } from "./orgs.service";
import { MembershipModel } from "./membership.model";
import { runWithCtx, setUser } from "../common/context";
import { asOrg, newId } from "../../test/ctx";

const svc = new OrgsService();
const asUser = <T>(user: { id: ReturnType<typeof newId>; email: string }, fn: () => Promise<T>) =>
  runWithCtx(undefined as never, async () => { setUser({ ...user, name: "", platformRole: null }); return fn(); });

describe("OrgsService", () => {
  const owner = { id: newId(), email: "owner@x.my" };
  const admin = { id: newId(), email: "admin@x.my" };

  it("makes the creator the owner", async () => {
    const { orgId } = await asUser(owner, () => svc.create({ companyName: "Wawasan Interior" }));
    const m = await MembershipModel.findOne({ orgId, userId: owner.id }).lean();
    expect(m!.role).toBe("owner");
  });

  it("enforces invitation email and owner rules", async () => {
    const orgId = new Types.ObjectId((await asUser(owner, () => svc.create({ companyName: "Org 2" }))).orgId);
    const { link } = await asUser(owner, () => asOrg(orgId, () => svc.invite({ email: "admin@x.my", role: "admin" }), { userId: owner.id, role: "owner" }));
    const token = link!.split("/").pop()!;

    await expect(asUser({ id: newId(), email: "someone@else.my" }, () => svc.acceptInvitation(token))).rejects.toThrow("This invitation was sent to another email address");
    await asUser(admin, () => svc.acceptInvitation(token));

    const adminMembership = await MembershipModel.findOne({ orgId, userId: admin.id }).lean();
    const ownerMembership = await MembershipModel.findOne({ orgId, userId: owner.id }).lean();
    const asAdmin = <T>(fn: () => Promise<T>) => asUser(admin, () => asOrg(orgId, fn, { userId: admin.id, role: "admin" }));

    await expect(asAdmin(() => svc.changeRole(adminMembership!._id, "owner"))).rejects.toThrow("Only an owner can grant or remove the owner role");
    await expect(asUser(owner, () => asOrg(orgId, () => svc.changeRole(ownerMembership!._id, "admin"), { userId: owner.id, role: "owner" }))).rejects.toThrow("You can't change your own role");
    await expect(asAdmin(() => svc.remove(ownerMembership!._id))).rejects.toThrow("Only an owner can grant or remove the owner role");
  });
});
