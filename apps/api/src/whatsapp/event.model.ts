import { Schema, model } from "mongoose";

// Not under the tenant plugin: written by the webhook before any request context exists.
// ponytail: 30 days covers Meta's redelivery window (about a week) with room to debug; set per spec §10's PDPA review.
const eventSchema = new Schema(
  {
    messageId: { type: String, required: true, unique: true }, // WhatsApp's message ID; a redelivery hits this index and does nothing
    orgId: { type: Schema.Types.ObjectId, required: true },
    phone: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, required: true }, // the InboundMessage
    status: { type: String, enum: ["queued", "done"], default: "queued" },
  },
  { collection: "whatsapp_events", timestamps: { createdAt: true, updatedAt: false } },
);
eventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 86_400 });
export const WhatsAppEventModel = model("WhatsAppEvent", eventSchema);
