import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import mongoose, { Types } from "mongoose";
import { convertLeadInput, conceptPatchInput, FURNITURE, type Room } from "@veenix/shared";
import "../assistant/tools.concepts";
import "./concepts.jobs";
import { executeTool } from "../assistant/tools";
import { deleteConversation, getConversation } from "../assistant/assistant.controller";
import { strictSchema } from "../assistant/tools";
import { roomSchema } from "@veenix/shared";
import { AssistantConversationModel, AssistantMessageModel } from "../assistant/models";
import { JobModel } from "../jobs/job.model";
import { runDue } from "../jobs/jobs";
import { LeadModel } from "../leads/lead.model";
import { LeadsService } from "../leads/leads.service";
import { MembershipModel } from "../orgs/membership.model";
import { ProjectModel } from "../projects/project.model";
import { ensureBucket, getObject, newKey, putObject } from "../storage/storage";
import { sendCtaUrl, sendTemplate, sendText } from "../whatsapp/client";
import { WhatsAppLinkModel } from "../whatsapp/link.model";
import { env } from "../config/env";
import { asOrg, newId } from "../../test/ctx";
import { redis } from "../common/redis";
import { DAILY_SPEND_CAP_MICROS, spendKey } from "../assistant/limits";
import { describeRoom, restyle } from "./ai";
import { DesignConceptModel } from "./concept.model";
import { ConceptsService } from "./concepts.service";

vi.mock("./ai", () => ({ restyle: vi.fn(), describeRoom: vi.fn() }));
vi.mock("../whatsapp/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../whatsapp/client")>()),
  sendCtaUrl: vi.fn().mockResolvedValue({}),
  sendTemplate: vi.fn().mockResolvedValue({}),
  sendText: vi.fn().mockResolvedValue({}),
}));

const org = newId(), owner = newId();
let project: Types.ObjectId, lead: Types.ObjectId, conv: Types.ObjectId, photoKey: string;
const svc = new ConceptsService();
const asOwner = <T>(fn: () => Promise<T>, o = org) => asOrg(o, fn, { userId: owner });
const callId = () => String(newId());
const RESTYLED = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const ROOM: Room = {
  width: 4, length: 5, height: 2.8, wallColor: "#f4f1ea", floor: "light_oak",
  openings: [{ wall: "back", kind: "window", at: 2, width: 1.5, height: 1.4, sill: 0.9 }],
  items: [{ type: "sofa", x: 7, z: 0, rotation: 0, color: "#c8b8a0" }], // inside the schema, outside a 4 m room
};

function tc(attachments = [{ key: photoKey, name: "room.jpg", kind: "photo" as const }]) {
  return { conversationId: conv, messageId: newId(), attachments };
}
type StartInput = { projectId: string | null; leadId: string | null; style: string; layout: string | null; photoIndexes: number[] | null; fromConceptId: string | null };
async function start(input: Partial<StartInput> = {}, c = tc(), o = org) {
  return asOwner(() => executeTool(c, {
    id: callId(), name: "generate_room_concept",
    input: { projectId: String(project), leadId: null, style: "Japandi, light oak", layout: null, photoIndexes: null, fromConceptId: null, ...input },
  }), o);
}
/** Stores a small JPEG under the org's assistant photos and returns its key. */
const storePhoto = (byte: number) => asOwner(async () => {
  const key = newKey("assistant", ".jpg");
  await putObject(key, Buffer.from([0xff, 0xd8, 0xff, 0xe0, byte]), "image/jpeg");
  return key;
});
const photos = (keys: string[]) => keys.map((key) => ({ key, name: "r.jpg", kind: "photo" as const }));
const latest = () => asOwner(() => DesignConceptModel.findOne().sort({ _id: -1 }).lean());
/** Runs the queued concept jobs now, however far their retry was pushed back. */
async function runJobs() {
  await JobModel.updateMany({ type: "concept.generate", status: "pending" }, { $set: { runAt: new Date(0) } });
  await runDue();
}

beforeAll(async () => {
  await ensureBucket();
  await MembershipModel.create([{ orgId: org, userId: owner, role: "owner" }]);
  [project] = (await asOwner(() => ProjectModel.create([{ code: "P1", name: "Taman Desa", clientName: "A" }]))).map((p) => p._id);
  [lead] = (await asOwner(() => LeadModel.create([{ code: "L1", name: "Aisyah", phone: "012-3456789" }]))).map((l) => l._id);
  conv = (await asOwner(() => AssistantConversationModel.create([{ userId: owner, channel: "app" }])))[0]._id;
  photoKey = await asOwner(async () => {
    const key = newKey("assistant", ".jpg");
    await putObject(key, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9, 9]), "image/jpeg");
    return key;
  });
});

beforeEach(async () => {
  // Earlier tests' concepts move out of the 24-hour quota window (the quota test uses its own org).
  await mongoose.connection.collection("design_concepts").updateMany({ orgId: org }, { $set: { createdAt: new Date(Date.now() - 2 * 86_400_000) } });
  vi.mocked(restyle).mockReset().mockResolvedValue(RESTYLED);
  vi.mocked(describeRoom).mockReset().mockResolvedValue(ROOM);
});

describe("generate_room_concept", () => {
  it("saves the concept and job together and returns before any OpenAI call", async () => {
    const r = await start();
    expect(r).toMatchObject({ isError: false });
    const c = (await latest())!;
    expect(r.content).toContain(`Started concept ${c._id}`);
    expect(c).toMatchObject({ status: "generating", brief: "Japandi, light oak", sourceKey: photoKey, createdBy: owner });
    expect(await JobModel.exists({ type: "concept.generate", "payload.conceptId": String(c._id) })).toBeTruthy();
    expect(restyle).not.toHaveBeenCalled();
  });

  it("refuses without an attached photo, and without exactly one of project or lead", async () => {
    expect(await start({}, tc([]))).toMatchObject({ isError: true, content: "Attach a room photo first." });
    expect(await start({ projectId: null })).toMatchObject({ isError: true, content: "Say which project or lead this is for." });
    expect(await start({ leadId: String(lead) })).toMatchObject({ isError: true, content: "Say which project or lead this is for." });
  });

  it("another style reuses the earlier concept's photo", async () => {
    await start();
    const first = (await latest())!;
    const r = await start({ style: "Industrial", fromConceptId: String(first._id) }, tc([]));
    expect(r.isError).toBe(false);
    expect(await latest()).toMatchObject({ sourceKey: photoKey, brief: "Industrial" });
  });

  it("refuses over 20 in 24 hours, and a failure doesn't count", async () => {
    const other = newId();
    await MembershipModel.create([{ orgId: other, userId: owner, role: "owner" }]);
    const p = (await asOwner(() => ProjectModel.create([{ code: "P2", name: "Other", clientName: "B" }]), other))[0]._id;
    const base = { projectId: p, sourceKey: photoKey, brief: "x", name: "x", conversationId: conv, createdBy: owner };
    await asOwner(() => DesignConceptModel.create(Array.from({ length: 20 }, () => ({ ...base, status: "ready" }))), other);
    const otherConv = (await asOwner(() => AssistantConversationModel.create([{ userId: owner, channel: "app" }]), other))[0]._id;
    const c = { ...tc(), conversationId: otherConv };
    expect((await start({ projectId: String(p) }, c, other)).content).toContain("20 room concepts");
    await asOwner(() => DesignConceptModel.updateOne({ projectId: p }, { $set: { status: "failed" } }), other);
    expect((await start({ projectId: String(p) }, c, other)).isError).toBe(false);
  });

  it("a retried tool call doesn't start a second concept", async () => {
    const before = await asOwner(() => DesignConceptModel.countDocuments());
    const c = tc();
    const use = { id: callId(), name: "generate_room_concept", input: { projectId: String(project), leadId: null, style: "Once", layout: null, photoIndexes: null, fromConceptId: null } };
    await asOwner(() => executeTool(c, use));
    await asOwner(() => executeTool(c, use));
    expect(await asOwner(() => DesignConceptModel.countDocuments())).toBe(before + 1);
  });

  it("refuses a new concept over the daily cap without a paid call", async () => {
    const before = await asOwner(() => DesignConceptModel.countDocuments());
    await redis.set(spendKey(String(org)), DAILY_SPEND_CAP_MICROS);
    try {
      expect(await start()).toMatchObject({ isError: true, content: "Today's AI budget for this organisation is used up. Try again tomorrow." });
    } finally {
      await redis.del(spendKey(String(org)));
    }
    expect(await asOwner(() => DesignConceptModel.countDocuments())).toBe(before);
  });

  it("uses a photo from an earlier message when this one has none", async () => {
    const chat = (await asOwner(() => AssistantConversationModel.create([{ userId: owner, channel: "app" }])))[0]._id;
    const key = await storePhoto(1);
    await asOwner(() => AssistantMessageModel.create([{ conversationId: chat, role: "user", text: "the room", attachments: photos([key]) }]));
    const r = await start({}, { ...tc([]), conversationId: chat });
    expect(r.isError).toBe(false);
    expect(await latest()).toMatchObject({ sourceKey: key });
  });

  it("uses up to three photos, the first as the before image", async () => {
    const keys = await Promise.all([1, 2, 3, 4].map(storePhoto));
    await start({}, tc(photos(keys)));
    expect(await latest()).toMatchObject({ sourceKey: keys[0], extraKeys: keys.slice(1, 3) });
    await start({ photoIndexes: [2, 0] }, tc(photos(keys)));
    expect(await latest()).toMatchObject({ sourceKey: keys[2], extraKeys: [keys[0]] });
  });

  it("another style keeps the earlier concept's photos and layout", async () => {
    const keys = await Promise.all([5, 6].map(storePhoto));
    await start({ layout: "door on the back wall" }, tc(photos(keys)));
    const first = (await latest())!;
    await start({ style: "Industrial", fromConceptId: String(first._id) }, tc([]));
    expect(await latest()).toMatchObject({ brief: "Industrial", layout: "door on the back wall", sourceKey: keys[0], extraKeys: [keys[1]] });
  });
});

describe("concept.generate job", () => {
  it("stores the image in our bucket and the room after fitRoom", async () => {
    await start();
    await runJobs();
    const c = (await latest())!;
    expect(c.status).toBe("ready");
    expect(c.imageKey).toMatch(new RegExp(`^orgs/${org}/concepts/.+\\.jpg$`));
    expect(await getObject(c.imageKey!)).toEqual(RESTYLED);
    const room = c.room as Room;
    expect(room.items[0].x).toBeCloseTo(2 - FURNITURE.sofa.w / 2);
    const dto = await asOwner(() => svc.get(c._id));
    expect(dto).toMatchObject({ status: "ready", room: { width: 4 } });
    expect(dto.imageUrl).toContain(c.imageKey!);
    expect(JSON.stringify(dto)).not.toContain("openai");
  });

  it("sends only the style to the image edit and the layout to the room description", async () => {
    await start({ style: "biophilic office", layout: "desks against the left wall" });
    await runJobs();
    expect(vi.mocked(restyle).mock.calls[0][2]).toBe("biophilic office");
    const [, , style, layout] = vi.mocked(describeRoom).mock.calls[0];
    expect([style, layout]).toEqual(["biophilic office", "desks against the left wall"]);
  });

  it("describes the room from the restyled photo, then the originals", async () => {
    const keys = await Promise.all([7, 8].map(storePhoto));
    await start({}, tc(photos(keys)));
    await runJobs();
    const [restyled, originals] = vi.mocked(describeRoom).mock.calls[0];
    expect(restyled).toEqual(RESTYLED);
    expect(originals).toEqual(await Promise.all(keys.map(async (k) => ({ photo: await getObject(k), ext: ".jpg" }))));
  });

  it("a retry after the image is stored describes the stored image", async () => {
    await start();
    await runJobs();
    const c = (await latest())!;
    await asOwner(() => DesignConceptModel.updateOne({ _id: c._id }, { $set: { status: "generating", room: null } }));
    await asOwner(() => JobModel.create([{ orgId: org, type: "concept.generate", payload: { conceptId: String(c._id), userId: String(owner) } }]));
    vi.mocked(describeRoom).mockClear();
    await runJobs();
    expect(vi.mocked(describeRoom).mock.calls[0][0]).toEqual(RESTYLED);
  });

  it("a retried job doesn't pay for the image twice once it's stored", async () => {
    await start();
    await runJobs();
    const c = (await latest())!;
    await asOwner(() => DesignConceptModel.updateOne({ _id: c._id }, { $set: { status: "generating", room: null } }));
    await asOwner(() => JobModel.create([{ orgId: org, type: "concept.generate", payload: { conceptId: String(c._id), userId: String(owner) } }]));
    await runJobs();
    expect(restyle).toHaveBeenCalledTimes(1);
    expect((await latest())!.status).toBe("ready");
  });

  it("a failed room description leaves a ready, image-only concept", async () => {
    vi.mocked(describeRoom).mockRejectedValue(new Error("bad json"));
    await start();
    await runJobs();
    expect(await latest()).toMatchObject({ status: "ready", room: null });
    expect(describeRoom).toHaveBeenCalledTimes(1);
  });

  it("after the last attempt it's failed, the conversation is told, and the quota returns", async () => {
    vi.mocked(restyle).mockRejectedValue(new Error("timeout"));
    await start();
    const id = (await latest())!._id;
    for (let i = 0; i < 3; i++) await runJobs();
    expect(restyle).toHaveBeenCalledTimes(3);
    expect(await asOwner(() => DesignConceptModel.findById(id).lean())).toMatchObject({ status: "failed", error: "The room concept didn't work. Please try again." });
    const notes = (await asOwner(() => AssistantConversationModel.findById(conv).lean()))!.notes;
    expect(notes.some((n) => n.includes(String(id)) && n.includes("didn't work"))).toBe(true);
  });
});

describe("access", () => {
  it("a lead's concept is hidden from site staff and finance", async () => {
    await start({ projectId: null, leadId: String(lead) });
    const id = (await latest())!._id;
    const as = (role: "site_staff" | "finance" | "sales") =>
      asOrg(org, () => svc.get(id), { role, projectScope: role === "site_staff" ? [project] : "all" });
    await expect(as("site_staff")).rejects.toThrow("not found");
    await expect(as("finance")).rejects.toThrow("not found");
    await expect(as("sales")).resolves.toMatchObject({ leadId: String(lead) });
    const listed = await asOrg(org, () => svc.list({ leadId: lead }), { role: "finance" });
    expect(listed).toEqual([]);
  });

  it("converting a lead moves its concepts to the project", async () => {
    const [l] = await asOwner(() => LeadModel.create([{ code: "L2", name: "Ben", phone: "012-1111111" }]));
    await start({ projectId: null, leadId: String(l._id) });
    const id = (await latest())!._id;
    const address = { addressLine1: "No. 1, Jalan 1", postcode: "47300", city: "Petaling Jaya", state: "Selangor" };
    const { projectId } = await asOwner(() => new LeadsService().convert(l._id, convertLeadInput.parse({ projectName: "Ben House", address })));
    expect(await asOwner(() => DesignConceptModel.findById(id).lean())).toMatchObject({ projectId: new Types.ObjectId(projectId), leadId: null });
  });

  it("PATCH stores a fitted room and refuses junk", async () => {
    await start();
    const id = (await latest())!._id;
    expect(conceptPatchInput.safeParse({ room: { ...ROOM, wallColor: "red" } }).success).toBe(false);
    await asOwner(() => svc.update(id, { name: "Living room", saved: true, room: ROOM }));
    const c = (await latest())!;
    expect(c).toMatchObject({ name: "Living room", saved: true });
    expect((c.room as Room).items[0].x).toBeCloseTo(2 - FURNITURE.sofa.w / 2);
    expect(await asOwner(() => svc.list({ projectId: project }))).toEqual([expect.objectContaining({ id: String(id) })]);
  });
});

describe("in the chat", () => {
  it("the reply carries the concept card, with its status as it is now", async () => {
    const [u] = await asOwner(() => AssistantMessageModel.create([{ conversationId: conv, role: "user", text: "Japandi please" }]));
    await asOwner(() => AssistantMessageModel.updateOne({ _id: u._id }, { $set: { turnOf: u._id } }));
    await start({}, { ...tc(), messageId: u._id });
    await asOwner(() => AssistantMessageModel.create([{ conversationId: conv, role: "assistant", text: "On it.", turnOf: u._id, stop: "completed" }]));
    await runJobs();
    const reply = (await asOwner(() => getConversation(conv))).messages.find((m) => m.role === "assistant" && m.text === "On it.")!;
    expect(reply.concepts).toEqual([expect.objectContaining({ status: "ready", brief: "Japandi, light oak" })]);
  });
});

describe("on WhatsApp", () => {
  const PHONE = "60123456789";
  let wa: Types.ObjectId;
  const inWindow = (yes: boolean) => WhatsAppLinkModel.updateOne({ userId: owner }, { $set: { lastInboundAt: yes ? new Date() : new Date(Date.now() - 2 * 86_400_000) } });
  async function finishOne() {
    await start({}, { ...tc(), conversationId: wa });
    await runJobs();
    return (await latest())!;
  }

  beforeAll(async () => {
    wa = (await asOwner(() => AssistantConversationModel.create([{ userId: owner, channel: "whatsapp" }])))[0]._id;
    await WhatsAppLinkModel.create([{ phone: PHONE, userId: owner, activeOrgId: org, verifiedAt: new Date() }]);
  });
  beforeEach(() => {
    vi.mocked(sendCtaUrl).mockClear();
    vi.mocked(sendTemplate).mockClear();
    vi.mocked(sendText).mockClear();
  });

  it("uses cta_url inside the window and the template outside", async () => {
    await inWindow(true);
    const c = await finishOne();
    expect(sendCtaUrl).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendCtaUrl).mock.calls[0][1].headerImageUrl).toContain(c.imageKey!);
    expect(sendTemplate).not.toHaveBeenCalled();

    await inWindow(false);
    const d = await finishOne();
    expect(sendTemplate).toHaveBeenCalledWith(PHONE, "concept_ready", "en", [{ type: "body", parameters: [{ type: "text", text: d.name }] }]);
    expect(sendCtaUrl).toHaveBeenCalledTimes(1);
  });

  it("the button text is at most 20 characters and links only by concept id", async () => {
    await inWindow(true);
    const c = await finishOne();
    const [to, m] = vi.mocked(sendCtaUrl).mock.calls[0];
    expect(to).toBe(PHONE);
    expect(m.buttonText).toBe("Open 3D view");
    expect(m.buttonText.length).toBeLessThanOrEqual(20);
    expect(m.url).toBe(`${env.WEB_ORIGIN}/concepts/${c._id}`);
  });

  it("the text says AI concept, not to scale and never claims other work was done", async () => {
    await inWindow(true);
    await finishOne();
    const { body } = vi.mocked(sendCtaUrl).mock.calls[0][1];
    expect(body).toContain("AI concept, not to scale");
    expect(body).not.toMatch(/updated|saved|quotation|done|added/i);
  });

  it("an image-only concept gets View concept instead of Open 3D view", async () => {
    vi.mocked(describeRoom).mockRejectedValue(new Error("bad json"));
    await inWindow(true);
    await finishOne();
    expect(vi.mocked(sendCtaUrl).mock.calls[0][1].buttonText).toBe("View concept");
  });

  it("a failed concept sends an apology inside the window and nothing outside", async () => {
    vi.mocked(restyle).mockRejectedValue(new Error("timeout"));
    await inWindow(true);
    await start({}, { ...tc(), conversationId: wa });
    for (let i = 0; i < 3; i++) await runJobs();
    expect(sendText).toHaveBeenCalledWith(PHONE, "Sorry, the room concept didn't work. Please try again.");

    vi.mocked(sendText).mockClear();
    await inWindow(false);
    await start({}, { ...tc(), conversationId: wa });
    for (let i = 0; i < 3; i++) await runJobs();
    expect(sendText).not.toHaveBeenCalled();
    expect(sendTemplate).not.toHaveBeenCalled();
    expect(sendCtaUrl).not.toHaveBeenCalled();
  });
});

describe("review fixes", () => {
  it("deleting the chat keeps the photo a concept still uses", async () => {
    const chat = (await asOwner(() => AssistantConversationModel.create([{ userId: owner, channel: "app" }])))[0]._id;
    const key = await asOwner(async () => {
      const k = newKey("assistant", ".jpg");
      await putObject(k, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 7]), "image/jpeg");
      return k;
    });
    await asOwner(() => AssistantMessageModel.create([{ conversationId: chat, role: "user", text: "room", attachments: [{ key, name: "r.jpg", kind: "photo" }] }]));
    await start({}, { ...tc([{ key, name: "r.jpg", kind: "photo" }]), conversationId: chat });
    await asOwner(() => deleteConversation(chat));
    await new Promise((r) => setTimeout(r, 100)); // removal runs after commit
    await expect(getObject(key)).resolves.toBeInstanceOf(Buffer);
  });

  it("deleting the chat keeps every photo a concept uses, not just the first", async () => {
    const chat = (await asOwner(() => AssistantConversationModel.create([{ userId: owner, channel: "app" }])))[0]._id;
    const keys = await Promise.all([10, 11].map(storePhoto));
    await asOwner(() => AssistantMessageModel.create([{ conversationId: chat, role: "user", text: "room", attachments: photos(keys) }]));
    await start({}, { ...tc(photos(keys)), conversationId: chat });
    await asOwner(() => deleteConversation(chat));
    await new Promise((r) => setTimeout(r, 100)); // removal runs after commit
    await expect(getObject(keys[1])).resolves.toBeInstanceOf(Buffer);
  });

  it("the room schema is accepted by OpenAI strict mode", () => {
    expect(() => strictSchema(roomSchema)).not.toThrow();
  });
});
