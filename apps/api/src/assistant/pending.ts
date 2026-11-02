import { Types } from "mongoose";
import { z } from "zod";
import { can, type Permission, type Role } from "@veenix/shared";
import { ctx } from "../common/context";
import { forbidden, notFound, rule } from "../common/errors";
import { tx } from "../common/tx";
import { changed } from "../live/live";
import { AssistantToolCallModel, PendingActionModel } from "./models";
import { addConversationNote } from "./turn";
import { defineTool, getTool, type ToolContext, type ToolResult } from "./tools";

export type Card = {
  title: string;
  lines: { label: string; value: string }[];
  changes: { label: string; before: string; after: string }[];
  missing: string[];
  link?: string;
};

interface ApprovalAction<I> {
  name: string;
  description: string;
  input: z.ZodType<I>;
  permission: Permission;
  deferred?: boolean;
  /** Builds the card from current data. Runs at proposal and again at approval. */
  validate(input: I): Promise<Card>;
  /** Calls the existing service method. Runs only after the tap. */
  apply(input: I): Promise<object>;
}

const DAY = 86_400_000;
const actions = new Map<string, ApprovalAction<any>>(); // eslint-disable-line @typescript-eslint/no-explicit-any

/** The action catalogue: each entry becomes a deferred propose_<name> tool that only ever shows a card. */
export function defineApprovalAction<I>(a: ApprovalAction<I>) {
  actions.set(a.name, a);
  defineTool<I>({
    name: `propose_${a.name}`,
    description: `${a.description} Shows an approval card; nothing changes until the user approves it.`,
    input: a.input,
    permission: a.permission,
    level: "approval",
    deferred: a.deferred ?? true,
    run: (input, c) => propose(c, a.name, input),
  });
}

export async function propose(c: ToolContext, name: string, input: unknown): Promise<ToolResult> {
  const card = await actions.get(name)!.validate(input);
  const [p] = await PendingActionModel.create([{
    userId: ctx().userId, conversationId: c.conversationId, messageId: c.messageId, toolName: name, input, card, expiresAt: new Date(Date.now() + DAY),
  }]);
  const missing = card.missing.length ? ` The user must fill in: ${card.missing.join(", ")}.` : "";
  return { content: `Shown to the user for approval. Not applied.${missing}`, display: { type: "card", actionId: String(p._id) } };
}

const tell = (conversationId: Types.ObjectId, note: string) => {
  changed({ kind: "assistant", userId: String(ctx().userId) });
  return addConversationNote(conversationId, note);
};

/** Only a tap gets here (a button handled by normal server code); no tool can call it. */
export async function approve(actionId: Types.ObjectId, edits: Record<string, unknown> = {}): Promise<{ status: "applied"; result: object }> {
  return tx(async () => {
    const c = ctx();
    const p = await PendingActionModel.findById(actionId).lean();
    if (!p) throw notFound("Action");
    if (!p.userId.equals(c.userId!)) throw forbidden("Only the person who asked can approve this");
    if (p.status !== "pending") throw rule("This was already handled");
    if (p.expiresAt < new Date()) throw rule("This expired. Ask the assistant again.");
    const a = actions.get(p.toolName);
    if (!a) throw rule("This action is no longer available");
    if (!can(c.role as Role, a.permission)) throw forbidden();
    const parsed = a.input.safeParse({ ...(p.input as object), ...edits });
    if (!parsed.success) throw rule(parsed.error.issues[0]?.message ?? "Check the details");
    const card = await a.validate(parsed.data);
    if (card.missing.length) throw rule(`Fill in: ${card.missing.join(", ")}`);
    // Claimed first, so two taps can't both apply: the second transaction conflicts and then sees "applied".
    const claimed = await PendingActionModel.updateOne({ _id: actionId, status: "pending" }, { $set: { status: "applied", input: parsed.data, card } });
    if (claimed.modifiedCount === 0) throw rule("This was already handled");
    const result = await a.apply(parsed.data);
    await PendingActionModel.updateOne({ _id: actionId }, { $set: { result } });
    await tell(p.conversationId, `The user approved: ${card.title}.`);
    return { status: "applied" as const, result };
  });
}

export async function reject(actionId: Types.ObjectId) {
  await tx(async () => {
    const p = await PendingActionModel.findOneAndUpdate({ _id: actionId, userId: ctx().userId, status: "pending" }, { $set: { status: "rejected" } }).lean();
    if (!p) throw notFound("Action");
    await tell(p.conversationId, `The user rejected: ${(p.card as Card).title}.`);
  });
}

/** Reverses an applied tool call through its tool's undo, within 24 hours, once. */
export async function undoToolCall(toolCallId: Types.ObjectId) {
  await tx(async () => {
    const c = ctx();
    const call = await AssistantToolCallModel.findOne({ _id: toolCallId, userId: c.userId }).lean();
    if (!call?.undo) throw notFound("Change");
    if (call.undoneAt) throw rule("This was already undone");
    if (call.createdAt.getTime() < Date.now() - DAY) throw rule("Undo is only available for 24 hours. Open it in Veenix.");
    const tool = getTool(call.toolName);
    if (!tool?.undo) throw rule("This can't be undone here. Open it in Veenix.");
    if (tool.permission && !can(c.role as Role, tool.permission)) throw forbidden();
    const claimed = await AssistantToolCallModel.updateOne({ _id: toolCallId, undoneAt: null }, { $set: { undoneAt: new Date() } });
    if (claimed.modifiedCount === 0) throw rule("This was already undone");
    await tool.undo(call.undo as object);
    await tell(call.conversationId, `The user undid: ${call.result}`);
  });
}
