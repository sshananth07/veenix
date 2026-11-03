import { randomInt } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import mongoose, { Types } from "mongoose";
import { redis } from "../common/redis";
import { env } from "../config/env";
import { runDue } from "../jobs/jobs";
import { JobModel } from "../jobs/job.model";
import { MembershipModel } from "../orgs/membership.model";
import { ProjectModel } from "../projects/project.model";
import { ensureBucket, getObject, putObject } from "../storage/storage";
import { TaskModel } from "../tasks/task.model";
import { SiteUpdateModel } from "../updates/site-update.model";
import { WhatsAppLinkModel } from "../whatsapp/link.model";
import { sendTemplate, sendText } from "../whatsapp/client";
import { asOrg, newId } from "../../test/ctx";
import { AssistantMessageModel, PendingActionModel } from "./models";
import { buildSummary, purgeOldAudio, scheduleDaily } from "./proactive";

vi.mock("../whatsapp/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../whatsapp/client")>()),
  sendText: vi.fn().mockResolvedValue({}),
  sendTemplate: vi.fn().mockResolvedValue({}),
}));

const DAY = 86_400_000;
const org = newId(), org2 = newId(), alice = newId(), bob = newId(), carol = newId(), dave = newId(), erin = newId();
const phone = () => `601${randomInt(10_000_000, 99_999_999)}`;
const ALICE = phone(), BOB = phone(), CAROL = phone(), DAVE = phone(), ERIN = phone();
let mine: Types.ObjectId, notMine: Types.ObjectId, busy: Types.ObjectId;

const asOwner = <T>(fn: () => Promise<T>, o = org) => asOrg(o, fn);
const asAlice = <T>(fn: () => Promise<T>) => asOrg(org, fn, { userId: alice, role: "site_staff", projectScope: [mine] });
const asBob = <T>(fn: () => Promise<T>, o = org) => asOrg(o, fn, { userId: bob });
/** Backdates a document's createdAt past what Mongoose's timestamps allow. */
const backdate = (collection: string, _id: Types.ObjectId, createdAt: Date) => mongoose.connection.collection(collection).updateOne({ _id }, { $set: { createdAt } });
/** 8am in Kuala Lumpur on a past day of its own, with that day's once-a-day key cleared (Redis outlasts the test database). */
async function someDay(day: number) {
  const d = new Date(Date.UTC(2020, 0, day));
  await redis.del(`morning:${d.toISOString().slice(0, 10)}`);
  return d;
}
const sentTo = (p: string) => [...vi.mocked(sendText).mock.calls, ...vi.mocked(sendTemplate).mock.calls].filter((c) => c[0] === p);

beforeAll(async () => {
  Object.assign(env, { WHATSAPP_APP_SECRET: "s", WHATSAPP_VERIFY_TOKEN: "v", WHATSAPP_ACCESS_TOKEN: "t", WHATSAPP_PHONE_NUMBER_ID: "PNID" });
  await ensureBucket();
  const old = new Date(Date.now() - 10 * DAY);
  [mine, notMine, busy] = (await asOwner(() => ProjectModel.create([
    { code: "TD", name: "Taman Desa", clientName: "A", stage: "WORK_IN_PROGRESS", stageEnteredAt: old, assignees: [{ userId: alice, role: "site_staff" }] },
    { code: "BK", name: "Bangsar Kondo", clientName: "B", stage: "WORK_IN_PROGRESS", stageEnteredAt: old },
    { code: "MK", name: "Mont Kiara", clientName: "C", stage: "WORK_IN_PROGRESS", stageEnteredAt: old },
  ]))).map((p) => p._id);
  await asOwner(() => ProjectModel.create([
    { code: "NW", name: "Just Started", clientName: "D", stage: "WORK_IN_PROGRESS", stageEnteredAt: new Date() },
    { code: "QT", name: "Still Quoting", clientName: "E", stage: "QUOTING", stageEnteredAt: old },
  ]));
  const [stale] = await asOwner(() => SiteUpdateModel.create([{ projectId: mine, kind: "progress", text: "tiling", authorId: alice }]));
  await backdate("site_updates", stale._id, new Date(Date.now() - 4 * DAY));
  await asOwner(() => SiteUpdateModel.create([{ projectId: busy, kind: "progress", text: "wiring", authorId: bob }]));
  await MembershipModel.create([
    { orgId: org, userId: alice, role: "site_staff" },
    { orgId: org, userId: bob, role: "owner" },
    { orgId: org2, userId: bob, role: "owner" },
    { orgId: org, userId: carol, role: "site_staff" },
    { orgId: org, userId: dave, role: "site_staff", status: "removed" },
    { orgId: org, userId: erin, role: "site_staff" },
  ]);
  await WhatsAppLinkModel.create([
    { phone: ALICE, userId: alice, activeOrgId: org, verifiedAt: new Date() },
    { phone: BOB, userId: bob, activeOrgId: org2, verifiedAt: new Date(), lastInboundAt: new Date() },
    { phone: CAROL, userId: carol, activeOrgId: org, verifiedAt: new Date(), notify: false },
    { phone: DAVE, userId: dave, activeOrgId: org, verifiedAt: new Date() },
    { phone: ERIN, userId: erin, activeOrgId: org, verifiedAt: new Date() },
  ]);
  await asOwner(() => TaskModel.create([
    { title: "Order tiles", assigneeId: alice, dueAt: new Date(Date.now() - 2 * DAY) },
    { title: "Old org task for Bob", assigneeId: bob, dueAt: new Date(Date.now() - 2 * DAY) },
    { title: "Carol's task", assigneeId: carol, dueAt: new Date(Date.now() - 2 * DAY) },
  ]));
});
beforeEach(() => {
  vi.mocked(sendText).mockClear();
  vi.mocked(sendTemplate).mockClear();
});

describe("morning summary", () => {
  it("runs once a day however often cron fires", async () => {
    const day = await someDay(1);
    const n = await scheduleDaily(day);
    expect(n).toBe(4); // everyone with notify on and an organisation chosen; Carol opted out
    expect(await scheduleDaily(new Date(day.getTime() + 3_600_000))).toBe(0);
    const jobs = await JobModel.find({ type: "assistant.morning", runAt: day }).lean();
    expect(jobs).toHaveLength(4);
    // Bob is in two organisations: his summary is queued in the active one only.
    expect(jobs.find((j) => (j.payload as { userId: string }).userId === String(bob))!.orgId).toEqual(org2);
  });

  it("doesn't run before 8am Malaysia time", async () => {
    expect(await scheduleDaily(new Date("2026-11-02T23:59:00Z"))).toBe(0);
  });

  it("a site worker's summary counts only their assigned projects", async () => {
    const s = await asAlice(() => buildSummary());
    expect(s).toEqual({ overdue: 1, dueToday: 0, waitingApproval: 0, quietProjects: ["Taman Desa"] });
    const owner = await asBob(() => buildSummary());
    expect(owner!.quietProjects.sort()).toEqual(["Bangsar Kondo", "Taman Desa"]);
  });

  it("counts a work-in-progress project with no update for 3 days as quiet", async () => {
    // Taman Desa's last update was 4 days ago: quiet. Mont Kiara was updated today, "Just Started" entered the stage today, "Still Quoting" isn't in progress.
    const s = await asBob(() => buildSummary());
    expect(s!.quietProjects).toContain("Taman Desa");
    expect(s!.quietProjects).not.toContain("Mont Kiara");
    expect(s!.quietProjects).not.toContain("Just Started");
    expect(s!.quietProjects).not.toContain("Still Quoting");
  });

  it("counts tasks due today and approvals waiting, in Malaysia's day", async () => {
    const now = new Date("2026-11-03T00:00:00Z"); // 8am in Kuala Lumpur
    await asOwner(() => TaskModel.create([
      { title: "Due this afternoon", assigneeId: erin, dueAt: new Date("2026-11-03T07:00:00Z") },
      { title: "Due 1am today", assigneeId: erin, dueAt: new Date("2026-11-02T17:00:00Z") },
      { title: "Due tomorrow", assigneeId: erin, dueAt: new Date("2026-11-03T17:00:00Z") },
      { title: "Done", assigneeId: erin, dueAt: new Date("2026-11-03T07:00:00Z"), status: "done" },
    ]));
    const pending = { conversationId: newId(), messageId: newId(), toolName: "x", input: {}, card: {} };
    await asOwner(() => PendingActionModel.create([
      { ...pending, userId: erin, expiresAt: new Date("2026-11-04T00:00:00Z") },
      { ...pending, userId: erin, expiresAt: new Date("2026-11-02T00:00:00Z") },
      { ...pending, userId: alice, expiresAt: new Date("2026-11-04T00:00:00Z") },
    ]));
    const s = await asOrg(org, () => buildSummary(now), { userId: erin, role: "site_staff", projectScope: [] });
    expect(s).toEqual({ overdue: 0, dueToday: 2, waitingApproval: 1, quietProjects: [] });
    await asOwner(() => TaskModel.deleteMany({ assigneeId: erin }));
    await asOwner(() => PendingActionModel.deleteMany({ userId: { $in: [erin, alice] } }));
  });

  it("skips a person with nothing to report", async () => {
    expect(await asOrg(org, () => buildSummary(), { userId: erin, role: "site_staff", projectScope: [] })).toBeNull();
    await runDue(50);
    expect(sentTo(ERIN)).toHaveLength(0);
  });

  it("sends a template outside the 24-hour window and text inside it, covering only the active organisation", async () => {
    await scheduleDaily(await someDay(2));
    await runDue(50);
    const [, name, , components] = sentTo(ALICE)[0] as unknown as Parameters<typeof sendTemplate>;
    expect(name).toBe("morning_summary");
    expect(JSON.stringify(components)).toContain("Taman Desa");
    // Bob replied recently, so free text; it covers org2, where he has no tasks and no quiet projects.
    expect(sentTo(BOB)).toHaveLength(0);
  });

  it("skips notify: false and removed members", async () => {
    await scheduleDaily(await someDay(3));
    await runDue(50);
    expect(sentTo(CAROL)).toHaveLength(0); // opted out
    expect(sentTo(DAVE)).toHaveLength(0); // removed from the organisation
  });

  it("does nothing when the person unlinked or opted out after it was queued", async () => {
    await scheduleDaily(await someDay(4));
    await WhatsAppLinkModel.updateOne({ userId: alice }, { $set: { notify: false } });
    await runDue(50);
    expect(sentTo(ALICE)).toHaveLength(0);
    await WhatsAppLinkModel.updateOne({ userId: alice }, { $set: { notify: true } });
  });
});

describe("audio retention", () => {
  it("purges audio at 90 days and keeps the transcript", async () => {
    const now = new Date();
    const oldKey = `orgs/${org}/assistant/old-${randomInt(1e9)}.ogg`, newKey = `orgs/${org}/assistant/new-${randomInt(1e9)}.ogg`;
    await putObject(oldKey, Buffer.from("old"), "audio/ogg");
    await putObject(newKey, Buffer.from("new"), "audio/ogg");
    const conversationId = newId();
    const [oldMsg, newMsg] = await asOwner(() => AssistantMessageModel.create([
      { conversationId, role: "user", text: "tiling done", transcript: "tiling done", attachments: [{ key: oldKey, name: "Voice note", kind: "audio" }, { key: "orgs/x/assistant/p.jpg", name: "WhatsApp photo", kind: "photo" }] },
      { conversationId, role: "user", text: "paint", transcript: "paint", attachments: [{ key: newKey, name: "Voice note", kind: "audio" }] },
    ]));
    await backdate("assistant_messages", oldMsg._id, new Date(now.getTime() - 91 * DAY));
    await backdate("assistant_messages", newMsg._id, new Date(now.getTime() - 89 * DAY));

    expect(await purgeOldAudio(now)).toBe(1);
    await expect(getObject(oldKey)).rejects.toThrow();
    expect((await getObject(newKey)).toString()).toBe("new");
    const after = (await asOwner(() => AssistantMessageModel.findById(oldMsg._id).lean()))!;
    expect(after.transcript).toBe("tiling done");
    expect(after.attachments[0].removedAt).toBeInstanceOf(Date);
    expect(after.attachments[1].removedAt ?? null).toBeNull(); // photos aren't audio
    expect(await purgeOldAudio(now)).toBe(0);
  });
});

