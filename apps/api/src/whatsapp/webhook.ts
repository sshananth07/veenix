import { createHmac, timingSafeEqual } from "node:crypto";
import { Logger } from "@nestjs/common";
import { waitUntil } from "@vercel/functions";
import { runWithCtx, systemCtx } from "../common/context";
import { AppError } from "../common/errors";
import { rateLimit } from "../common/rate-limit";
import { redis } from "../common/redis";
import { tx } from "../common/tx";
import { env } from "../config/env";
import { enqueue } from "../jobs/jobs";
import { MembershipModel } from "../orgs/membership.model";
import { INBOUND_PER_MINUTE } from "../assistant/limits";
import { sendText } from "./client";
import { WhatsAppEventModel } from "./event.model";
import { WhatsAppLinkModel } from "./link.model";
import { confirmLink } from "./links.service";
import { normalizePhone } from "./phone";

export type InboundMessage = {
  id: string;
  from: string;
  timestamp: number;
  type: "text" | "audio" | "image" | "button";
  text?: string;
  mediaId?: string;
  mimeType?: string;
  buttonId?: string;
};

const log = new Logger("WhatsApp");
const DAY_S = 86_400;

/** Meta's X-Hub-Signature-256: HMAC-SHA256 of the raw request bytes with the app secret. */
export function verifySignature(rawBody: Buffer | undefined, header: string | undefined): boolean {
  if (!env.WHATSAPP_APP_SECRET || !rawBody || !header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", env.WHATSAPP_APP_SECRET).update(rawBody).digest();
  const given = Buffer.from(header.slice(7), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

type Value = { metadata?: { phone_number_id?: string }; messages?: Record<string, any>[]; statuses?: Record<string, any>[] }; // eslint-disable-line @typescript-eslint/no-explicit-any

function values(payload: unknown): Value[] {
  const entries = (payload as { entry?: { changes?: { field?: string; value?: Value }[] }[] })?.entry ?? [];
  return entries.flatMap((e) => e.changes ?? []).filter((c) => c.field === "messages" && c.value).map((c) => c.value!);
}

/** One inbound message per item; statuses and unsupported types are dropped. */
export function splitMessages(payload: unknown): InboundMessage[] {
  const out: InboundMessage[] = [];
  for (const m of values(payload).flatMap((v) => v.messages ?? [])) {
    const base = { id: String(m.id), from: String(m.from), timestamp: Number(m.timestamp) };
    if (m.type === "text") out.push({ ...base, type: "text", text: m.text?.body ?? "" });
    else if (m.type === "audio") out.push({ ...base, type: "audio", mediaId: m.audio?.id, mimeType: m.audio?.mime_type });
    else if (m.type === "image") out.push({ ...base, type: "image", mediaId: m.image?.id, mimeType: m.image?.mime_type, text: m.image?.caption });
    else if (m.type === "interactive" && m.interactive?.type === "button_reply") out.push({ ...base, type: "button", buttonId: m.interactive.button_reply?.id });
    else if (m.type === "button") out.push({ ...base, type: "button", buttonId: m.button?.payload }); // a template's quick reply
  }
  return out;
}

/** Sends without holding up the 200; failures are only logged. */
function sendLater(to: string, text: string) {
  const work = sendText(to, text).catch((e) => log.warn(`Reply to ${to} failed: ${e instanceof Error ? e.message : e}`));
  try {
    waitUntil(work);
  } catch {
    // not running on Vercel; the promise still runs
  }
}

/**
 * Saves each message from a linked number with its job, in one transaction, before the webhook answers.
 * No LLM or media work happens here. A duplicate delivery hits the unique message ID and does nothing.
 */
export async function ingest(payload: unknown): Promise<void> {
  const vals = values(payload);
  if (vals.some((v) => v.metadata?.phone_number_id !== env.WHATSAPP_PHONE_NUMBER_ID)) throw new AppError("FORBIDDEN", "Not this app's number", 403);
  for (const s of vals.flatMap((v) => v.statuses ?? [])) {
    if (s.status === "failed") log.warn(`Send ${s.id} to ${s.recipient_id} failed: ${JSON.stringify(s.errors ?? []).slice(0, 500)}`);
  }

  for (const m of splitMessages(payload)) {
    const phone = normalizePhone(m.from);
    if (!phone) continue;
    try {
      await rateLimit(`wa:${phone}`, INBOUND_PER_MINUTE);
    } catch {
      log.warn(`Dropped message ${m.id} from ${phone}: over ${INBOUND_PER_MINUTE} a minute`);
      continue;
    }

    const linkCode = m.type === "text" ? /^\s*link\s+(\d{6})\s*$/i.exec(m.text ?? "")?.[1] : undefined;
    if (linkCode) {
      if (!(await redis.set(`wa:seen:${m.id}`, "1", "EX", 7 * DAY_S, "NX"))) continue; // redelivered
      const linked = await confirmLink(phone, linkCode);
      sendLater(phone, linked
        ? "Linked. Send me site updates, voice notes and photos, and I'll act with your Veenix permissions."
        : "That code didn't work. It may have expired or been used, or this number is linked to someone else. Get a new one in Veenix under Settings, WhatsApp.");
      continue;
    }

    const link = await WhatsAppLinkModel.findOne({ phone }).lean();
    // With no organisation chosen, the job still needs one; the handler asks which (plan 14.4).
    const orgId = link ? (link.activeOrgId ?? (await MembershipModel.findOne({ userId: link.userId, status: "active" }).lean())?.orgId) : null;
    if (!link || !orgId) {
      if (await redis.set(`wa:refused:${phone}`, "1", "EX", DAY_S, "NX")) {
        sendLater(phone, "This number isn't linked to Veenix. To use the assistant, open Veenix, go to Settings, WhatsApp, and tap Link WhatsApp.");
      }
      continue;
    }

    try {
      await runWithCtx(systemCtx(orgId), () => tx(async () => {
        await WhatsAppEventModel.create([{ messageId: m.id, orgId, phone, payload: m }]);
        await enqueue("whatsapp.inbound", { messageId: m.id }, new Date(), `wa:${phone}`); // kicks the runner after commit
      }));
    } catch (e) {
      if ((e as { code?: number }).code !== 11000) throw e; // anything else: answer 500 so Meta redelivers
    }
  }
}
