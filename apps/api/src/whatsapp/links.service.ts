import { randomInt } from "node:crypto";
import { Types } from "mongoose";
import type { WhatsAppLinkDto } from "@veenix/shared";
import { ctx } from "../common/context";
import { AppError } from "../common/errors";
import { redis } from "../common/redis";
import { env } from "../config/env";
import { WhatsAppLinkModel } from "./link.model";
import { normalizePhone } from "./phone";

const CODE_TTL_S = 600;
const codeKey = (code: string) => `walink:${code}`;

/**
 * A 6-digit code for the signed-in member, sent from their phone as "LINK <code>".
 * Sign-in requires MFA, so a valid code proves an MFA-verified session asked for this link.
 */
export async function startLink(): Promise<{ code: string; waUrl: string }> {
  if (!env.WHATSAPP_NUMBER) throw new AppError("UNAVAILABLE", "WhatsApp isn't set up for Veenix yet.", 503);
  const { userId, orgId } = ctx();
  for (;;) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    if (await redis.set(codeKey(code), JSON.stringify({ userId, orgId }), "EX", CODE_TTL_S, "NX")) {
      return { code, waUrl: `https://wa.me/${env.WHATSAPP_NUMBER}?text=LINK%20${code}` };
    }
  }
}

/** Called by the webhook for "LINK <code>". Single use. False when the code is wrong or expired, or the number belongs to someone else. */
export async function confirmLink(rawPhone: string, code: string): Promise<boolean> {
  const phone = normalizePhone(rawPhone);
  const stored = phone && /^\d{6}$/.test(code) ? await redis.getdel(codeKey(code)) : null;
  if (!phone || !stored) return false;
  const { userId, orgId } = JSON.parse(stored) as { userId: string; orgId: string };
  const taken = await WhatsAppLinkModel.exists({ phone, userId: { $ne: userId } });
  if (taken) return false;
  await WhatsAppLinkModel.deleteMany({ userId, phone: { $ne: phone } }); // one phone per user: a new number replaces the old one
  try {
    await WhatsAppLinkModel.updateOne(
      { phone },
      { $set: { userId: new Types.ObjectId(userId), activeOrgId: new Types.ObjectId(orgId), verifiedAt: new Date() } },
      { upsert: true },
    );
  } catch (e) {
    if ((e as { code?: number }).code === 11000) return false; // another user linked this number at the same moment
    throw e;
  }
  return true;
}

export async function unlink() {
  await WhatsAppLinkModel.deleteOne({ userId: ctx().userId });
}

export async function myLink(): Promise<WhatsAppLinkDto> {
  const link = await WhatsAppLinkModel.findOne({ userId: ctx().userId }).lean();
  return { available: !!env.WHATSAPP_NUMBER, phone: link?.phone ?? null, verifiedAt: link?.verifiedAt ?? null };
}
