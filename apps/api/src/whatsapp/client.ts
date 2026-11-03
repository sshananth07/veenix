import { env } from "../config/env";

// ⚠ Graph API version: Meta's reference pages don't show one; check developers.facebook.com's changelog before launch.
const GRAPH = "https://graph.facebook.com/v23.0";

export class WhatsAppSendError extends Error {}

/** All four Meta settings are needed; without them the webhook answers 503 and nothing is sent. */
export const whatsappConfigured = () => !!(env.WHATSAPP_APP_SECRET && env.WHATSAPP_VERIFY_TOKEN && env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID);

async function graph(path: string, body: object) {
  const res = await fetch(`${GRAPH}/${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new WhatsAppSendError(`WhatsApp ${res.status}: ${(await res.text()).slice(0, 500)}`);
  return res.json() as Promise<unknown>;
}

const send = (to: string, message: object) => graph(`${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, { messaging_product: "whatsapp", recipient_type: "individual", to, ...message });

export function sendText(to: string, text: string) {
  return send(to, { type: "text", text: { body: text.slice(0, 4096), preview_url: false } });
}
