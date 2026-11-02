import { Schema, model } from "mongoose";
import { orgIdField, tenantPlugin } from "../common/fields";

const { ObjectId, Mixed } = Schema.Types;

// No projectField on these: a WhatsApp conversation has no project, and the plugin's scope filter would hide it. Every query filters by userId.
const conversationSchema = new Schema(
  {
    orgId: orgIdField,
    userId: { type: ObjectId, required: true },
    channel: { type: String, enum: ["app", "whatsapp"], required: true },
    projectId: { type: ObjectId, default: null },
    notes: { type: [String], default: [] }, // server-written facts for the next turn's context (approvals and undos)
  },
  { collection: "assistant_conversations", timestamps: true },
);
conversationSchema.index({ orgId: 1, userId: 1, channel: 1, projectId: 1 }, { unique: true });
conversationSchema.plugin(tenantPlugin);
export const AssistantConversationModel = model("AssistantConversation", conversationSchema);

const attachmentSchema = new Schema({ key: { type: String, required: true }, name: { type: String, required: true }, kind: { type: String, enum: ["photo", "audio"], required: true } }, { _id: false });

/**
 * Append-only. `items` holds Responses API input or output items exactly as sent or returned
 * (reasoning items carry encrypted content that must be replayed unchanged).
 * role: "user" is what the person sent, "context" the server's context message, "assistant" one model response, "tool" the results for it.
 */
const messageSchema = new Schema(
  {
    orgId: orgIdField,
    conversationId: { type: ObjectId, required: true },
    role: { type: String, enum: ["user", "context", "assistant", "tool"], required: true },
    text: { type: String, default: "" }, // what the person typed, or the reply shown to them
    items: { type: [Mixed], default: [] },
    transcript: { type: String, default: null },
    attachments: { type: [attachmentSchema], default: [] },
    sourceEventId: { type: String, default: null },
    turnOf: { type: ObjectId, default: null }, // the user message this belongs to
  },
  { collection: "assistant_messages", timestamps: { createdAt: true, updatedAt: false } },
);
messageSchema.index({ orgId: 1, conversationId: 1, _id: -1 });
messageSchema.plugin(tenantPlugin);
export const AssistantMessageModel = model("AssistantMessage", messageSchema);

const toolCallSchema = new Schema(
  {
    orgId: orgIdField,
    conversationId: { type: ObjectId, required: true },
    messageId: { type: ObjectId, required: true }, // the user message whose turn made the call
    toolUseId: { type: String, required: true },
    toolName: { type: String, required: true },
    result: { type: String, required: true },
    isError: { type: Boolean, default: false },
    display: { type: Mixed, default: null },
    undo: { type: Mixed, default: null },
    undoneAt: { type: Date, default: null },
    userId: { type: ObjectId, default: null },
  },
  { collection: "assistant_tool_calls", timestamps: { createdAt: true, updatedAt: false } },
);
toolCallSchema.index({ orgId: 1, conversationId: 1, toolUseId: 1 }, { unique: true });
toolCallSchema.plugin(tenantPlugin);
export const AssistantToolCallModel = model("AssistantToolCall", toolCallSchema);
