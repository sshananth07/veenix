import { extname } from "node:path";
import { Logger } from "@nestjs/common";
import { Types } from "mongoose";
import { fitRoom, roomSchema, type Room } from "@veenix/shared";
import { runAsMember } from "../auth/member-ctx";
import { ctx } from "../common/context";
import { registerJob } from "../jobs/jobs";
import { changed } from "../live/live";
import { env } from "../config/env";
import { downloadUrl, getObject, newKey, putObject } from "../storage/storage";
import { AssistantConversationModel } from "../assistant/models";
import { inWindow, sendCtaUrl, sendTemplate, sendText } from "../whatsapp/client";
import { WhatsAppLinkModel } from "../whatsapp/link.model";
import { addConversationNote } from "../assistant/turn";
import { describeRoom, dollhouse, restyle } from "./ai";
import { DesignConceptModel, type DesignConcept } from "./concept.model";

const log = new Logger("Concepts");
const FAILED = "The room concept didn't work. Please try again.";

type GenerateJob = { conceptId: string; userId: string };

registerJob<GenerateJob>(
  "concept.generate",
  async (p) => {
    const r = await runAsMember(ctx().orgId, new Types.ObjectId(p.userId), () => generateConcept(new Types.ObjectId(p.conceptId)));
    if (r === "not_a_member") log.warn(`Dropped concept ${p.conceptId}: ${p.userId} is no longer a member`);
  },
  {
    lockMs: 300_000, // the image edit alone can take a few minutes
    retryDelayMs: (attempts) => [30_000, 120_000][attempts - 1] ?? 120_000,
    maxAttempts: 3,
    onGiveUp: async (p) => {
      const c = await DesignConceptModel.findOneAndUpdate({ _id: p.conceptId, status: "generating" }, { $set: { status: "failed", error: FAILED } }, { new: true }).lean();
      if (c) await conceptFinished(c as DesignConcept);
    },
  },
);

registerJob<GenerateJob>(
  "concept.render",
  async (p) => {
    const r = await runAsMember(ctx().orgId, new Types.ObjectId(p.userId), () => renderConcept(new Types.ObjectId(p.conceptId)));
    if (r === "not_a_member") log.warn(`Dropped render ${p.conceptId}: ${p.userId} is no longer a member`);
  },
  {
    lockMs: 300_000, // a high-quality image with several inputs can take minutes
    retryDelayMs: (attempts) => [30_000, 120_000][attempts - 1] ?? 120_000,
    maxAttempts: 3,
    onGiveUp: async (p) => {
      const c = await DesignConceptModel.findOneAndUpdate({ _id: p.conceptId, renderStatus: "generating" }, { $set: { renderStatus: "failed" } }, { new: true }).lean();
      if (c) changed({ kind: "assistant", userId: String(c.createdBy) });
    },
  },
);

const photosOf = (c: Pick<DesignConcept, "sourceKey" | "extraKeys">) =>
  Promise.all([c.sourceKey, ...(c.extraKeys ?? [])].map(async (k) => ({ photo: await getObject(k), ext: extname(k).toLowerCase() })));

/** The on-demand presentation render. A stored render is never paid for again on a retry. */
export async function renderConcept(id: Types.ObjectId) {
  const c = await DesignConceptModel.findById(id).lean();
  if (!c || c.renderStatus !== "generating" || !c.imageKey) return;
  if (!c.renderKey) {
    const key = newKey("concepts", ".webp");
    await putObject(key, await dollhouse(await getObject(c.imageKey), await photosOf(c), c.brief), "image/webp");
    await DesignConceptModel.updateOne({ _id: id }, { $set: { renderKey: key } });
  }
  await DesignConceptModel.updateOne({ _id: id, renderStatus: "generating" }, { $set: { renderStatus: "ready" } });
  changed({ kind: "assistant", userId: String(c.createdBy) });
}

/** Restyles the photo, then describes the room. A stored image is never paid for again on a retry. */
export async function generateConcept(id: Types.ObjectId) {
  const c = await DesignConceptModel.findById(id).lean();
  if (!c || c.status !== "generating") return;
  const originals = await photosOf(c);

  let restyled: Buffer;
  if (c.imageKey) restyled = await getObject(c.imageKey);
  else {
    restyled = await restyle(originals[0].photo, originals[0].ext, c.brief);
    const key = newKey("concepts", ".jpg");
    await putObject(key, restyled, "image/jpeg");
    await DesignConceptModel.updateOne({ _id: id }, { $set: { imageKey: key } });
  }

  // The image alone is a usable concept, so a bad room description isn't retried.
  let room: Room | null = null;
  try {
    room = fitRoom(roomSchema.parse(await describeRoom(restyled, originals, c.brief, c.layout ?? null)));
  } catch (e) {
    log.warn(`Concept ${id} has no 3D room: ${e instanceof Error ? e.message : e}`);
  }

  const done = await DesignConceptModel.findOneAndUpdate({ _id: id, status: "generating" }, { $set: { status: "ready", room } }, { new: true }).lean();
  if (done) await conceptFinished(done as DesignConcept);
}

/** Tells the chat: the app refetches, WhatsApp gets a message, and the model sees a note with the next message. */
export async function conceptFinished(c: DesignConcept) {
  changed({ kind: "assistant", userId: String(c.createdBy) });
  const what = c.status === "ready" ? `is ready${c.room ? "" : " as a photo only (no 3D room)"}` : "didn't work";
  await addConversationNote(c.conversationId, `Room concept ${c._id} ("${c.name}") ${what}.`);
  const conversation = await AssistantConversationModel.findById(c.conversationId).select("channel").lean();
  // The concept is already saved: a failed send is logged, not retried.
  if (conversation?.channel === "whatsapp") await deliverConcept(c).catch((e) => log.warn(`Concept ${c._id} not sent on WhatsApp: ${e instanceof Error ? e.message : e}`));
}

/**
 * Inside the 24-hour window: the restyled image with a link button. Outside it: the concept_ready template.
 * The link carries only the concept id; opening it needs login and permission.
 */
export async function deliverConcept(c: DesignConcept) {
  const link = await WhatsAppLinkModel.findOne({ userId: c.createdBy }).lean();
  if (!link) return; // unlinked since
  if (c.status !== "ready" || !c.imageKey) {
    if (inWindow(link)) await sendText(link.phone, "Sorry, the room concept didn't work. Please try again.");
    return;
  }
  if (!inWindow(link)) {
    await sendTemplate(link.phone, "concept_ready", "en", [{ type: "body", parameters: [{ type: "text", text: c.name }] }]);
    return;
  }
  await sendCtaUrl(link.phone, {
    body: `${c.name}\nAI concept, not to scale.`,
    buttonText: c.room ? "Open 3D view" : "View concept",
    url: `${env.WEB_ORIGIN}/concepts/${c._id}`,
    // ponytail: Meta fetches the header image when it delivers; an hour covers a phone that's briefly offline. ⚠ Verify how long Meta needs.
    headerImageUrl: await downloadUrl(c.imageKey, `${c.name}.jpg`, true, 3_600),
  });
}
