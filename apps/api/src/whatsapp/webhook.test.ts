import { createHmac, randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ClsModule } from "nestjs-cls";
import { AccessGuard } from "../auth/access.guard";
import { ErrorFilter } from "../common/error.filter";
import { env } from "../config/env";
import { enqueue } from "../jobs/jobs";
import { JobModel } from "../jobs/job.model";
import { MembershipModel } from "../orgs/membership.model";
import { newId } from "../../test/ctx";
import { sendText } from "./client";
import { WhatsAppEventModel } from "./event.model";
import { WhatsAppLinkModel } from "./link.model";
import { WhatsAppController } from "./whatsapp.controller";
import { ingest, splitMessages } from "./webhook";

vi.mock("./client", async (importOriginal) => ({ ...(await importOriginal<typeof import("./client")>()), sendText: vi.fn().mockResolvedValue({}) }));
vi.mock("../jobs/jobs", async (importOriginal) => {
  const m = await importOriginal<typeof import("../jobs/jobs")>();
  return { ...m, enqueue: vi.fn(m.enqueue) };
});

const SECRET = "test-app-secret";
const org = newId(), alice = newId();
const phone = () => `601${randomInt(10_000_000, 99_999_999)}`;
const ALICE = phone();
const sign = (raw: string, secret = SECRET) => `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
const text = (from: string, body: string, id = `wamid.${randomUUID()}`) => ({ from, id, timestamp: "1730000000", type: "text", text: { body } });
const payload = (messages: object[], statuses: object[] = [], phoneNumberId = "PNID") => ({
  object: "whatsapp_business_account",
  entry: [{ id: "WABA", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { display_phone_number: "60300000000", phone_number_id: phoneNumberId }, messages, statuses } }] }],
});

let app: INestApplication;
beforeAll(async () => {
  Object.assign(env, { WHATSAPP_APP_SECRET: SECRET, WHATSAPP_VERIFY_TOKEN: "verify-me", WHATSAPP_ACCESS_TOKEN: "token", WHATSAPP_PHONE_NUMBER_ID: "PNID" });
  await MembershipModel.create({ orgId: org, userId: alice, role: "site_staff" });
  await WhatsAppLinkModel.create({ phone: ALICE, userId: alice, activeOrgId: org, verifiedAt: new Date() });
  const mod = await Test.createTestingModule({
    imports: [ClsModule.forRoot({ global: true, middleware: { mount: true } })],
    controllers: [WhatsAppController],
    providers: [{ provide: APP_GUARD, useClass: AccessGuard }, { provide: APP_FILTER, useClass: ErrorFilter }],
  }).compile();
  app = mod.createNestApplication({ rawBody: true });
  await app.init();
});
afterAll(() => app.close());

const post = (raw: string, signature = sign(raw)) => request(app.getHttpServer()).post("/webhooks/whatsapp").set("content-type", "application/json").set("x-hub-signature-256", signature).send(raw);

describe("WhatsApp webhook", () => {
  it("rejects a bad signature with 401 and saves nothing", async () => {
    const raw = JSON.stringify(payload([text(ALICE, "hello")]));
    await post(raw, sign(raw, "wrong-secret")).expect(401);
    await post(raw, "sha256=00").expect(401);
    await request(app.getHttpServer()).post("/webhooks/whatsapp").set("content-type", "application/json").send(raw).expect(401);
    expect(await WhatsAppEventModel.countDocuments()).toBe(0);
    expect(await JobModel.countDocuments()).toBe(0);
  });

  it("verifies against raw bytes, not re-serialized JSON", async () => {
    const raw = `{ "object" : "whatsapp_business_account",\n  "entry" : [] }`;
    await post(raw).expect(200);
    await post(raw, sign(JSON.stringify(JSON.parse(raw)))).expect(401);
  });

  it("answers the challenge only with the right verify token", async () => {
    const get = (token: string) => request(app.getHttpServer()).get("/webhooks/whatsapp").query({ "hub.mode": "subscribe", "hub.verify_token": token, "hub.challenge": "12345" });
    const ok = await get("verify-me").expect(200);
    expect(ok.text).toBe("12345");
    await get("guess").expect(403);
  });

  it("a duplicate delivery does nothing", async () => {
    const p = payload([text(ALICE, "tiling 60% done")]);
    await ingest(p);
    await ingest(p);
    expect(await JobModel.countDocuments()).toBe(1);
    expect(await WhatsAppEventModel.countDocuments()).toBe(1);
    expect((await JobModel.findOne().lean())).toMatchObject({ type: "whatsapp.inbound", lane: `wa:${ALICE}`, orgId: org });
  });

  it("splits a batch of two messages and ignores statuses", async () => {
    const p = payload(
      [text(ALICE, "first"), { from: ALICE, id: `wamid.${randomUUID()}`, timestamp: "1730000001", type: "audio", audio: { id: "MEDIA1", mime_type: "audio/ogg; codecs=opus", voice: true } }],
      [{ id: "wamid.out", status: "delivered", recipient_id: ALICE }],
    );
    expect(splitMessages(p)).toMatchObject([{ type: "text", text: "first" }, { type: "audio", mediaId: "MEDIA1", mimeType: "audio/ogg; codecs=opus" }]);
    const before = await JobModel.countDocuments();
    await ingest(p);
    expect(await JobModel.countDocuments()).toBe(before + 2);
    expect(splitMessages(payload([], [{ id: "x", status: "failed", errors: [{ code: 131047 }] }]))).toEqual([]);
  });

  it("an unlinked number gets one refusal a day and creates no records", async () => {
    const stranger = phone();
    const [events, jobs] = [await WhatsAppEventModel.countDocuments(), await JobModel.countDocuments()];
    vi.mocked(sendText).mockClear();
    await ingest(payload([text(stranger, "hi")]));
    await ingest(payload([text(stranger, "hello??")]));
    expect(vi.mocked(sendText).mock.calls.filter(([to]) => to === stranger)).toHaveLength(1);
    expect(await WhatsAppEventModel.countDocuments()).toBe(events);
    expect(await JobModel.countDocuments()).toBe(jobs);
  });

  it("event and job are saved together: a failed enqueue leaves no event", async () => {
    vi.mocked(enqueue).mockRejectedValueOnce(new Error("queue down"));
    const m = text(ALICE, "plumber delayed");
    await expect(ingest(payload([m]))).rejects.toThrow("queue down");
    expect(await WhatsAppEventModel.exists({ messageId: m.id })).toBeNull();
  });

  it("refuses a payload for another phone number ID", async () => {
    await expect(ingest(payload([text(ALICE, "hi")], [], "SOMEONE_ELSE"))).rejects.toThrow("Not this app's number");
  });

  it("returns 503 when WhatsApp isn't configured", async () => {
    env.WHATSAPP_APP_SECRET = undefined;
    try {
      await post("{}").expect(503);
      await request(app.getHttpServer()).get("/webhooks/whatsapp").expect(503);
    } finally {
      env.WHATSAPP_APP_SECRET = SECRET;
    }
  });
});
