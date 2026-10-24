import { Schema, model } from "mongoose";
import { ROLES } from "@veenix/shared";

const membershipSchema = new Schema(
  {
    orgId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    role: { type: String, enum: ROLES, required: true },
    status: { type: String, enum: ["active", "removed"], default: "active" },
    invitedBy: { type: Schema.Types.ObjectId, default: null },
  },
  { collection: "memberships", timestamps: true },
);
membershipSchema.index({ orgId: 1, userId: 1 }, { unique: true });
membershipSchema.index({ userId: 1, status: 1 });
export const MembershipModel = model("Membership", membershipSchema);
