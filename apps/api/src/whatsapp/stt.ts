import OpenAI, { toFile } from "openai";
import { env } from "../config/env";

// ponytail: OpenAI's transcription, chosen without Task 12.1's speech spike (same vendor as the assistant, no new dependency).
// The spike may pick another provider: replace this one function. OpenAI accepts OGG/Opus voice notes directly, so no FFmpeg.
const STT_MODEL = "gpt-transcribe";
// Names and amounts are where errors cost most; the prompt primes the vocabulary.
const PROMPT = "A Malaysian renovation contractor's site update, in English, Malay or Manglish. Amounts are in RM. Trades: tiling, plaster ceiling, wiring, plumbing, carpentry.";

let client: OpenAI | undefined;

export async function transcribe(audio: Buffer, mimeType: string): Promise<{ text: string }> {
  const apiKey = env.STT_API_KEY || env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("STT_API_KEY is not set, so voice notes can't be transcribed");
  client ??= new OpenAI({ apiKey, timeout: 60_000, maxRetries: 1 });
  const ext = mimeType.split(";")[0].split("/")[1] ?? "ogg";
  const r = await client.audio.transcriptions.create({ file: await toFile(audio, `voice.${ext}`, { type: mimeType }), model: STT_MODEL, prompt: PROMPT });
  return { text: r.text.trim() };
}
