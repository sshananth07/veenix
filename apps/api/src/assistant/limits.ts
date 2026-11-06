import type OpenAI from "openai";
import { redis } from "../common/redis";

export const MAX_LOOP_TURNS = 8; // model responses per message
export const MAX_TOOL_CALLS = 10; // per message
export const INBOUND_PER_MINUTE = 20; // per sender
export const MAX_OUTPUT_TOKENS = 2_000; // per response, reasoning included
export const HISTORY_EXCHANGES = 5; // earlier messages the model sees, counted in user messages
export const DAILY_SPEND_CAP_MICROS = 5_000_000; // US$5 per organisation per day
export const OVER_CAP = "Today's AI budget for this organisation is used up. Try again tomorrow.";

// ponytail: priced for gpt-6.1-sol (US$ per 1M tokens: 2 in, 0.10 cached, 2.50 cache write, 10 out). Update with OPENAI_MODEL.
export function costMicros(u: OpenAI.Responses.ResponseUsage): number {
  const cached = u.input_tokens_details?.cached_tokens ?? 0;
  const written = u.input_tokens_details?.cache_write_tokens ?? 0;
  return Math.ceil((u.input_tokens - cached - written) * 2 + cached * 0.1 + written * 2.5 + u.output_tokens * 10);
}

// ponytail: priced for gpt-image-2 from third-party listings (US$ per 1M tokens: 5 text in, 8 image in, 30 out). ⚠ Verify on OpenAI's pricing page; update with IMAGE_MODEL.
export function imageCostMicros(u: OpenAI.ImagesResponse.Usage): number {
  return Math.ceil(u.input_tokens_details.text_tokens * 5 + u.input_tokens_details.image_tokens * 8 + u.output_tokens * 30);
}

export const spendKey = (orgId: string) => `llm:spend:${orgId}:${new Date().toISOString().slice(0, 10)}`;

export async function addSpend(orgId: string, micros: number) {
  const key = spendKey(orgId);
  await redis.incrby(key, micros);
  await redis.expire(key, 2 * 86_400);
}

export async function overSpendCap(orgId: string) {
  return Number((await redis.get(spendKey(orgId))) ?? 0) >= DAILY_SPEND_CAP_MICROS;
}
