import { Controller, Delete, Get, Post, Query } from "@nestjs/common";
import { Types } from "mongoose";
import { z } from "zod";
import {
  assistantMessageInput, type AssistantConversationDto, type AssistantConversationListItemDto, type AssistantMessageDto, type AssistantMessageInput,
} from "@veenix/shared";
import { ctx } from "../common/context";
import { Can, RateLimit } from "../common/decorators";
import { notFound } from "../common/errors";
import { OidParam, oid } from "../common/oid";
import { contains } from "../common/regex";
import { afterCommit, tx } from "../common/tx";
import { ZBody } from "../common/zod";
import { JobModel } from "../jobs/job.model";
import { ProjectModel, loadProject } from "../projects/project.model";
import { claim, downloadUrl, removeObject } from "../storage/storage";
import { SiteUpdateModel } from "../updates/site-update.model";
import { INBOUND_PER_MINUTE } from "./limits";
import { AssistantConversationModel, AssistantMessageModel, AssistantToolCallModel, PendingActionModel } from "./models";
import { approve, reject, undoToolCall, type Card } from "./pending";
import { startTurn } from "./turn";
import { DesignConceptModel, type DesignConcept } from "../concepts/concept.model";
import { toDto as toConceptDto } from "../concepts/concepts.service";

const DAY = 86_400_000;
const approveInput = z.strictObject({ edits: z.record(z.string(), z.unknown()).default({}) });

/** The user's own in-app conversation, or 404. Nobody else's chats are reachable, owners included. */
async function ownConversation(id: Types.ObjectId) {
  const c = await AssistantConversationModel.findOne({ _id: id, userId: ctx().userId, channel: "app" }).lean();
  if (!c) throw notFound("Conversation");
  return c;
}

export async function postMessage(input: AssistantMessageInput) {
  const attachments = []; // checked first, so a bad upload doesn't leave an empty chat
  for (const p of input.photos) {
    const c = await claim(p, "photos");
    attachments.push({ key: c.path, name: c.name, kind: "photo" as const });
  }
  const conversation = input.conversationId
    ? await ownConversation(new Types.ObjectId(input.conversationId))
    : (await AssistantConversationModel.create([{
        userId: ctx().userId, channel: "app",
        projectId: input.projectId ? (await loadProject(input.projectId))._id : null, // 404 outside scope
        title: input.text.replace(/\s+/g, " ").slice(0, 80),
      }]))[0];
  await startTurn({ conversationId: conversation._id, text: input.text, attachments });
  return { conversationId: String(conversation._id) };
}

/** The user's chats, newest first. `q` matches the title or anything said in the chat; `projectId` limits to one project's chats. */
export async function listConversations(q?: string, projectId?: Types.ObjectId): Promise<AssistantConversationListItemDto[]> {
  const filter: Record<string, unknown> = { userId: ctx().userId, channel: "app" };
  if (projectId) filter.projectId = projectId;
  if (q?.trim()) {
    const said = await AssistantMessageModel.distinct("conversationId", { role: { $in: ["user", "assistant"] }, text: contains(q.trim()) });
    filter.$or = [{ title: contains(q.trim()) }, { _id: { $in: said } }];
  }
  // ponytail: regex search over message text scans this org's messages; move to the search index if chats grow large.
  const rows = await AssistantConversationModel.find(filter).sort({ lastMessageAt: -1 }).limit(50).lean();
  const projects = await ProjectModel.find({ _id: { $in: rows.map((r) => r.projectId).filter(Boolean) } }).select("name").lean();
  return rows.map((r) => ({
    id: String(r._id), title: r.title ?? "Untitled chat", lastMessageAt: r.lastMessageAt ?? r.createdAt,
    projectId: r.projectId ? String(r.projectId) : null,
    projectName: projects.find((p) => r.projectId?.equals(p._id))?.name ?? null,
  }));
}

/** Deletes a chat with its messages, tool records, cards and photos. Changes it made to projects stay (they're in the Updates tab and the audit log). */
export async function deleteConversation(id: Types.ObjectId) {
  await tx(async () => {
    const conversation = await ownConversation(id);
    const messages = await AssistantMessageModel.find({ conversationId: conversation._id }).select("attachments").lean();
    const keys = messages.flatMap((m) => m.attachments.map((a) => a.key));
    // A site update may have reused a chat photo; keep those.
    const kept = new Set((await SiteUpdateModel.find({ "photos.path": { $in: keys } }).select("photos.path").lean()).flatMap((u) => u.photos.map((p) => p.path)));
    await Promise.all([
      AssistantMessageModel.deleteMany({ conversationId: conversation._id }),
      AssistantToolCallModel.deleteMany({ conversationId: conversation._id }),
      PendingActionModel.deleteMany({ conversationId: conversation._id }),
    ]);
    await AssistantConversationModel.deleteOne({ _id: conversation._id });
    for (const key of keys) if (!kept.has(key)) afterCommit(() => removeObject(key));
  });
}

/** Built for display: never raw items, tool inputs or reasoning. */
export async function getConversation(id: Types.ObjectId): Promise<AssistantConversationDto> {
  const conversation = await ownConversation(id);
  const conversationId = conversation._id;
  const project = conversation.projectId ? await ProjectModel.findById(conversation.projectId).select("name").lean() : null;
  const recent = await AssistantMessageModel.find({ conversationId, role: { $in: ["user", "assistant"] } }).sort({ _id: -1 }).limit(200).select("-items").lean();
  recent.reverse();
  const turnIds = recent.filter((m) => m.role === "user").map((m) => m._id);
  const [calls, actions, busy] = await Promise.all([
    AssistantToolCallModel.find({ conversationId, messageId: { $in: turnIds } }).sort({ _id: 1 }).lean(),
    PendingActionModel.find({ conversationId, messageId: { $in: turnIds } }).sort({ _id: 1 }).lean(),
    JobModel.exists({ orgId: ctx().orgId, lane: `conv:${conversationId}`, status: { $in: ["pending", "running"] } }),
  ]);

  const conceptIds = calls.flatMap((c) => ((c.display as { type?: string } | null)?.type === "concept" ? [(c.display as { conceptId: string }).conceptId] : []));
  const concepts = await Promise.all((await DesignConceptModel.find({ _id: { $in: conceptIds } }).lean()).map((c) => toConceptDto(c as DesignConcept)));

  const messages: AssistantMessageDto[] = [];
  const blank = { photos: [], cards: [], tables: [], changes: [], steps: [], seconds: null, concepts: [] };
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
      concepts: concepts.filter((k) => turnCalls.some((c) => (c.display as { conceptId?: string } | null)?.conceptId === k.id)),
      changes: turnCalls.filter((c) => c.undo && !c.isError).map((c) => ({
        toolCallId: String(c._id), text: c.result, undone: !!c.undoneAt, undoable: !c.undoneAt && c.createdAt.getTime() > Date.now() - DAY,
      })),
      cards: actions.filter((a) => a.messageId.equals(u._id)).map((a) => {
        const card = a.card as Card;
        return {
          id: String(a._id), status: a.status, expired: a.expiresAt < new Date(), title: card.title,
          lines: card.lines, changes: card.changes, missing: card.missing, inputs: card.inputs ?? [], link: card.link ?? null,
        };
      }),
    });
  }
  return { id: String(conversationId), title: conversation.title ?? "Untitled chat", projectId: project ? String(project._id) : null, projectName: project?.name ?? null, messages, busy: !!busy };
}

// Every route is open to any member; the permission of the action itself is checked inside.
@Controller("assistant")
export class AssistantController {
  @Can() @RateLimit(INBOUND_PER_MINUTE) @Post("messages") send(@ZBody(assistantMessageInput) b: AssistantMessageInput) { return postMessage(b); }
  @Can() @Get("conversations") list(@Query("q") q?: string, @Query("projectId") projectId?: string) { return listConversations(q, projectId ? oid(projectId) : undefined); }
  @Can() @Get("conversations/:id") get(@OidParam("id") id: Types.ObjectId) { return getConversation(id); }
  @Can() @Delete("conversations/:id") remove(@OidParam("id") id: Types.ObjectId) { return deleteConversation(id); }
  @Can() @Post("actions/:id/approve") approve(@OidParam("id") id: Types.ObjectId, @ZBody(approveInput) b: { edits: Record<string, unknown> }) { return approve(id, b.edits); }
  @Can() @Post("actions/:id/reject") reject(@OidParam("id") id: Types.ObjectId) { return reject(id); }
  @Can() @Post("tool-calls/:id/undo") undo(@OidParam("id") id: Types.ObjectId) { return undoToolCall(id); }
}
