import mongoose from "mongoose";
import { runAsMember } from "../auth/member-ctx";
import { ctx } from "../common/context";
import { redis } from "../common/redis";
import { registerJob } from "../jobs/jobs";
import { JobModel } from "../jobs/job.model";
import { ProjectModel } from "../projects/project.model";
import { deleteObject } from "../storage/storage";
import { TaskModel } from "../tasks/task.model";
import { myTasks } from "../tasks/tasks.service";
import { SiteUpdateModel } from "../updates/site-update.model";
import { inWindow, sendTemplate, sendText, whatsappConfigured } from "../whatsapp/client";
import { WhatsAppLinkModel } from "../whatsapp/link.model";
import { PendingActionModel } from "./models";

const DAY_MS = 86_400_000;
const MYT_MS = 8 * 3_600_000; // Malaysia is UTC+8 all year
const QUIET_MS = 3 * DAY_MS;
const AUDIO_KEEP_MS = 90 * DAY_MS;

/** Malaysia's calendar day for an instant: its date, the hour there, and when the day started. */
function myDay(now: Date) {
  const local = new Date(now.getTime() + MYT_MS);
  const date = local.toISOString().slice(0, 10);
  return { date, hour: local.getUTCHours(), start: new Date(Date.parse(date) - MYT_MS) };
}

/** From 8am Malaysia time, once a day however often cron fires: one summary job per linked person who wants them, in their active organisation. */
export async function scheduleDaily(now = new Date()): Promise<number> {
  const { date, hour } = myDay(now);
  if (hour < 8 || !whatsappConfigured()) return 0;
  if (!(await redis.set(`morning:${date}`, "1", "EX", 2 * 86_400, "NX"))) return 0;
  const links = await WhatsAppLinkModel.find({ notify: true, activeOrgId: { $ne: null } }).select("userId activeOrgId").lean();
  // JobModel isn't tenant-scoped, so one insert covers every organisation; the cron run's runDue picks them up.
  if (links.length) await JobModel.insertMany(links.map((l) => ({ orgId: l.activeOrgId, type: "assistant.morning", payload: { userId: String(l.userId), date }, runAt: now })));
  return links.length;
}

export type Summary = { overdue: number; dueToday: number; waitingApproval: number; quietProjects: string[] };

/** The signed-in member's morning numbers, within what they may see. Null when there's nothing to report. */
export async function buildSummary(now = new Date()): Promise<Summary | null> {
  const { start } = myDay(now);
  const open = { ...myTasks(), status: "open" };
  const quietSince = new Date(now.getTime() - QUIET_MS);
  const [overdue, dueToday, waitingApproval, inProgress] = await Promise.all([
    TaskModel.countDocuments({ ...open, dueAt: { $lt: start } }),
    TaskModel.countDocuments({ ...open, dueAt: { $gte: start, $lt: new Date(start.getTime() + DAY_MS) } }),
    PendingActionModel.countDocuments({ userId: ctx().userId, status: "pending", expiresAt: { $gt: now } }),
    // Scoped by the tenant plugin: a site worker sees only their assigned projects. One that entered the stage recently isn't quiet yet.
    ProjectModel.find({ stage: "WORK_IN_PROGRESS", stageEnteredAt: { $lt: quietSince } }).select("name").sort({ name: 1 }).lean(),
  ]);
  const updated = await SiteUpdateModel.distinct("projectId", { projectId: { $in: inProgress.map((p) => p._id) }, createdAt: { $gte: quietSince } });
  const quietProjects = inProgress.filter((p) => !updated.some((id) => p._id.equals(id))).map((p) => p.name);
  if (!overdue && !dueToday && !waitingApproval && !quietProjects.length) return null;
  return { overdue, dueToday, waitingApproval, quietProjects };
}

const projectList = (names: string[]) => (names.length > 5 ? `${names.slice(0, 5).join(", ")} and ${names.length - 5} more` : names.join(", "));

function summaryText(s: Summary) {
  const lines = [`Good morning. Overdue tasks: ${s.overdue}. Due today: ${s.dueToday}. Waiting for your approval: ${s.waitingApproval}.`];
  if (s.quietProjects.length) lines.push(`No site update for 3 days: ${projectList(s.quietProjects)}.`);
  return lines.join("\n");
}

registerJob<{ userId: string; date: string }>(
  "assistant.morning",
  async ({ userId }) => {
    const link = await WhatsAppLinkModel.findOne({ userId }).lean();
    // Unlinked, opted out, or switched organisation since this was queued.
    if (!link?.notify || !link.activeOrgId?.equals(ctx().orgId)) return;
    const s = await runAsMember(link.activeOrgId, link.userId, () => buildSummary());
    if (!s || s === "not_a_member") return;
    if (inWindow(link)) return void (await sendText(link.phone, summaryText(s)));
    // The owner's approved morning_summary template: {{1}} overdue, {{2}} due today, {{3}} waiting approval, {{4}} quiet projects. Its wording claims no changes.
    const params = [String(s.overdue), String(s.dueToday), String(s.waitingApproval), projectList(s.quietProjects) || "none"];
    await sendTemplate(link.phone, "morning_summary", "en", [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }]);
  },
  { maxAttempts: 3 }, // a summary hours late isn't worth sending
);

/** Deletes assistant voice notes older than 90 days (spec §10) and marks them removed. Transcripts stay with the message. Runs across organisations. */
export async function purgeOldAudio(now = new Date()): Promise<number> {
  const messages = mongoose.connection.collection("assistant_messages");
  const due = { createdAt: { $lt: new Date(now.getTime() - AUDIO_KEEP_MS) }, attachments: { $elemMatch: { kind: "audio", removedAt: null } } };
  // ponytail: 500 messages per cron run; a backlog clears over the following days.
  const rows = await messages.find(due).project<{ _id: mongoose.Types.ObjectId; attachments: { key: string; kind: string; removedAt?: Date | null }[] }>({ attachments: 1 }).limit(500).toArray();
  for (const m of rows) {
    for (const a of m.attachments) if (a.kind === "audio" && !a.removedAt) await deleteObject(a.key); // throws, so a failed delete is retried next run instead of marked removed
    await messages.updateOne({ _id: m._id }, { $set: { "attachments.$[a].removedAt": now } }, { arrayFilters: [{ "a.kind": "audio", "a.removedAt": null }] });
  }
  return rows.length;
}
