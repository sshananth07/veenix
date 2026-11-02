import OpenAI from "openai";
import { env } from "../config/env";

let client: OpenAI | undefined;

/** The only file that talks to the LLM vendor. */
export async function createMessage(params: OpenAI.Responses.ResponseCreateParamsNonStreaming): Promise<OpenAI.Responses.Response> {
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set, so the assistant can't reply");
  client ??= new OpenAI({ apiKey: env.OPENAI_API_KEY, timeout: 60_000, maxRetries: 1 });
  return client.responses.create(params);
}
