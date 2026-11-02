import { Logger } from "@nestjs/common";
import { Types } from "mongoose";
import { z } from "zod";
import type OpenAI from "openai";
import { can, type Permission, type Role } from "@veenix/shared";
import { ctx } from "../common/context";
import { AppError } from "../common/errors";
import { tx } from "../common/tx";
import { AssistantToolCallModel } from "./models";

export type Level = "read" | "apply" | "approval" | "background";
export type ToolContext = { conversationId: Types.ObjectId; messageId: Types.ObjectId; attachments: { key: string; name: string; kind: "photo" | "audio" }[] };
export type ToolResult = { content: string; display?: object; undo?: object };

export interface ToolDef<I> {
  name: string;
  description: string;
  /** What the LLM fills in. Every field required (nullable instead of optional), so OpenAI's strict mode accepts it. */
  input: z.ZodType<I>;
  permission: Permission | null; // null = any member
  level: Level;
  deferred?: boolean; // found through tool search instead of always loaded
  run(input: I, c: ToolContext): Promise<ToolResult>;
  /** Required for level "apply". Refuses with "This has changed since. Open it in Veenix." when the record moved on. */
  undo?(data: object): Promise<void>;
}

const log = new Logger("AssistantTools");
const registry = new Map<string, ToolDef<any>>(); // eslint-disable-line @typescript-eslint/no-explicit-any
const schemas = new Map<string, Record<string, unknown>>();

/**
 * OpenAI strict mode accepts a subset of JSON Schema: every property required, no extra properties,
 * and no length keywords. Zod still checks lengths when the tool runs.
 */
export function strictSchema(input: z.ZodType): Record<string, unknown> {
  const strip = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(strip);
    if (!node || typeof node !== "object") return node;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      if (["$schema", "minLength", "maxLength", "default"].includes(k)) continue;
      if (k === "pattern" && "format" in node) continue;
      out[k] = strip(v);
    }
    if (out.type === "object") {
      const keys = Object.keys((out.properties as object) ?? {});
      const required = (out.required as string[]) ?? [];
      if (out.additionalProperties !== false || keys.some((key) => !required.includes(key))) {
        throw new Error(`Tool schemas need z.strictObject with every field required (use .nullable()): ${keys.join(", ")}`);
      }
    }
    return out;
  };
  return strip(z.toJSONSchema(input, { io: "input" })) as Record<string, unknown>;
}

export function defineTool<I>(def: ToolDef<I>) {
  if (registry.has(def.name)) throw new Error(`Tool ${def.name} is defined twice`);
  if (def.level === "apply" && !def.undo) throw new Error(`Tool ${def.name} applies changes, so it needs an undo`);
  schemas.set(def.name, strictSchema(def.input));
  registry.set(def.name, def);
}

export const allTools = () => [...registry.values()];
export const getTool = (name: string) => registry.get(name);

const allowed = (role: Role, t: ToolDef<unknown>) => t.permission === null || can(role, t.permission);

/** The tools offered to a role, in a stable order so the prompt cache holds. */
export function toolsFor(role: Role): OpenAI.Responses.Tool[] {
  const offered = allTools().filter((t) => allowed(role, t)).sort((a, b) => a.name.localeCompare(b.name));
  const tools: OpenAI.Responses.Tool[] = offered.map((t) => ({
    type: "function", name: t.name, description: t.description, parameters: schemas.get(t.name)!, strict: true,
    ...(t.deferred ? { defer_loading: true } : {}),
  }));
  if (offered.every((t) => t.deferred)) throw new Error("At least one tool must stay loaded");
  if (offered.some((t) => t.deferred)) tools.push({ type: "tool_search" });
  return tools;
}

/** Runs one tool call as the current member. A call already recorded (a retried job) returns its stored result. */
export async function executeTool(c: ToolContext, use: { id: string; name: string; input: unknown }): Promise<{ content: string; isError: boolean }> {
  const done = await AssistantToolCallModel.findOne({ conversationId: c.conversationId, toolUseId: use.id }).lean();
  if (done) return { content: done.result, isError: done.isError };

  const record = (r: ToolResult, isError: boolean) =>
    AssistantToolCallModel.create([{
      conversationId: c.conversationId, messageId: c.messageId, toolUseId: use.id, toolName: use.name, userId: ctx().userId,
      result: r.content, isError, display: r.display ?? null, undo: r.undo ?? null,
    }]).then(() => ({ content: r.content, isError }));

  const tool = registry.get(use.name);
  if (!tool) return record({ content: `There is no tool called ${use.name}.` }, true);
  const role = ctx().role;
  if (role === "system" || !allowed(role, tool)) return record({ content: "You don't have permission to do that." }, true);
  const parsed = tool.input.safeParse(use.input);
  if (!parsed.success) return record({ content: parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") }, true);

  try {
    // A write and its record commit together, so a retried job can't write twice.
    // Reads stay outside a transaction ($search can't run in one).
    if (tool.level === "read") return await record(await tool.run(parsed.data, c), false);
    return await tx(async () => record(await tool.run(parsed.data, c), false));
  } catch (e) {
    if (e instanceof AppError) return record({ content: e.message }, true);
    log.error(e instanceof Error ? e.stack : String(e));
    return record({ content: "That didn't work." }, true);
  }
}
