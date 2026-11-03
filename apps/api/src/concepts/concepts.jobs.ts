import { extname } from "node:path";
import { Logger } from "@nestjs/common";
import { Types } from "mongoose";
import { fitRoom, roomSchema, type Room } from "@veenix/shared";
import { runAsMember } from "../auth/member-ctx";
import { ctx } from "../common/context";
import { registerJob } from "../jobs/jobs";
import { changed } from "../live/live";
import { getObject, newKey, putObject } from "../storage/storage";
import { addConversationNote } from "../assistant/turn";
import { describeRoom, restyle } from "./ai";
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

/** Restyles the photo, then describes the room. A stored image is never paid for again on a retry. */
export async function generateConcept(id: Types.ObjectId) {
  const c = await DesignConceptModel.findById(id).lean();
  if (!c || c.status !== "generating") return;
  const ext = extname(c.sourceKey).toLowerCase();
  const photo = await getObject(c.sourceKey);

  if (!c.imageKey) {
    const key = newKey("concepts", ".jpg");
    await putObject(key, await restyle(photo, ext, c.brief), "image/jpeg");
    await DesignConceptModel.updateOne({ _id: id }, { $set: { imageKey: key } });
  }

  // The image alone is a usable concept, so a bad room description isn't retried.
  let room: Room | null = null;
  try {
    room = fitRoom(roomSchema.parse(await describeRoom(photo, ext, c.brief)));
  } catch (e) {
    log.warn(`Concept ${id} has no 3D room: ${e instanceof Error ? e.message : e}`);
  }

  const done = await DesignConceptModel.findOneAndUpdate({ _id: id, status: "generating" }, { $set: { status: "ready", room } }, { new: true }).lean();
  if (done) await conceptFinished(done as DesignConcept);
}

/** Tells the chat: the app refetches, and the model sees a note with the next message. */
export async function conceptFinished(c: DesignConcept) {
  changed({ kind: "assistant", userId: String(c.createdBy) });
  const what = c.status === "ready" ? `is ready${c.room ? "" : " as a photo only (no 3D room)"}` : "didn't work";
  await addConversationNote(c.conversationId, `Room concept ${c._id} ("${c.name}") ${what}.`);
}
