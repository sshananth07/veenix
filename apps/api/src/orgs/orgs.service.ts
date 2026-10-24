import { createHash, randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";
import type { InvitationDto, MeDto, MemberDto, OrgDto, Role } from "@veenix/shared";
import { ctx, currentUser } from "../common/context";
import { forbidden, notFound, rule } from "../common/errors";
import { tx } from "../common/tx";
import { audit } from "../audit/audit";
import { env } from "../config/env";
import { UserModel } from "../users/user.model";
import { OrgModel, type Org } from "./org.model";
import { MembershipModel } from "./membership.model";
import { InvitationModel } from "./invitation.model";

const INVITE_DAYS = 7;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function toOrgDto(o: Org): OrgDto {
  return {
    id: String(o._id), companyName: o.companyName, companyReg: o.companyReg, companyAddress: o.companyAddress,
    companyPhone: o.companyPhone, logoPath: o.logoPath ?? null, bankName: o.bankName, bankAccountName: o.bankAccountName,
    bankAccount: o.bankAccount, swiftCode: o.swiftCode ?? null, defaultMarkupPct: o.defaultMarkupPct,
    minMarkupPct: o.minMarkupPct, sstBps: o.sstBps,
  };
}

@Injectable()
export class OrgsService {
  async me(): Promise<MeDto> {
    const u = currentUser();
    const memberships = await MembershipModel.find({ userId: u.id, status: "active" }).lean();
    const orgs = await OrgModel.find({ _id: { $in: memberships.map((m) => m.orgId) }, status: "active" }).lean();
    return {
      user: { id: String(u.id), name: u.name, email: u.email, platformRole: u.platformRole },
      memberships: orgs.map((o) => ({ orgId: String(o._id), companyName: o.companyName, role: memberships.find((m) => m.orgId.equals(o._id))!.role as Role })),
    };
  }

  async create(input: { companyName: string }) {
    const u = currentUser();
    if (env.SIGNUP_MODE === "invite_only" && u.platformRole !== "superadmin") throw forbidden("New organizations are created by the platform administrator");
    const orgId = new Types.ObjectId();
    await OrgModel.create([{ _id: orgId, companyName: input.companyName, createdBy: u.id }]);
    await MembershipModel.create([{ orgId, userId: u.id, role: "owner" }]);
    return { orgId: String(orgId) };
  }

  async assertMember(orgId: Types.ObjectId, userId: Types.ObjectId) {
    const m = await MembershipModel.findOne({ orgId, userId, status: "active" }).lean();
    if (!m) throw forbidden("You are not a member of this organization");
    return m;
  }

  async members(): Promise<MemberDto[]> {
    const { orgId } = ctx();
    const ms = await MembershipModel.find({ orgId, status: "active" }).sort({ createdAt: 1 }).lean();
    const users = await UserModel.find({ _id: { $in: ms.map((m) => m.userId) } }).lean();
    return ms.map((m) => {
      const u = users.find((x) => x._id.equals(m.userId));
      return { id: String(m._id), userId: String(m.userId), name: u?.name ?? "", email: u?.email ?? "", role: m.role as Role, createdAt: m.createdAt };
    });
  }

  /** Owner rules: only owners touch the owner role, nobody edits themselves, the last owner stays. */
  private async guardChange(membershipId: Types.ObjectId, nextRole: Role | null) {
    const c = ctx();
    const target = await MembershipModel.findOne({ _id: membershipId, orgId: c.orgId, status: "active" }).lean();
    if (!target) throw notFound("Member");
    // Owner check first: an admin promoting themselves hears about the owner rule.
    if ((target.role === "owner" || nextRole === "owner") && c.role !== "owner") throw forbidden("Only an owner can grant or remove the owner role");
    if (target.userId.equals(c.userId!)) throw rule("You can't change your own role");
    if (target.role === "owner" && nextRole !== "owner") {
      const owners = await MembershipModel.countDocuments({ orgId: c.orgId, role: "owner", status: "active" });
      if (owners <= 1) throw rule("An organization needs at least one owner");
    }
    return target;
  }

  async changeRole(membershipId: Types.ObjectId, role: Role) {
    await tx(async () => {
      const target = await this.guardChange(membershipId, role);
      await MembershipModel.updateOne({ _id: target._id }, { $set: { role } });
      await audit("member.role_changed", "membership", target._id, { from: target.role, to: role });
    });
  }

  async remove(membershipId: Types.ObjectId) {
    await tx(async () => {
      const target = await this.guardChange(membershipId, null);
      await MembershipModel.updateOne({ _id: target._id }, { $set: { status: "removed" } });
      await audit("member.removed", "membership", target._id, { role: target.role });
    });
  }

  async invite(input: { email: string; role: Role }) {
    const c = ctx();
    if (input.role === "owner" && c.role !== "owner") throw forbidden("Only an owner can grant or remove the owner role");
    const token = randomBytes(32).toString("base64url");
    const [inv] = await InvitationModel.create([{
      orgId: c.orgId, email: input.email, role: input.role, tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000), invitedBy: c.userId,
    }]);
    const link = `${env.WEB_ORIGIN}/invite/${token}`;
    // The email itself is sent by a mail.send job (plan 05, Task 5.3).
    await this.onInvite?.(input.email, link);
    await audit("member.invited", "invitation", inv._id, { email: input.email, role: input.role });
    return { id: String(inv._id), link: env.NODE_ENV === "production" ? undefined : link };
  }

  /** Set by the mail module (plan 05) so this service doesn't depend on it. */
  onInvite?: (email: string, link: string) => Promise<void>;

  async invitations(): Promise<InvitationDto[]> {
    const { orgId } = ctx();
    const list = await InvitationModel.find({ orgId, acceptedAt: null, revokedAt: null, expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 }).lean();
    return list.map((i) => ({ id: String(i._id), email: i.email, role: i.role as Role, expiresAt: i.expiresAt, createdAt: i.createdAt }));
  }

  async revokeInvitation(id: Types.ObjectId) {
    const { orgId } = ctx();
    await InvitationModel.updateOne({ _id: id, orgId, acceptedAt: null }, { $set: { revokedAt: new Date() } });
  }

  async acceptInvitation(token: string) {
    const u = currentUser();
    const inv = await InvitationModel.findOne({ tokenHash: sha256(token), acceptedAt: null, revokedAt: null }).lean();
    if (!inv || inv.expiresAt < new Date()) throw rule("This invitation has expired or was already used");
    if (inv.email !== u.email.toLowerCase()) throw rule("This invitation was sent to another email address");
    await MembershipModel.updateOne(
      { orgId: inv.orgId, userId: u.id },
      { $set: { role: inv.role, status: "active", invitedBy: inv.invitedBy } },
      { upsert: true },
    );
    await InvitationModel.updateOne({ _id: inv._id }, { $set: { acceptedAt: new Date() } });
    return { orgId: String(inv.orgId) };
  }
}
