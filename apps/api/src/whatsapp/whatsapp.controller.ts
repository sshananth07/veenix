import { Controller, Get, Header, HttpCode, Post, Query, Req } from "@nestjs/common";
import type { RawBodyRequest } from "@nestjs/common";
import type { Request } from "express";
import { Public } from "../common/decorators";
import { AppError, forbidden, unauthenticated } from "../common/errors";
import { env } from "../config/env";
import { whatsappConfigured } from "./client";
import { ingest, verifySignature } from "./webhook";

const notConfigured = () => new AppError("UNAVAILABLE", "WhatsApp isn't configured", 503);

// Meta calls these; the signature (POST) and verify token (GET) are the only credentials.
@Controller("webhooks/whatsapp")
export class WhatsAppController {
  @Public() @Get() @Header("content-type", "text/plain")
  challenge(@Query("hub.mode") mode?: string, @Query("hub.verify_token") token?: string, @Query("hub.challenge") challenge?: string) {
    if (!whatsappConfigured()) throw notConfigured();
    if (mode !== "subscribe" || token !== env.WHATSAPP_VERIFY_TOKEN || !challenge) throw forbidden("Wrong verify token");
    return challenge;
  }

  @Public() @Post() @HttpCode(200)
  async receive(@Req() req: RawBodyRequest<Request>) {
    if (!whatsappConfigured()) throw notConfigured();
    if (!verifySignature(req.rawBody, req.header("x-hub-signature-256"))) throw unauthenticated("BAD_SIGNATURE", "Bad signature");
    await ingest(req.body);
    return { ok: true };
  }
}
