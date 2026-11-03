import { env } from "../config/env";

// ⚠ Graph API version: Meta's reference pages don't show one; check developers.facebook.com's changelog before launch.
const GRAPH = "https://graph.facebook.com/v23.0";
export const MAX_MEDIA_BYTES = 16 * 1024 * 1024;
const WINDOW_MS = 24 * 3_600_000;

/** A send or download Meta refused. Thrown out of a job, so the job retries. */
export class WhatsAppSendError extends Error {}
/** Media over MAX_MEDIA_BYTES; found from Meta's metadata, before downloading. */
export class MediaTooLargeError extends Error {}

/** All four Meta settings are needed; without them the webhook answers 503 and nothing is sent. */
export const whatsappConfigured = () => !!(env.WHATSAPP_APP_SECRET && env.WHATSAPP_VERIFY_TOKEN && env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID);

async function graph(url: string, body?: object): Promise<Response> {
  const res = await fetch(url.startsWith("https://") ? url : `${GRAPH}/${url}`, {
    method: body ? "POST" : "GET",
    headers: { authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new WhatsAppSendError(`WhatsApp ${res.status}: ${(await res.text()).slice(0, 500)}`);
  return res;
}

const messages = (body: object) => graph(`${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, { messaging_product: "whatsapp", ...body }).then((r) => r.json() as Promise<unknown>);
const send = (to: string, message: object) => messages({ recipient_type: "individual", to, ...message });

function checkButtonText(text: string) {
  if (!text || text.length > 20) throw new Error(`WhatsApp button text must be 1-20 characters: "${text}"`);
}

export function sendText(to: string, text: string) {
  return send(to, { type: "text", text: { body: text.slice(0, 4096), preview_url: false } });
}

/** Reply buttons: at most 3, titles at most 20 characters. A tap comes back as a button message carrying the id. */
export function sendButtons(to: string, text: string, buttons: { id: string; title: string }[]) {
  if (buttons.length < 1 || buttons.length > 3) throw new Error("WhatsApp allows 1-3 reply buttons");
  buttons.forEach((b) => checkButtonText(b.title));
  return send(to, {
    type: "interactive",
    interactive: { type: "button", body: { text: text.slice(0, 1024) }, action: { buttons: buttons.map((b) => ({ type: "reply", reply: b })) } },
  });
}

/** One link button, optionally under an image (Meta fetches it, so the URL must be public: presign it). */
export function sendCtaUrl(to: string, m: { body: string; buttonText: string; url: string; headerImageUrl?: string }) {
  checkButtonText(m.buttonText);
  return send(to, {
    type: "interactive",
    interactive: {
      type: "cta_url",
      ...(m.headerImageUrl ? { header: { type: "image", image: { link: m.headerImageUrl } } } : {}),
      body: { text: m.body.slice(0, 1024) },
      action: { name: "cta_url", parameters: { display_text: m.buttonText, url: m.url } },
    },
  });
}

/** The only kind of message allowed outside the 24-hour window; templates are approved by Meta in advance (plan 15). */
export function sendTemplate(to: string, name: string, language: string, components: object[] = []) {
  return send(to, { type: "template", template: { name, language: { code: language }, components } });
}

/** Marks the message read and shows "typing…" for up to 25 seconds or until the next reply. */
export function showTyping(messageId: string) {
  return messages({ status: "read", message_id: messageId, typing_indicator: { type: "text" } });
}

/** Downloads inbound media. Meta's URL is short-lived, so this runs in the job straight after the webhook. */
export async function getMedia(mediaId: string): Promise<{ bytes: Buffer; mimeType: string }> {
  const meta = (await (await graph(mediaId)).json()) as { url: string; mime_type: string; file_size?: number };
  if ((meta.file_size ?? 0) > MAX_MEDIA_BYTES) throw new MediaTooLargeError(`Media ${mediaId} is ${meta.file_size} bytes`);
  const bytes = Buffer.from(await (await graph(meta.url)).arrayBuffer());
  if (bytes.length > MAX_MEDIA_BYTES) throw new MediaTooLargeError(`Media ${mediaId} is ${bytes.length} bytes`);
  return { bytes, mimeType: meta.mime_type };
}

/** Free-form replies are allowed only within 24 hours of the person's last message. */
export function inWindow(link: { lastInboundAt?: Date | null }): boolean {
  return !!link.lastInboundAt && Date.now() - link.lastInboundAt.getTime() < WINDOW_MS;
}
