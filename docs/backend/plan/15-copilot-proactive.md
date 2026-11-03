# 15: Copilot proactive messages

> For whoever implements this (you or Claude): work task by task and tick each one off in [../README.md](../README.md).

**Goal:** staff get a morning WhatsApp summary and task reminders, scoped to what they're allowed to see, and can turn them off.

**Architecture:** the existing cron endpoint also schedules a daily sweep. Each message is its own job, which runs as the recipient, so a summary can't reveal an unassigned project.

**Tech stack:** plan 14's WhatsApp client, approved templates, the job queue.

**Spec:** [../copilot-spec.md](../copilot-spec.md) §9, §10.

## Global constraints
- **Time:** 8am Malaysia time. The existing `0 0 * * *` UTC cron is that time. Task reminders need the per-minute cron on Vercel Pro; nothing here provisions it.
- **Outside the 24-hour window, templates only:** `morning_summary`, `task_reminder`. The owner submits them to Meta. Template wording must never claim a change happened.
- **"Quiet" project:** stage `WORK_IN_PROGRESS` with no site update for 3 days.
- **Raw audio retention:** 90 days, then deleted. Transcripts stay with the record.

## Review focus
- **A task completed or rescheduled after its reminder was queued:** no reminder, or one at the new time. Tested in Task 15.2.
- **Nothing to report:** no morning message. Tested in Task 15.1.
- **The cron firing twice in a day:** one summary per person. Tested in Task 15.1.
- **A person who is in two organisations:** the summary covers only their active one. Tested in Task 15.1.
- **Unlinked or removed mid-day:** the queued job does nothing. Tested in Task 15.1.

---

### Task 15.1: Morning summary

**Files:**
- Create: `apps/api/src/assistant/proactive.ts`
- Modify: `apps/api/src/jobs/jobs.controller.ts`, `apps/api/src/jobs/jobs.ts` (`JobType`), `apps/api/src/whatsapp/links.controller.ts`, `apps/api/src/app.module.ts`, `apps/web/components/settings/WhatsAppLink.tsx` (a notifications toggle)
- Test: `apps/api/src/assistant/proactive.test.ts`

**Interfaces:**
- Consumes: `runAsMember`, `sendTemplate`, `sendText`, `inWindow`, `TasksService`, `PendingActionModel`.
- Produces:
  - `scheduleDaily(now = new Date()): Promise<number>`: when Malaysia time is at or past 08:00 and today's Redis key isn't set (`SET NX`), enqueues one `assistant.morning` job per link with `notify: true`.
  - `buildSummary(): Promise<{ overdue: number; dueToday: number; waitingApproval: number; quietProjects: string[] } | null>`: runs as the member; null when everything is zero.
  - `purgeOldAudio(now = new Date()): Promise<number>`: deletes assistant audio older than 90 days and marks it removed on the message.
  - `PATCH /v1/whatsapp/link` `{ notify: boolean }`

`JobsController.run` calls `scheduleDaily()` and `purgeOldAudio()` before `runDue`.

- [x] **Step 1: Write the failing tests**

```ts
it("runs once a day however often cron fires", ...);
it("doesn't run before 8am Malaysia time", async () => { expect(await scheduleDaily(new Date("2026-11-02T23:59:00Z"))).toBe(0); });
it("a site worker's summary counts only their assigned projects", ...);
it("skips a person with nothing to report", ...);
it("skips notify: false and removed members", ...);
it("counts a work-in-progress project with no update for 3 days as quiet", ...);
it("purges audio at 90 days and keeps the transcript", ...);
```

- [x] **Step 2: Implement, then run the tests**

Run: `pnpm --filter api test proactive; pnpm --filter web build`
Expected: PASS and a successful build.

- [x] **Step 3: Commit**: `feat(api): morning summary and audio retention`

### Task 15.2: Task reminders

**Files:**
- Modify: `apps/api/src/tasks/tasks.service.ts`, `apps/api/src/assistant/proactive.ts`, `apps/api/src/jobs/jobs.ts` (`JobType`)
- Test: `apps/api/src/assistant/proactive.test.ts`

**Interfaces:**
- Produces: `assistant.reminder` job, payload `{ taskId, dueAt }`, enqueued in the same transaction as a task with a time, with `runAt` one hour before `dueAt`.

The handler reloads the task and sends nothing unless it's still open and its `dueAt` matches the payload. Rescheduling enqueues a new job, so the old one simply does nothing.

- [x] **Step 1: Write the failing tests**

```ts
it("reminds the assignee an hour before", ...);
it("a completed task sends nothing", ...);
it("a rescheduled task reminds at the new time only", ...);
it("uses the template outside the window and text inside it", ...);
it("no assignee or no link: nothing is sent and the job completes", ...);
```

- [x] **Step 2: Implement, then run the tests**

Run: `pnpm --filter api test proactive`
Expected: PASS.

- [x] **Step 3: Commit**: `feat(api): task reminders`
