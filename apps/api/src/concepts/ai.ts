import OpenAI, { toFile } from "openai";
import { CONTENT_TYPES, roomSchema } from "@veenix/shared";
import { ctx } from "../common/context";
import { env } from "../config/env";
import { createMessage } from "../assistant/llm";
import { addSpend, costMicros } from "../assistant/limits";
import { strictSchema } from "../assistant/tools";

// ponytail: OpenAI's image edit, chosen without a spike (same vendor as the assistant). Task 16.5 checks it on real photos.
// If it moves walls or windows, swap restyle() for a depth-guided interior model; nothing else changes.
const IMAGE_MODEL = "gpt-image-2";

const ROOM_PROMPT = `You turn room photos and a design brief into a simple 3D room plan.
The first photo is the room already redesigned: take the finishes, colours and furniture from it. Any further photos show the same room before the redesign, from other angles: use them for walls, doors and windows the first photo doesn't show.
Estimate the room's size in metres from the photos (Malaysian homes: bedrooms about 3-4 m, living rooms 4-6 m, ceilings about 2.8 m). Layout notes from the designer override your estimate.
The first photo faces the back wall. Coordinates: origin at the room's centre, x across the width (left negative), z along the length (back wall at z = -length/2, the camera's side positive).
Place the windows and doors you can see; "at" is the opening's centre in metres from the wall's left end, seen from inside the room.
Furnish it to the brief using only the catalogue types, with colours that suit the style. Keep walkways clear and put furniture against walls where it belongs.
Rotation is in degrees; 0 means the item's front faces the camera's side (+z).`;

let client: OpenAI | undefined;

const dataUrl = (photo: Buffer, ext: string) => `data:${CONTENT_TYPES[ext]};base64,${photo.toString("base64")}`;

/** The photo redesigned to the brief, as JPEG. The photo is sent as bytes, never as a link to our storage. */
export async function restyle(photo: Buffer, ext: string, brief: string): Promise<Buffer> {
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set, so room concepts can't be made");
  client ??= new OpenAI({ apiKey: env.OPENAI_API_KEY, timeout: 180_000, maxRetries: 0 });
  const r = await client.images.edit({
    model: IMAGE_MODEL,
    image: await toFile(photo, `room${ext}`, { type: CONTENT_TYPES[ext] }),
    prompt: `Redesign this room as: ${brief}. Keep the camera angle, walls, windows, doors, ceiling and proportions exactly. Change only furniture, finishes, colours and lighting. Photorealistic interior photograph.`,
    quality: "medium",
    size: "auto",
    output_format: "jpeg",
  });
  const b64 = r.data?.[0]?.b64_json;
  if (!b64) throw new Error("The image edit returned no image");
  return Buffer.from(b64, "base64");
}

/** The model's room description from the restyled photo and the originals, unchecked: the caller parses it with roomSchema and fits it. */
export async function describeRoom(restyled: Buffer, originals: { photo: Buffer; ext: string }[], brief: string, layout: string | null): Promise<unknown> {
  const text = `Design brief: ${brief}${layout ? `\nLayout notes: ${layout}` : ""}`;
  const images = [{ photo: restyled, ext: ".jpg" }, ...originals].map((p) => ({ type: "input_image" as const, detail: "high" as const, image_url: dataUrl(p.photo, p.ext) }));
  const response = await createMessage({
    model: env.OPENAI_MODEL,
    instructions: ROOM_PROMPT,
    input: [{ role: "user", content: [{ type: "input_text", text }, ...images] }],
    text: { format: { type: "json_schema", name: "room", strict: true, schema: strictSchema(roomSchema) } },
    reasoning: { effort: "low" },
    store: false,
    max_output_tokens: 4_000,
  });
  if (response.usage) await addSpend(String(ctx().orgId), costMicros(response.usage));
  return JSON.parse(response.output_text);
}
