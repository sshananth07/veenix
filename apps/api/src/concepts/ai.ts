import OpenAI, { toFile } from "openai";
import { CONTENT_TYPES, roomDescriptionSchema } from "@veenix/shared";
import { ctx } from "../common/context";
import { env } from "../config/env";
import { createMessage } from "../assistant/llm";
import { addSpend, costMicros, imageCostMicros } from "../assistant/limits";
import { strictSchema } from "../assistant/tools";

// ponytail: OpenAI's image edit, chosen without a spike (same vendor as the assistant). Task 16.5 checks it on real photos.
// If it moves walls or windows, swap restyle() for a depth-guided interior model; nothing else changes.
const IMAGE_MODEL = "gpt-image-2";
// ponytail: the presentation render's model, owner's pick (2026-11-06); priced as gpt-image-2 until its price is published. ⚠ Verify.
const RENDER_MODEL = "gpt-image-2.6-sunburst";

const ROOM_PROMPT = `You turn room photos and a design brief into a 3D room plan.
The first photo is the room already redesigned: take the finishes, colours and furniture from it. Any further photos show the same room before the redesign, from other angles: use them for walls, doors and windows the first photo doesn't show.
Estimate the room's size in metres from the photos (Malaysian homes: bedrooms about 3-4 m, living rooms 4-6 m, ceilings about 2.8 m). Layout notes from the designer override your estimate.
The first photo faces the back wall; "front" is the wall behind the camera, "left" and "right" as seen in the photo.
Walls: give each wall a finish from the list and a colour (the colour tints paint, fabric panels and wallpaper). Match what the redesigned photo shows; walls it doesn't show suit the style.
Ceiling: lowered bands ("drops", with how deep they come in and how far below the ceiling), cove lighting, the number of downlights, and AC units or fans you can see.
Openings: windows and doors you can see; "at" is the opening's centre in metres from the wall's left end, seen from inside the room.
Built-ins: anything fixed or made to measure (kitchen and cabinet runs, wall cabinets, islands, bars, counters, shelving, banquettes, partitions, planter boxes), each with its length, depth, height, body finish and top.
Items: loose furniture only, each with a short description of what it really is ("curved boucle accent chair") and the nearest catalogue type.
Placing built-ins and items: against a wall, give the wall, "along" (the centre in metres from that wall's left end, seen from inside), "out" (the gap from the wall, usually 0) and a rotation relative to facing into the room (usually 0). Free-standing (islands, rugs, chairs in the middle): wall null, "along" and "out" are x and z from the room's centre (x left negative, z towards the camera positive), with rotation 0 facing the camera.
Keep doorways and walkways clear. Rotation is in degrees.`;

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
  if (r.usage) await addSpend(String(ctx().orgId), imageCostMicros(r.usage));
  const b64 = r.data?.[0]?.b64_json;
  if (!b64) throw new Error("The image edit returned no image");
  return Buffer.from(b64, "base64");
}

/** A photoreal dollhouse cut-away of the redesigned room, as WebP on a plain light grey background. Every photo is sent as bytes. */
export async function dollhouse(restyled: Buffer, originals: { photo: Buffer; ext: string }[], brief: string): Promise<Buffer> {
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set, so room concepts can't be made");
  client ??= new OpenAI({ apiKey: env.OPENAI_API_KEY, timeout: 180_000, maxRetries: 0 });
  const images = await Promise.all([{ photo: restyled, ext: ".jpg" }, ...originals].map((p, i) => toFile(p.photo, `room${i}${p.ext}`, { type: CONTENT_TYPES[p.ext] })));
  const r = await client.images.edit({
    model: RENDER_MODEL,
    image: images,
    prompt:
      `Turn this room into a 3D dollhouse cut-away view from a high three-quarter angle with the ceiling removed. Design: ${brief}. ` +
      "The first image is the redesigned room: keep its finishes, colours, furniture and lighting. The other images show the same room before; use them for walls the first image doesn't show. " +
      "Keep every wall, door, window and piece of furniture where the photos show them. Thick walls with clean dark cut tops, realistic textures, soft daylight, architectural visualisation quality, on a plain light grey studio background. Do not change the layout.",
    quality: "high",
    size: "auto",
    background: "opaque", // gpt-image-2 refused "transparent" (400) on 2026-11-06
    output_format: "webp",
  });
  if (r.usage) await addSpend(String(ctx().orgId), imageCostMicros(r.usage));
  const b64 = r.data?.[0]?.b64_json;
  if (!b64) throw new Error("The image edit returned no image");
  return Buffer.from(b64, "base64");
}

/** The model's room description from the restyled photo and the originals, unchecked: the caller parses it with roomDescriptionSchema and resolves it. */
export async function describeRoom(restyled: Buffer, originals: { photo: Buffer; ext: string }[], brief: string, layout: string | null): Promise<unknown> {
  const text = `Design brief: ${brief}${layout ? `\nLayout notes: ${layout}` : ""}`;
  const images = [{ photo: restyled, ext: ".jpg" }, ...originals].map((p) => ({ type: "input_image" as const, detail: "high" as const, image_url: dataUrl(p.photo, p.ext) }));
  const response = await createMessage({
    model: env.OPENAI_MODEL,
    instructions: ROOM_PROMPT,
    input: [{ role: "user", content: [{ type: "input_text", text }, ...images] }],
    text: { format: { type: "json_schema", name: "room", strict: true, schema: strictSchema(roomDescriptionSchema) } },
    reasoning: { effort: "low" },
    store: false,
    max_output_tokens: 8_000, // a full v2 room (40 items, 12 built-ins, each described) plus reasoning
  });
  if (response.usage) await addSpend(String(ctx().orgId), costMicros(response.usage));
  return JSON.parse(response.output_text);
}
