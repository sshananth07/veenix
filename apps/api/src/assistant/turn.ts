import { extname } from "node:path";
import { Logger } from "@nestjs/common";
import { Types } from "mongoose";
import type OpenAI from "openai";
import { CONTENT_TYPES, type Role } from "@veenix/shared";
import { runAsMember } from "../auth/member-ctx";
import { ctx } from "../common/context";
import { tx } from "../common/tx";
import { env } from "../config/env";
import { enqueue, registerJob } from "../jobs/jobs";
import { changed } from "../live/live";
import { ProjectModel } from "../projects/project.model";
import { getObject } from "../storage/storage";
import { UserModel } from "../users/user.model";
import { createMessage } from "./llm";
import { addSpend, costMicros, HISTORY_EXCHANGES, MAX_LOOP_TURNS, MAX_OUTPUT_TOKENS, MAX_TOOL_CALLS, overSpendCap } from "./limits";
import { AssistantConversationModel, AssistantMessageModel, AssistantToolCallModel } from "./models";
import { SYSTEM_PROMPT } from "./prompt";
import { executeTool, getTool, toolsFor, type ToolContext } from "./tools";

type Attachment = ToolContext["attachments"][number];
type Conversation = { _id: Types.ObjectId; userId: Types.ObjectId; channel: string };
type Reply = { text: string; messageId: Types.ObjectId };
type Msg = { _id: Types.ObjectId; role: string; text: string; items: unknown[]; attachments: Attachment[]; transcript?: string | null; sourceEventId?: string | null; stop?: string | null };

const log = new Logger("Assistant");
const sinks = new Map<string, (conversation: Conversation, reply: Reply) => Promise<void>>();
const workingSignals = new Map<string, (conversation: Conversation, userMessage: Msg) => Promise<void>>();

/** Where finished replies go: the app refetches; WhatsApp sends a message. The sink reads the turn's cards and changes by messageId. */
export function registerReplySink(channel: string, sink: (conversation: Conversation, reply: Reply) => Promise<void>) {
  sinks.set(channel, sink);
}

/** Called before each model request of a turn, e.g. to keep WhatsApp's typing indicator on. Failures are ignored. */
export function registerWorkingSignal(channel: string, signal: (conversation: Conversation, userMessage: Msg) => Promise<void>) {
  workingSignals.set(channel, signal);
}
registerReplySink("app", async (conversation) => changed({ kind: "assistant", userId: String(conversation.userId) }));

/** Server-written facts (an approval, an undo) the model gets in the next turn's context message. */
export async function addConversationNote(conversationId: Types.ObjectId, note: string) {
  await AssistantConversationModel.updateOne({ _id: conversationId }, { $push: { notes: note } });
}

/** Saves the user's message and queues the reply, in one transaction. One conversation's messages run in order. */
export async function startTurn(input: { conversationId: Types.ObjectId; text: string; attachments: Attachment[]; transcript?: string; sourceEventId?: string; lane?: string }) {
  return tx(async () => {
    const [m] = await AssistantMessageModel.create([{
      conversationId: input.conversationId, role: "user", text: input.text, attachments: input.attachments,
      transcript: input.transcript ?? null, sourceEventId: input.sourceEventId ?? null,
    }]);
    await AssistantMessageModel.updateOne({ _id: m._id }, { $set: { turnOf: m._id } });
    await AssistantConversationModel.updateOne({ _id: input.conversationId }, { $set: { lastMessageAt: new Date() } });
    const payload = { conversationId: String(input.conversationId), messageId: String(m._id), userId: String(ctx().userId) };
    await enqueue("assistant.turn", payload, new Date(), input.lane ?? `conv:${input.conversationId}`);
    return { messageId: m._id };
  });
}

type TurnJob = { conversationId: string; messageId: string; userId: string };

registerJob<TurnJob>(
  "assistant.turn",
  async (p) => {
    const r = await runAsMember(ctx().orgId, new Types.ObjectId(p.userId), () => runTurn(new Types.ObjectId(p.conversationId), new Types.ObjectId(p.messageId)));
    if (r === "not_a_member") log.warn(`Dropped a message from ${p.userId}: no longer a member`);
  },
  {
    retryDelayMs: (attempts) => [5_000, 20_000, 60_000][attempts - 1] ?? 60_000,
    maxAttempts: 4,
    onGiveUp: async (p) => {
      const conversation = await AssistantConversationModel.findById(p.conversationId).lean();
      if (conversation) await finish(conversation, new Types.ObjectId(p.messageId), "Sorry, that didn't go through. Please try again.");
    },
  },
);

/** Stores a reply the server wrote (a limit, a failure) as plain assistant text, and hands it to the channel. */
async function finish(conversation: Conversation, turnOf: Types.ObjectId, text: string, stored = false) {
  if (!stored) await AssistantMessageModel.create([{ conversationId: conversation._id, role: "assistant", text, turnOf, stop: "server" }]);
  await sinks.get(conversation.channel)?.(conversation, { text, messageId: turnOf });
}

const functionCalls = (items: unknown[]) => items.filter((i): i is OpenAI.Responses.ResponseFunctionToolCall => (i as { type?: string }).type === "function_call");

async function imageParts(attachments: Attachment[]): Promise<OpenAI.Responses.ResponseInputImage[]> {
  const photos = attachments.filter((a) => a.kind === "photo");
  return Promise.all(photos.map(async (a) => ({
    type: "input_image" as const, detail: "low" as const,
    image_url: `data:${CONTENT_TYPES[extname(a.key).toLowerCase()]};base64,${(await getObject(a.key)).toString("base64")}`,
  })));
}

/** Stored messages → Responses API input. Model output is replayed exactly as returned; only this turn's photos are sent. */
async function toInput(messages: Msg[], current: Types.ObjectId): Promise<OpenAI.Responses.ResponseInputItem[]> {
  const input: OpenAI.Responses.ResponseInputItem[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      const said = [m.transcript ? `Heard: ${m.transcript}` : m.text, m.attachments.length && !m._id.equals(current) ? `[sent ${m.attachments.length} attachment(s)]` : ""].filter(Boolean).join("\n");
      const images = m._id.equals(current) ? await imageParts(m.attachments) : [];
      input.push({ role: "user", content: [{ type: "input_text", text: said || "(no text)" }, ...images] });
    } else if (m.role === "context") {
      input.push({ role: "developer", content: m.text });
    } else if (m.items.length) {
      input.push(...(m.items as OpenAI.Responses.ResponseInputItem[]));
    } else if (m.text) {
      input.push({ role: "assistant", content: m.text });
    }
  }
  return input;
}

async function contextText(conversation: { channel: string; projectId?: Types.ObjectId | null; notes: string[] }) {
  const c = ctx();
  const [user, project] = await Promise.all([
    UserModel.findById(c.userId).select("name").lean(),
    conversation.projectId ? ProjectModel.findById(conversation.projectId).select("name code").lean() : null,
  ]);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur", dateStyle: "full", timeStyle: "short" }).format(new Date());
  return [
    `Now: ${today} (Malaysia).`,
    `User: ${user?.name || "unknown"}, role ${c.role}.`,
    project ? `They opened the chat from project ${project.name} (${project.code}), id ${project._id}.` : "No current project.",
    // Per channel, so the cached system prompt stays the same for every chat.
    ...(conversation.channel === "whatsapp" ? ["They're on WhatsApp, where approval cards can't be filled in. Before proposing, ask for any price or payment terms the card would need, so it can be approved here."] : []),
    ...(conversation.notes.length ? ["Since the last message:", ...conversation.notes.map((n) => `- ${n}`)] : []),
  ].join("\n");
}

/** One user message: loop model responses and tool calls until the model answers. Safe to re-run after a crash. */
export async function runTurn(conversationId: Types.ObjectId, messageId: Types.ObjectId) {
  const c = ctx();
  const role = c.role as Role;
  const conversation = await AssistantConversationModel.findOne({ _id: conversationId, userId: c.userId }).lean();
  if (!conversation) return;

  let turn = (await AssistantMessageModel.find({ conversationId, turnOf: messageId }).sort({ _id: 1 }).lean()) as Msg[];
  if (turn.length === 1) {
    // The context message is stored, so later requests replay the same prefix.
    const [m] = await AssistantMessageModel.create([{ conversationId, role: "context", text: await contextText(conversation), turnOf: messageId }]);
    await AssistantConversationModel.updateOne({ _id: conversationId }, { $pull: { notes: { $in: conversation.notes } } });
    turn = [...turn, m.toObject() as Msg];
  }

  // History: the last few exchanges before this message, cut at a user message so tool calls keep their results.
  const earlier = await AssistantMessageModel.find({ conversationId, role: "user", _id: { $lt: messageId } }).sort({ _id: -1 }).limit(HISTORY_EXCHANGES).select("_id").lean();
  const from = earlier.at(-1)?._id ?? messageId;
  const history = (await AssistantMessageModel.find({ conversationId, _id: { $gte: from }, turnOf: { $ne: messageId } }).sort({ _id: 1 }).lean()) as Msg[];
  const attachments = turn[0].attachments;
  const toolCtx: ToolContext = { conversationId, messageId, attachments };

  for (;;) {
    const last = turn.at(-1)!;
    if (last.role === "assistant") {
      const calls = functionCalls(last.items);
      // Run nothing unless the response completed: a refusal or a cut-off response may hold half-formed calls.
      if (last.stop !== "completed" || calls.length === 0) {
        // Every call in history needs an output, or the next request is refused.
        if (calls.length) await AssistantMessageModel.create([{ conversationId, role: "tool", turnOf: messageId, items: calls.map((call) => ({ type: "function_call_output", call_id: call.call_id, output: "Not run." })) }]);
        const text = last.stop === "completed" || last.stop === "server" ? last.text : last.stop === "refusal" ? last.text || "I can't help with that." : "I couldn't finish that. Try asking in a simpler way.";
        return finish(conversation, messageId, text, last.stop === "completed" || last.stop === "server");
      }
      const used = await AssistantToolCallModel.countDocuments({ conversationId, messageId, toolUseId: { $nin: calls.map((x) => x.call_id) } });
      const results = used + calls.length > MAX_TOOL_CALLS
        ? calls.map(() => ({ content: "Not run: too many steps in one message.", isError: true }))
        : await runCalls(toolCtx, calls);
      const [m] = await AssistantMessageModel.create([{
        conversationId, role: "tool", turnOf: messageId,
        items: calls.map((call, i) => ({ type: "function_call_output", call_id: call.call_id, output: results[i].isError ? `Error: ${results[i].content}` : results[i].content })),
      }]);
      turn = [...turn, m.toObject() as Msg];
      if (used + calls.length > MAX_TOOL_CALLS) {
        log.warn(`Turn ${messageId} hit the tool call limit`);
        return finish(conversation, messageId, "That needed too many steps for one message. Please split it into smaller requests.");
      }
      continue;
    }

    if (turn.filter((m) => m.role === "assistant").length >= MAX_LOOP_TURNS) {
      log.warn(`Turn ${messageId} hit the loop limit`);
      return finish(conversation, messageId, "That needed too many steps for one message. Please split it into smaller requests.");
    }
    if (await overSpendCap(String(c.orgId))) {
      log.warn(`Org ${c.orgId} reached the daily assistant limit`);
      return finish(conversation, messageId, "The assistant has reached today's limit for your organisation. Try again tomorrow, or do this in Veenix.");
    }

    await workingSignals.get(conversation.channel)?.(conversation, turn[0]).catch((e) => log.warn(`Working signal failed: ${e instanceof Error ? e.message : e}`));
    const response = await createMessage({
      model: env.OPENAI_MODEL,
      instructions: SYSTEM_PROMPT,
      input: await toInput([...history, ...turn], messageId),
      tools: toolsFor(role),
      tool_choice: "auto",
      parallel_tool_calls: true,
      reasoning: { effort: "low" },
      store: false,
      include: ["reasoning.encrypted_content"],
      max_output_tokens: MAX_OUTPUT_TOKENS,
      prompt_cache_key: `assistant:${role}`,
    });
    if (response.usage) await addSpend(String(c.orgId), costMicros(response.usage));
    const refusal = response.output.some((o) => o.type === "message" && o.content.some((p) => p.type === "refusal"));
    const stop = refusal ? "refusal" : response.status === "completed" ? "completed" : `incomplete:${response.incomplete_details?.reason ?? response.status}`;
    // Saved before any tool runs, so a retry resumes here instead of asking again.
    const [m] = await AssistantMessageModel.create([{ conversationId, role: "assistant", turnOf: messageId, items: response.output, text: response.output_text ?? "", stop }]);
    turn = [...turn, m.toObject() as Msg];
  }
}

/** Reads run together; writes one at a time (projects use optimistic concurrency). Results keep the calls' order. */
async function runCalls(c: ToolContext, calls: OpenAI.Responses.ResponseFunctionToolCall[]) {
  const parse = (s: string) => { try { return JSON.parse(s) as unknown; } catch { return s; } };
  const results: { content: string; isError: boolean }[] = new Array(calls.length);
  const isRead = (name: string) => getTool(name)?.level === "read";
  await Promise.all(calls.map(async (call, i) => {
    if (isRead(call.name)) results[i] = await executeTool(c, { id: call.call_id, name: call.name, input: parse(call.arguments) });
  }));
  for (const [i, call] of calls.entries()) {
    if (!isRead(call.name)) results[i] = await executeTool(c, { id: call.call_id, name: call.name, input: parse(call.arguments) });
  }
  return results;
}
