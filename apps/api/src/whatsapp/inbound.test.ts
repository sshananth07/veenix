import { randomInt, randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Types } from "mongoose";
import { z } from "zod";
import "../assistant/tools.project";
import { createMessage } from "../assistant/llm";
import { AssistantConversationModel, AssistantMessageModel, AssistantToolCallModel, PendingActionModel } from "../assistant/models";
import { defineApprovalAction } from "../assistant/pending";
import { runWithCtx, systemCtx } from "../common/context";
import { tx } from "../common/tx";
import { env } from "../config/env";
import { enqueue, runDue } from "../jobs/jobs";
import { JobModel } from "../jobs/job.model";
import { MembershipModel } from "../orgs/membership.model";
import { OrgModel } from "../orgs/org.model";
import { ProjectModel } from "../projects/project.model";
import { ensureBucket, getObject } from "../storage/storage";
import { SiteUpdateModel } from "../updates/site-update.model";
import { asOrg, newId } from "../../test/ctx";
import { getMedia, MediaTooLargeError, sendButtons, sendText } from "./client";
import { WhatsAppEventModel } from "./event.model";
import { WhatsAppLinkModel } from "./link.model";
import { transcribe } from "./stt";
import { ingest } from "./webhook";
import "./inbound";

vi.mock("../assistant/llm", () => ({ createMessage: vi.fn() }));
vi.mock("./stt", () => ({ transcribe: vi.fn() }));
vi.mock("./client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./client")>()),
  sendText: vi.fn().mockResolvedValue({}),
  sendButtons: vi.fn().mockResolvedValue({}),
  sendCtaUrl: vi.fn().mockResolvedValue({}),
  showTyping: vi.fn().mockResolvedValue({}),
  getMedia: vi.fn(),
}));
const llm = vi.mocked(createMessage);

const org = newId(), org2 = newId(), alice = newId(), bob = newId(), carol = newId();
// Fresh numbers per run: the 20-a-minute sender limit lives in Redis and outlasts the test database.
const phone = () => `601${randomInt(10_000_000, 99_999_999)}`;
const ALICE = phone(), BOB = phone(), CAROL = phone();
let mine: Types.ObjectId, notMine: Types.ObjectId;

// An approval action site staff may propose, so taps can be tested without procurement data.
let applied = 0;
defineApprovalAction({
  name: "zz_wa_note",
  description: "test",
  input: z.strictObject({ note: z.string() }),
  permission: "update:write",
  validate: async ({ note }) => ({ title: `Note ${note}`, lines: [{ label: "Note", value: note }], changes: [], missing: [] }),
  apply: async () => ({ applied: ++applied }),
});

const usage = { input_tokens: 100, output_tokens: 10, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 110 };
const say = (text: string) => ({ type: "message", id: "msg", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] });
const call = (name: string, args: object) => { const id = randomUUID(); return { type: "function_call", call_id: id, name, arguments: JSON.stringify(args), id: `fc_${id}`, status: "completed" }; };
const resp = (output: object[]) =>
  ({ id: "r", status: "completed", output, output_text: output.flatMap((o) => ("content" in o ? (o.content as { text: string }[]).map((c) => c.text) : [])).join(""), usage }) as never;

const wamid = () => `wamid.${randomUUID()}`;
const text = (from: string, body: string) => ({ from, id: wamid(), timestamp: "1730000000", type: "text", text: { body } });
const voice = (from: string) => ({ from, id: wamid(), timestamp: "1730000000", type: "audio", audio: { id: `MEDIA-${randomUUID()}`, mime_type: "audio/ogg; codecs=opus", voice: true } });
const photo = (from: string, caption?: string) => ({ from, id: wamid(), timestamp: "1730000000", type: "image", image: { id: `MEDIA-${randomUUID()}`, mime_type: "image/jpeg", caption } });
const tap = (from: string, buttonId: string) => ({ from, id: wamid(), timestamp: "1730000000", type: "interactive", interactive: { type: "button_reply", button_reply: { id: buttonId, title: "x" } } });
const payload = (m: object) => ({ object: "whatsapp_business_account", entry: [{ id: "W", changes: [{ field: "messages", value: { metadata: { phone_number_id: "PNID" }, messages: [m] } }] }] });

async function deliver(m: object) {
  await ingest(payload(m));
  await runDue();
  await runDue();
}
const asAlice = <T>(fn: () => Promise<T>) => asOrg(org, fn, { userId: alice, role: "site_staff", projectScope: [mine] });
const asOwner = <T>(fn: () => Promise<T>, o = org) => asOrg(o, fn);
/** Texts and button messages to one phone, in the order they were sent. */
const sentTo = (phone: string) => {
  const all = [vi.mocked(sendText).mock, vi.mocked(sendButtons).mock].flatMap((m) => m.calls.map((c, i) => ({ to: c[0], text: c[1] as string, order: m.invocationCallOrder[i] })));
  return all.filter((s) => s.to === phone).sort((a, b) => a.order - b.order).map((s) => s.text);
};
const lastButtons = (phone: string) => vi.mocked(sendButtons).mock.calls.filter(([to]) => to === phone).at(-1)!;
const pendingOf = async (note: string) => (await asOwner(() => PendingActionModel.findOne({ "card.title": `Note ${note}` }).lean()))!;

beforeAll(async () => {
  Object.assign(env, { WHATSAPP_PHONE_NUMBER_ID: "PNID" });
  await ensureBucket();
  [mine, notMine] = (await asOwner(() => ProjectModel.create([
    { code: "TD", name: "Taman Desa", clientName: "A", assignees: [{ userId: alice, role: "site_staff" }] },
    { code: "BK", name: "Bangsar Kondo", clientName: "B" },
  ]))).map((p) => p._id);
  await OrgModel.create([{ _id: org, companyName: "Reno One", createdBy: bob }, { _id: org2, companyName: "Reno Two", createdBy: bob }]);
  await MembershipModel.create([
    { orgId: org, userId: alice, role: "site_staff" },
    { orgId: org, userId: carol, role: "site_staff" },
    { orgId: org, userId: bob, role: "owner" },
    { orgId: org2, userId: bob, role: "owner" },
  ]);
  await WhatsAppLinkModel.create([
    { phone: ALICE, userId: alice, activeOrgId: org, verifiedAt: new Date() },
    { phone: CAROL, userId: carol, activeOrgId: org, verifiedAt: new Date() },
    { phone: BOB, userId: bob, activeOrgId: null, verifiedAt: new Date() },
  ]);
});
beforeEach(() => {
  llm.mockReset();
  vi.mocked(sendText).mockClear();
  vi.mocked(sendButtons).mockClear();
  vi.mocked(getMedia).mockReset().mockImplementation(async () => ({ bytes: Buffer.from([0xff, 0xd8, 0xff, 1]), mimeType: "audio/ogg; codecs=opus" }));
  vi.mocked(transcribe).mockReset().mockResolvedValue({ text: "Taman Desa tiling 60% done" });
});

describe("WhatsApp inbound", () => {
  it("a voice note is transcribed and acts as the linked member, with their scope", async () => {
    llm.mockResolvedValueOnce(resp([
      call("add_project_update", { projectId: String(mine), kind: "progress", text: "Tiling 60% done", attachPhotos: false }),
      call("add_project_update", { projectId: String(notMine), kind: "progress", text: "sneaky", attachPhotos: false }),
    ])).mockResolvedValueOnce(resp([say("Added the update to Taman Desa.")]));
    await deliver(voice(ALICE));

    expect(transcribe).toHaveBeenCalledOnce();
    const updates = await asOwner(() => SiteUpdateModel.find().lean());
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ projectId: mine, authorId: alice });
    const calls = await asOwner(() => AssistantToolCallModel.find().sort({ _id: 1 }).lean());
    expect(calls.map((c) => c.isError)).toEqual([false, true]);
    const user = await asOwner(() => AssistantMessageModel.findOne({ role: "user" }).lean());
    expect(user).toMatchObject({ transcript: "Taman Desa tiling 60% done", attachments: [{ kind: "audio" }] });
  });

  it("the reply starts with what was heard", async () => {
    llm.mockResolvedValueOnce(resp([call("add_project_update", { projectId: String(mine), kind: "issue", text: "Plumber delayed", attachPhotos: false })]))
      .mockResolvedValueOnce(resp([say("Noted the delay.")]));
    vi.mocked(transcribe).mockResolvedValueOnce({ text: "plumber delayed till Thursday" });
    await deliver(voice(ALICE));
    const [, body, buttons] = lastButtons(ALICE);
    expect(body).toMatch(/^Heard: "plumber delayed till Thursday"\n\nNoted the delay\./);
    expect(buttons).toEqual([{ id: expect.stringMatching(/^undo:[a-f\d]{24}$/), title: "Undo" }]);
  });

  it("a photo then a voice note: the voice note's turn has the photo", async () => {
    vi.mocked(getMedia).mockResolvedValueOnce({ bytes: Buffer.from([0xff, 0xd8, 0xff, 2]), mimeType: "image/jpeg" });
    await deliver(photo(ALICE));
    expect(llm).not.toHaveBeenCalled();
    expect(sentTo(ALICE)).toEqual([]); // no reply to a photo without a caption

    llm.mockResolvedValueOnce(resp([say("Got the photo.")]));
    await deliver(voice(ALICE));
    const user = await asOwner(() => AssistantMessageModel.findOne({ role: "user" }).sort({ _id: -1 }).lean());
    expect(user!.attachments.map((a) => a.kind)).toEqual(["photo", "audio"]);
    expect(JSON.stringify(llm.mock.calls[0][0].input)).toContain("input_image");
  });

  it("a photo older than 15 minutes isn't used", async () => {
    vi.mocked(getMedia).mockResolvedValueOnce({ bytes: Buffer.from([0xff, 0xd8, 0xff, 3]), mimeType: "image/jpeg" });
    const p = photo(ALICE);
    await deliver(p);
    await WhatsAppEventModel.collection.updateOne({ messageId: p.id }, { $set: { createdAt: new Date(Date.now() - 16 * 60_000) } });
    llm.mockResolvedValueOnce(resp([say("ok")]));
    await deliver(text(ALICE, "what's left at Taman Desa?"));
    const user = await asOwner(() => AssistantMessageModel.findOne({ role: "user" }).sort({ _id: -1 }).lean());
    expect(user!.attachments).toEqual([]);
  });

  it("empty audio asks for a retry and makes no LLM call", async () => {
    vi.mocked(transcribe).mockResolvedValueOnce({ text: " … " });
    const m = voice(ALICE);
    await deliver(m);
    expect(llm).not.toHaveBeenCalled();
    expect(sentTo(ALICE)).toEqual(["Sorry, I couldn't hear that. Please send the voice note again."]);
    // No message keeps it, so the 90-day purge would never find it: deleted now.
    const { mediaKey } = (await WhatsAppEventModel.findOne({ messageId: m.id }).lean())!;
    await expect(getObject(mediaKey!)).rejects.toThrow();
  });

  it("too-large media gets a friendly reply and isn't downloaded twice", async () => {
    vi.mocked(getMedia).mockRejectedValue(new MediaTooLargeError("big"));
    await deliver(voice(ALICE));
    await JobModel.updateMany({ type: "whatsapp.inbound" }, { $set: { status: "pending", runAt: new Date() } }); // as if retried
    await runDue();
    expect(getMedia).toHaveBeenCalledOnce();
    expect(sentTo(ALICE)).toEqual([expect.stringContaining("over 16 MB")]);
    expect(llm).not.toHaveBeenCalled();
  });

  it("Approve taps apply without the LLM; a stranger's button ID is refused", async () => {
    llm.mockResolvedValueOnce(resp([call("propose_zz_wa_note", { note: "a" })])).mockResolvedValueOnce(resp([say("Tap Approve to save it.")]));
    await deliver(text(ALICE, "save note a"));
    const action = await pendingOf("a");
    expect(lastButtons(ALICE)[2]).toEqual([{ id: `approve:${action._id}`, title: "Approve" }, { id: `reject:${action._id}`, title: "Reject" }]);

    llm.mockReset();
    await deliver(tap(CAROL, `approve:${action._id}`));
    expect(sentTo(CAROL)).toEqual(["Only the person who asked can approve this"]);
    expect((await pendingOf("a")).status).toBe("pending");

    await deliver(tap(ALICE, `approve:${action._id}`));
    expect(llm).not.toHaveBeenCalled();
    expect((await pendingOf("a")).status).toBe("applied");
    expect(applied).toBe(1);
    expect(sentTo(ALICE).at(-1)).toBe("Done: Note a.");
  });

  it("typed 'yes' goes to the LLM and approves nothing", async () => {
    llm.mockResolvedValueOnce(resp([call("propose_zz_wa_note", { note: "b" })])).mockResolvedValueOnce(resp([say("Tap Approve.")]));
    await deliver(text(ALICE, "save note b"));
    llm.mockResolvedValueOnce(resp([say("Please tap Approve on the card.")]));
    await deliver(text(ALICE, "yes"));
    expect(llm).toHaveBeenCalledTimes(3);
    expect((await pendingOf("b")).status).toBe("pending");
  });

  it("Approve after unlink is refused", async () => {
    const action = await pendingOf("b");
    await WhatsAppLinkModel.deleteOne({ phone: ALICE });
    // A tap already queued when the link went: the job refuses it.
    const id = wamid();
    await runWithCtx(systemCtx(org), () => tx(async () => {
      await WhatsAppEventModel.create([{ messageId: id, orgId: org, phone: ALICE, payload: { id, from: ALICE, timestamp: 1, type: "button", buttonId: `approve:${action._id}` } }]);
      await enqueue("whatsapp.inbound", { messageId: id }, new Date(), `wa:${ALICE}`);
    }));
    await runDue();
    // A tap after unlinking: the webhook doesn't queue it at all.
    await deliver(tap(ALICE, `approve:${action._id}`));
    expect((await pendingOf("b")).status).toBe("pending");
    expect(sentTo(ALICE)[0]).toContain("isn't linked to Veenix any more");
    await WhatsAppLinkModel.create({ phone: ALICE, userId: alice, activeOrgId: org, verifiedAt: new Date() });
  });

  it("a person in two organizations is asked which, and nothing runs until they choose", async () => {
    await deliver(text(BOB, "how many projects?"));
    expect(llm).not.toHaveBeenCalled();
    const [, body, buttons] = lastButtons(BOB);
    expect(body).toContain("Which organisation");
    expect(buttons).toEqual([{ id: `org:${org}`, title: "Reno One" }, { id: `org:${org2}`, title: "Reno Two" }]);
    expect(await asOwner(() => AssistantConversationModel.exists({ userId: bob }), org2)).toBeNull();

    await deliver(tap(BOB, `org:${org2}`));
    expect((await WhatsAppLinkModel.findOne({ phone: BOB }).lean())!.activeOrgId).toEqual(org2);
    expect(sentTo(BOB).at(-1)).toContain("Now working in Reno Two");

    llm.mockResolvedValueOnce(resp([say("You have none.")]));
    await deliver(text(BOB, "how many projects?"));
    expect(llm).toHaveBeenCalledOnce();
    expect(await asOwner(() => AssistantConversationModel.exists({ userId: bob, channel: "whatsapp" }), org2)).not.toBeNull();
  });

  it("a retried job doesn't send the message to the LLM twice", async () => {
    llm.mockResolvedValue(resp([say("ok")]));
    const m = text(ALICE, "retry me");
    await deliver(m);
    await JobModel.updateMany({ type: "whatsapp.inbound" }, { $set: { status: "pending", runAt: new Date() } });
    await runDue();
    await runDue();
    expect(llm).toHaveBeenCalledOnce();
    expect(await asOwner(() => AssistantMessageModel.countDocuments({ role: "user", text: "retry me" }))).toBe(1);
  });
});
