import { Schema, model } from "mongoose";

const { ObjectId } = Schema.Types;

// Not under the tenant plugin: the webhook reads it before any organisation is known. One phone per user.
const linkSchema = new Schema(
  {
    phone: { type: String, required: true, unique: true }, // normalizePhone() form
    userId: { type: ObjectId, required: true, unique: true },
    activeOrgId: { type: ObjectId, default: null }, // which organisation messages act in; asked when null
    verifiedAt: { type: Date, required: true },
    lastInboundAt: { type: Date, default: null }, // opens WhatsApp's 24-hour reply window
    notify: { type: Boolean, default: true }, // proactive messages (plan 15)
  },
  { collection: "whatsapp_links", timestamps: true },
);
export const WhatsAppLinkModel = model("WhatsAppLink", linkSchema);
