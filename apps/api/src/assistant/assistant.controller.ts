import { Controller, Get, Post, Query } from "@nestjs/common";
import { Types } from "mongoose";
import { z } from "zod";
import { assistantMessageInput, type AssistantConversationDto, type AssistantMessageDto, type AssistantMessageInput } from "@veenix/shared";
import { ctx } from "../common/context";
import { Can, RateLimit } from "../common/decorators";
import { OidParam, oid } from "../common/oid";
import { ZBody } from "../common/zod";
import { JobModel } from "../jobs/job.model";
import { loadProject } from "../projects/project.model";
import { claim, downloadUrl } from "../storage/storage";
import { INBOUND_PER_MINUTE } from "./limits";
import { AssistantConversationModel, AssistantMessageModel, AssistantToolCallModel, PendingActionModel } from "./models";
import { approve, reject, undoToolCall, type Card } from "./pending";
import { startTurn } from "./turn";

const DAY = 86_400_000;
const approveInput = z.strictObject({ edits: z.record(z.string(), z.unknown()).default({}) });

/** One in-app conversation per user and project. */
async function conversationFor(projectId: string | null, create: boolean) {
  const filter = { userId: ctx().userId, channel: "app", projectId: projectId ? new Types.ObjectId(projectId) : null };
  const found = await AssistantConversationModel.findOne(filter).lean();
  if (found || !create) return found;
  return (await AssistantConversationModel.create([filter]).catch(async (e) => {
    if (e?.code !== 11000) throw e;
    return [await AssistantConversationModel.findOne(filter).lean()]; // a second tab created it first
  }))[0]!;
}

export async function postMessage(input: AssistantMessageInput) {
  if (input.projectId) await loadProject(input.projectId); // 404 outside scope
  const conversation = await conversationFor(input.projectId, true);
  const attachments = [];
  for (const p of input.photos) {
    const c = await claim(p, "photos");
    attachments.push({ key: c.path, name: c.name, kind: "photo" as const });
  }
  await startTurn({ conversationId: conversation!._id, text: input.text, attachments });
  return { conversationId: String(conversation!._id) };
}

/** Built for display: never raw items, tool inputs or reasoning. */
export async function getConversation(projectId: string | null): Promise<AssistantConversationDto> {
  if (projectId) await loadProject(projectId);
  const conversation = await conversationFor(projectId, false);
  if (!conversation) return { id: null, messages: [], busy: false };
  const conversationId = conversation._id;
  const recent = await AssistantMessageModel.find({ conversationId, role: { $in: ["user", "assistant"] } }).sort({ _id: -1 }).limit(200).select("-items").lean();
  recent.reverse();
  const turnIds = recent.filter((m) => m.role === "user").map((m) => m._id);
  const [calls, actions, busy] = await Promise.all([
    AssistantToolCallModel.find({ conversationId, messageId: { $in: turnIds } }).sort({ _id: 1 }).lean(),
    PendingActionModel.find({ conversationId, messageId: { $in: turnIds } }).sort({ _id: 1 }).lean(),
    JobModel.exists({ orgId: ctx().orgId, lane: `conv:${conversationId}`, status: { $in: ["pending", "running"] } }),
  ]);

  const messages: AssistantMessageDto[] = [];
  const blank = { photos: [], cards: [], tables: [], changes: [], steps: [], seconds: null };
  for (const u of recent.filter((m) => m.role === "user")) {
    const photos = await Promise.all(u.attachments.filter((a) => a.kind === "photo").map(async (a) => ({ name: a.name, url: await downloadUrl(a.key, a.name) })));
    messages.push({ ...blank, id: String(u._id), role: "user", text: u.text, createdAt: u.createdAt, photos });
    const reply = recent.filter((m) => m.role === "assistant" && m.turnOf?.equals(u._id) && m.text).at(-1);
    if (!reply) continue;
    const turnCalls = calls.filter((c) => c.messageId.equals(u._id));
    messages.push({
      ...blank,
      id: String(reply._id), role: "assistant", text: reply.text, createdAt: reply.createdAt,
      seconds: Math.round((reply.createdAt.getTime() - u.createdAt.getTime()) / 1000),
      steps: turnCalls.map((c) => ({ name: c.toolName, isError: c.isError })),
      tables: turnCalls.flatMap((c) => ((c.display as { type?: string } | null)?.type === "table" ? [c.display as { columns: string[]; rows: string[][] }] : [])),
      changes: turnCalls.filter((c) => c.undo && !c.isError).map((c) => ({
        toolCallId: String(c._id), text: c.result, undone: !!c.undoneAt, undoable: !c.undoneAt && c.createdAt.getTime() > Date.now() - DAY,
      })),
      cards: actions.filter((a) => a.messageId.equals(u._id)).map((a) => {
        const card = a.card as Card;
        return {
          id: String(a._id), status: a.status, expired: a.expiresAt < new Date(), title: card.title,
          lines: card.lines, changes: card.changes, missing: card.missing, link: card.link ?? null,
        };
      }),
    });
  }
  return { id: String(conversationId), messages, busy: !!busy };
}

// Every route is open to any member; the permission of the action itself is checked inside.
@Controller("assistant")
export class AssistantController {
  @Can() @RateLimit(INBOUND_PER_MINUTE) @Post("messages") send(@ZBody(assistantMessageInput) b: AssistantMessageInput) { return postMessage(b); }
  @Can() @Get("conversation") conversation(@Query("projectId") projectId?: string) { return getConversation(projectId ? String(oid(projectId)) : null); }
  @Can() @Post("actions/:id/approve") approve(@OidParam("id") id: Types.ObjectId, @ZBody(approveInput) b: { edits: Record<string, unknown> }) { return approve(id, b.edits); }
  @Can() @Post("actions/:id/reject") reject(@OidParam("id") id: Types.ObjectId) { return reject(id); }
  @Can() @Post("tool-calls/:id/undo") undo(@OidParam("id") id: Types.ObjectId) { return undoToolCall(id); }
}
