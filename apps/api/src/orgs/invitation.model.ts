import { Schema, model } from "mongoose";
import { ROLES } from "@veenix/shared";

const invitationSchema = new Schema(
  {
    orgId: { type: Schema.Types.ObjectId, required: true },
    email: { type: String, required: true, lowercase: true },
    role: { type: String, enum: ROLES, required: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    invitedBy: { type: Schema.Types.ObjectId, required: true },
    acceptedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
  },
  { collection: "invitations", timestamps: true },
);
invitationSchema.index({ orgId: 1, email: 1 });
export const InvitationModel = model("Invitation", invitationSchema);
