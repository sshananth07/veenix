import { Logger } from "@nestjs/common";
import { formatDate } from "@veenix/shared";
import { env } from "../config/env";
import { AssistantMessageModel, AssistantToolCallModel, PendingActionModel } from "../assistant/models";
import type { Card } from "../assistant/pending";
import { registerReplySink, registerWorkingSignal } from "../assistant/turn";
import { inWindow, sendButtons, sendCtaUrl, sendText, showTyping } from "./client";
import { WhatsAppLinkModel } from "./link.model";

const log = new Logger("WhatsApp");

export function cardText(card: Card) {
  return [
    `*${card.title}*`,
    ...card.lines.map((l) => `${l.label}: ${l.value}`),
    ...card.changes.map((c) => `${c.label}: ${c.before} → ${c.after}`),
    // Prefilled card fields, so they can be checked before Approve. Web-only fields (payment references) never go out.
    ...(card.inputs ?? []).filter((i) => i.value && !i.webOnly).map((i) => `${i.label}: ${i.kind === "money" ? `RM ${i.value}` : i.kind === "date" ? formatDate(i.value!) : i.value}`),
    ...(card.missing.length ? [`Missing: ${card.missing.join(", ")}. Fill these in Veenix.`] : []),
  ].join("\n");
}

/**
 * A finished turn: "Heard: …" first for voice notes, the reply with Undo buttons for what changed,
 * then each approval card with Approve and Reject (or "Open in Veenix" while it has missing fields).
 * Button taps come back through the webhook and are handled by server code, never the LLM.
 */
registerReplySink("whatsapp", async (conversation, reply) => {
  const link = await WhatsAppLinkModel.findOne({ userId: conversation.userId }).lean();
  if (!link) return; // unlinked since the message came in
  if (!inWindow(link)) return log.warn(`Reply to ${link.phone} dropped: outside the 24-hour window`);
  const to = link.phone;
  const [said, calls, actions] = await Promise.all([
    AssistantMessageModel.findById(reply.messageId).select("transcript").lean(),
    AssistantToolCallModel.find({ conversationId: conversation._id, messageId: reply.messageId, undo: { $ne: null }, isError: false, undoneAt: null }).sort({ _id: 1 }).lean(),
    PendingActionModel.find({ conversationId: conversation._id, messageId: reply.messageId, status: "pending" }).sort({ _id: 1 }).lean(),
  ]);

  const changes = calls.slice(0, 3);
  const text = [
    said?.transcript ? `Heard: "${said.transcript}"` : null,
    reply.text,
    changes.length > 1 ? `Changes:\n${changes.map((c, i) => `${i + 1}. ${c.result}`).join("\n")}` : null,
    calls.length > 3 ? "Undo the other changes in Veenix." : null,
  ].filter(Boolean).join("\n\n");
  if (changes.length) await sendButtons(to, text, changes.map((c, i) => ({ id: `undo:${c._id}`, title: changes.length === 1 ? "Undo" : `Undo ${i + 1}` })));
  else await sendText(to, text);

  for (const a of actions) {
    const card = a.card as Card;
    if (card.missing.length) await sendCtaUrl(to, { body: cardText(card), buttonText: "Open in Veenix", url: `${env.WEB_ORIGIN}${card.link ?? "/"}` });
    else await sendButtons(to, cardText(card), [{ id: `approve:${a._id}`, title: "Approve" }, { id: `reject:${a._id}`, title: "Reject" }]);
  }
});

// The indicator clears after 25 seconds, so each model request in a turn turns it on again.
registerWorkingSignal("whatsapp", async (_conversation, userMessage) => {
  if (userMessage.sourceEventId) await showTyping(userMessage.sourceEventId);
});
