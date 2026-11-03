import { Logger } from "@nestjs/common";
import { Types } from "mongoose";
import { runAsMember } from "../auth/member-ctx";
import { AppError } from "../common/errors";
import { tx } from "../common/tx";
import { registerJob } from "../jobs/jobs";
import { MembershipModel } from "../orgs/membership.model";
import { OrgModel } from "../orgs/org.model";
import { getObject, newKey, putObject } from "../storage/storage";
import { AssistantConversationModel, PendingActionModel } from "../assistant/models";
import { approve, reject, undoToolCall, type Card } from "../assistant/pending";
import { startTurn } from "../assistant/turn";
import { getMedia, MediaTooLargeError, sendButtons, sendText, showTyping } from "./client";
import { WhatsAppEventModel } from "./event.model";
import { WhatsAppLinkModel } from "./link.model";
import { transcribe } from "./stt";
import type { InboundMessage } from "./webhook";
import "./reply"; // registers the whatsapp reply sink

const log = new Logger("WhatsApp");
const PHOTO_WINDOW_MS = 15 * 60_000;
const EXT: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "audio/ogg": ".ogg", "audio/mpeg": ".mp3", "audio/mp4": ".m4a", "audio/aac": ".aac", "audio/amr": ".amr" };

type Event = { _id: Types.ObjectId; messageId: string; phone: string; payload: InboundMessage; mediaKey?: string | null; transcript?: string | null };
type Link = { userId: Types.ObjectId; phone: string; activeOrgId: Types.ObjectId | null };

const done = (messageId: string) => WhatsAppEventModel.updateOne({ messageId }, { $set: { status: "done" } });
/** A reply that ends the event's work: sent, then marked done, so a retry after the send doesn't repeat it. */
async function replyAndStop(e: Event, text: string) {
  await sendText(e.phone, text);
  await done(e.messageId);
}

/** Picks the organisation to act in. Returns null when the person has to choose first (and has been asked). */
async function activeOrg(e: Event, link: Link): Promise<Types.ObjectId | null> {
  const chosen = e.payload.type === "button" ? /^org:([a-f\d]{24})$/.exec(e.payload.buttonId ?? "")?.[1] : undefined;
  const memberships = await MembershipModel.find({ userId: link.userId, status: "active" }).sort({ _id: 1 }).lean();
  if (chosen) {
    const m = memberships.find((x) => x.orgId.equals(chosen));
    if (!m) return replyAndStop(e, "You're not a member of that organisation.").then(() => null);
    await WhatsAppLinkModel.updateOne({ phone: link.phone }, { $set: { activeOrgId: m.orgId } });
    const org = await OrgModel.findById(m.orgId).select("companyName").lean();
    return replyAndStop(e, `Now working in ${org?.companyName ?? "that organisation"}. Send your message again.`).then(() => null);
  }
  if (link.activeOrgId) return link.activeOrgId;
  if (memberships.length === 0) return replyAndStop(e, "You're not a member of any organisation in Veenix.").then(() => null);
  if (memberships.length === 1) {
    await WhatsAppLinkModel.updateOne({ phone: link.phone }, { $set: { activeOrgId: memberships[0].orgId } });
    return memberships[0].orgId;
  }
  if (memberships.length > 3) {
    // ponytail: WhatsApp allows 3 buttons; past that, relinking from the right organisation sets it (confirmLink stores the org it started in).
    return replyAndStop(e, "You're in several organisations. Open Veenix in the one you want, go to Settings, WhatsApp, and link again.").then(() => null);
  }
  const orgs = await OrgModel.find({ _id: { $in: memberships.map((m) => m.orgId) } }).select("companyName").lean();
  await sendButtons(e.phone, "Which organisation is this for? Then send your message again.", orgs.map((o) => ({ id: `org:${o._id}`, title: o.companyName.slice(0, 20) })));
  await done(e.messageId);
  return null;
}

/** Approve, Reject and Undo taps. Server code only: the LLM never sees or triggers these. */
async function runButton(e: Event) {
  const [, verb, id] = /^(approve|reject|undo):([a-f\d]{24})$/.exec(e.payload.buttonId ?? "") ?? [];
  if (!verb) return replyAndStop(e, "That button is no longer valid.");
  const oid = new Types.ObjectId(id);
  try {
    if (verb === "undo") {
      await undoToolCall(oid);
      return replyAndStop(e, "Undone.");
    }
    if (verb === "approve") await approve(oid);
    else await reject(oid);
    const card = (await PendingActionModel.findById(oid).select("card").lean())?.card as Card | undefined;
    return replyAndStop(e, `${verb === "approve" ? "Done" : "Rejected"}: ${card?.title ?? "the action"}.`);
  } catch (err) {
    if (err instanceof AppError && err.status < 500) return replyAndStop(e, err.message);
    throw err;
  }
}

/** Downloads media once: the stored key on the event makes a retry reuse it. Null when it was too large (already answered). */
async function storeMedia(e: Event): Promise<string | null> {
  if (e.mediaKey) return e.mediaKey;
  const ext = EXT[(e.payload.mimeType ?? "").split(";")[0].trim()];
  if (!ext) return replyAndStop(e, e.payload.type === "image" ? "Please send photos as JPG or PNG." : "I can't play that kind of audio. Please send a voice note.").then(() => null);
  try {
    const { bytes, mimeType } = await getMedia(e.payload.mediaId!);
    const key = newKey("assistant", ext); // ponytail: raw audio should be deleted after 90 days (spec §10 PDPA review); no lifecycle rule yet
    await putObject(key, bytes, mimeType.split(";")[0]);
    await WhatsAppEventModel.updateOne({ _id: e._id }, { $set: { mediaKey: key } });
    return key;
  } catch (err) {
    if (err instanceof MediaTooLargeError) return replyAndStop(e, "That file is over 16 MB, so I can't take it. Try a shorter voice note or a smaller photo.").then(() => null);
    throw err;
  }
}

/** Photos sent without a caption in the last 15 minutes and not used yet: the next message is about them. */
const waitingPhotos = (phone: string, before: Types.ObjectId) =>
  WhatsAppEventModel.find({ phone, _id: { $lt: before }, "payload.type": "image", mediaKey: { $ne: null }, usedBy: null, createdAt: { $gte: new Date(Date.now() - PHOTO_WINDOW_MS) } }).sort({ _id: 1 }).lean();

async function handle(e: Event, link: Link) {
  await WhatsAppLinkModel.updateOne({ phone: link.phone }, { $set: { lastInboundAt: new Date() } });
  await showTyping(e.messageId).catch((err) => log.warn(`Typing indicator failed: ${err instanceof Error ? err.message : err}`));
  const m = e.payload;

  if (m.type === "button") return runButton(e);

  const attachments: { key: string; name: string; kind: "photo" | "audio" }[] = [];
  let transcript: string | undefined;
  if (m.type === "image") {
    const key = await storeMedia(e);
    if (!key) return;
    if (!m.text?.trim()) return; // kept for the next message; no reply
    attachments.push({ key, name: "WhatsApp photo", kind: "photo" });
  }
  if (m.type === "audio") {
    const key = await storeMedia(e);
    if (!key) return;
    attachments.push({ key, name: "Voice note", kind: "audio" });
    transcript = e.transcript ?? undefined;
    if (transcript === undefined) {
      transcript = (await transcribe(await getObject(key), m.mimeType ?? "audio/ogg")).text;
      await WhatsAppEventModel.updateOne({ _id: e._id }, { $set: { transcript } }); // paid once, even if the job retries
    }
    if (!transcript.replace(/[\s.…]/g, "")) return replyAndStop(e, "Sorry, I couldn't hear that. Please send the voice note again.");
  }

  const photos = await waitingPhotos(e.phone, e._id);
  for (const p of photos) attachments.unshift({ key: p.mediaKey!, name: "WhatsApp photo", kind: "photo" });
  const conversation =
    (await AssistantConversationModel.findOne({ userId: link.userId, channel: "whatsapp" }).lean()) ??
    (await AssistantConversationModel.create([{ userId: link.userId, channel: "whatsapp", title: "WhatsApp" }]))[0];

  // One transaction: the event is done exactly when its turn is queued, so a retried job never sends it to the LLM twice.
  await tx(async () => {
    await WhatsAppEventModel.updateMany({ _id: { $in: photos.map((p) => p._id) } }, { $set: { usedBy: e.messageId } });
    await done(e.messageId);
    await startTurn({ conversationId: conversation._id, text: transcript ?? m.text ?? "", attachments, transcript, sourceEventId: e.messageId, lane: `wa:${e.phone}` });
  });
}

registerJob<{ messageId: string }>(
  "whatsapp.inbound",
  async ({ messageId }) => {
    const e = (await WhatsAppEventModel.findOne({ messageId }).lean()) as (Event & { status: string }) | null;
    if (!e || e.status === "done") return;
    const link = (await WhatsAppLinkModel.findOne({ phone: e.phone }).lean()) as Link | null;
    if (!link) return replyAndStop(e, "This number isn't linked to Veenix any more. Link it again in Veenix under Settings, WhatsApp.");
    const orgId = await activeOrg(e, link);
    if (!orgId) return;
    const r = await runAsMember(orgId, link.userId, () => handle(e, link));
    if (r === "not_a_member") {
      await WhatsAppLinkModel.updateOne({ phone: link.phone }, { $set: { activeOrgId: null } });
      await replyAndStop(e, "You're no longer a member of that organisation. Send your message again to choose another.");
    }
  },
  {
    retryDelayMs: (attempts) => [5_000, 20_000, 60_000][attempts - 1] ?? 60_000,
    maxAttempts: 4,
    onGiveUp: async ({ messageId }) => {
      const e = await WhatsAppEventModel.findOne({ messageId }).lean();
      if (e) await sendText(e.phone, "Sorry, that didn't go through. Please try again.").catch(() => undefined);
    },
  },
);
